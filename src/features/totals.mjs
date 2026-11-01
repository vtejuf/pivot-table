/**
 * 行小计 / 行总计 feature（路线 B：展示布局派生）。
 *
 * 核心 aggregate / layoutPivot / renderPivot 都不修改；本模块分两步：
 *
 * 1. rollupRowTotals(cube, config)
 *    读取核心 aggregate() 的 cube，按配置上卷，输出独立的汇总表。
 *    不生成任何布局行，也不修改 cube。全部关闭时直接 skipped。
 *
 * 2. withRowTotals(layout, rolled, options)
 *    读取核心 layoutPivot() 的基础布局和上卷结果，在每个指定行维度的
 *    member 块末尾插入小计行，在行轴末尾插入总计行；重建行表头、cells、
 *    cellMap 和 size。列轴完全不变，matrix 置 null。
 *
 * 首期只支持行轴、单度量。列小计、双轴交叉、多度量和折叠联动后续扩展。
 *
 * 用法：
 *
 *     const cube = aggregate(rows, { dimensions, measure });
 *     const rolled = rollupRowTotals(cube, {
 *       rows: { subtotals: ['region'], grandTotal: true },
 *     });
 *     const base = layoutPivot(cube.rows, { dimensions, value: measure.key });
 *     const display = withRowTotals(base, rolled);
 *     renderPivot(canvas, display, options);
 */

import { valueKey } from '../model/value-key.mjs';

export const DEFAULT_TOTALS_LABELS = Object.freeze({
  subtotal: '{value} 小计',
  total: '总计',
});

/**
 * 按行维度上卷。
 *
 * @param {ReturnType<import('../model/aggregate.mjs').aggregate>} cube
 * @param {{
 *   rows?: {
 *     subtotals?: string[],
 *     grandTotal?: boolean
 *   },
 *   reduce?: (records: ReadonlyArray<object>, context: {
 *     measure: { key: string, aggregate: string },
 *     dimension: string | null,
 *     path: Array<{ key: string, value: unknown }>,
 *     columns: Array<{ key: string, value: unknown }>
 *   }) => { value: unknown, __count?: number, __valueCount?: number }
 * }} options
 * @returns {{
 *   subtotals: Map<string, Map<string, { value: unknown, __count: number, __valueCount: number }>>,
 *   grand: Map<string, { value: unknown, __count: number, __valueCount: number }> | null,
 *   dimensions: string[],
 *   ignored: string[],
 *   rowChain: string[],
 *   colChain: string[],
 *   measure: { key: string, aggregate: string },
 *   grandTotal: boolean,
 *   skipped: boolean
 * }}
 */
export function rollupRowTotals(cube, options = {}) {
  assertCube(cube);
  const config = normalizeConfig(options);
  const rowDims = axisChain(cube.dimensions, 'row');
  const colDims = axisChain(cube.dimensions, 'col');
  const rowChain = rowDims.map((dim) => dim.key);
  const colChain = colDims.map((dim) => dim.key);

  if (rowChain.length === 0) {
    if (config.subtotals.length > 0) {
      throw new Error('rollupRowTotals: 没有行维度，不能配置行小计');
    }
    return skippedResult(cube, rowChain, colChain);
  }

  for (const key of config.subtotals) {
    if (!rowChain.includes(key)) {
      throw new Error(`rollupRowTotals: 小计维度 ${key} 不在行轴上`);
    }
  }

  const leaf = rowChain[rowChain.length - 1];
  const dimensions = config.subtotals.filter((key) => key !== leaf);
  const ignored = config.subtotals.filter((key) => key === leaf);

  if (cube.rows.length === 0) {
    return skippedResult(cube, rowChain, colChain, ignored);
  }

  const grandTotal = config.grandTotal;
  if (dimensions.length === 0 && !grandTotal) {
    return skippedResult(cube, rowChain, colChain, ignored);
  }

  const reducer = config.reduce ?? builtinReducer(cube.measure);
  const depths = new Map(dimensions.map((key) => [key, rowChain.indexOf(key)]));
  const subtotalBuckets = new Map();
  const grandBuckets = new Map();

  for (const record of cube.rows) {
    const rowValues = rowDims.map((dim) => record[dim.key] ?? null);
    const colValues = colDims.map((dim) => record[dim.key] ?? null);
    const colKey = pathKey(colValues);

    for (const dimension of dimensions) {
      const depth = depths.get(dimension);
      const pathValues = rowValues.slice(0, depth + 1);
      const rowKey = pathKey(pathValues);
      let byColumn = subtotalBuckets.get(rowKey);
      if (!byColumn) {
        byColumn = new Map();
        subtotalBuckets.set(rowKey, byColumn);
      }

      let bucket = byColumn.get(colKey);
      if (!bucket) {
        bucket = {
          dimension,
          path: rowChain.slice(0, depth + 1).map((key, index) => ({
            key,
            value: pathValues[index],
          })),
          columns: colChain.map((key, index) => ({
            key,
            value: colValues[index],
          })),
          records: [],
        };
        byColumn.set(colKey, bucket);
      }
      bucket.records.push(record);
    }

    if (grandTotal) {
      let bucket = grandBuckets.get(colKey);
      if (!bucket) {
        bucket = {
          dimension: null,
          path: [],
          columns: colChain.map((key, index) => ({
            key,
            value: colValues[index],
          })),
          records: [],
        };
        grandBuckets.set(colKey, bucket);
      }
      bucket.records.push(record);
    }
  }

  const subtotals = new Map();
  for (const [rowKey, byColumn] of subtotalBuckets) {
    const results = new Map();
    for (const [colKey, bucket] of byColumn) {
      results.set(colKey, applyReducer(reducer, bucket, cube.measure));
    }
    subtotals.set(rowKey, results);
  }

  let grand = null;
  if (grandTotal) {
    grand = new Map();
    for (const [colKey, bucket] of grandBuckets) {
      grand.set(colKey, applyReducer(reducer, bucket, cube.measure));
    }
  }

  return {
    subtotals,
    grand,
    dimensions,
    ignored,
    rowChain,
    colChain,
    measure: { ...cube.measure },
    grandTotal,
    skipped: false,
  };
}

/**
 * 同时按行、列维度上卷，输出统一汇总立方体。
 *
 * 与 rollupRowTotals 的区别：结果同时包含行小计、列小计、行总计、列总计
 * 以及它们的交叉格。布局层 withTotals() 直接消费这个结果。
 *
 * @param {ReturnType<import('../model/aggregate.mjs').aggregate>} cube
 * @param {{
 *   rows?: { subtotals?: string[], grandTotal?: boolean },
 *   cols?: { subtotals?: string[], grandTotal?: boolean },
 *   reduce?: (records: ReadonlyArray<object>, context: object) =>
 *     { value: unknown, __count?: number, __valueCount?: number }
 * }} options
 * @returns {{
 *   cells: Map<string, Map<string, { value: unknown, __count: number, __valueCount: number }>>,
 *   row: { chain: string[], dimensions: string[], ignored: string[], grandTotal: boolean, paths: Map<string, object> },
 *   col: { chain: string[], dimensions: string[], ignored: string[], grandTotal: boolean, paths: Map<string, object> },
 *   measure: { key: string, aggregate: string },
 *   skipped: boolean
 * }}
 */
export function rollupTotals(cube, options = {}) {
  assertCube(cube);
  const config = normalizeTotalsConfig(options);
  const rowDims = axisChain(cube.dimensions, 'row');
  const colDims = axisChain(cube.dimensions, 'col');
  const rowChain = rowDims.map((dim) => dim.key);
  const colChain = colDims.map((dim) => dim.key);
  const rowAxis = prepareAxisTotals(config.rows, rowChain, '行');
  const colAxis = prepareAxisTotals(config.cols, colChain, '列');

  if (
    cube.rows.length === 0 ||
    (rowAxis.dimensions.length === 0 &&
      !rowAxis.grandTotal &&
      colAxis.dimensions.length === 0 &&
      !colAxis.grandTotal)
  ) {
    return skippedTotalsResult(cube, rowAxis, colAxis);
  }

  const reducer = config.reduce ?? builtinReducer(cube.measure);
  const rowDepths = rowAxis.dimensions.map((key) => ({
    key,
    depth: rowChain.indexOf(key),
  }));
  const colDepths = colAxis.dimensions.map((key) => ({
    key,
    depth: colChain.indexOf(key),
  }));
  const rowPaths = new Map();
  const colPaths = new Map();
  const buckets = new Map();

  for (const record of cube.rows) {
    const rowValues = rowDims.map((dim) => record[dim.key] ?? null);
    const colValues = colDims.map((dim) => record[dim.key] ?? null);
    const rowCandidates = buildRecordPaths(
      rowChain,
      rowValues,
      rowDepths,
      rowAxis.grandTotal,
      rowPaths,
    );
    const colCandidates = buildRecordPaths(
      colChain,
      colValues,
      colDepths,
      colAxis.grandTotal,
      colPaths,
    );

    for (const rowPath of rowCandidates) {
      for (const colPath of colCandidates) {
        // 原始格已经由基础布局提供，只上卷至少带一个小计/总计维度的组合。
        if (rowPath.kind === 'base' && colPath.kind === 'base') continue;

        let byCol = buckets.get(rowPath.key);
        if (!byCol) {
          byCol = new Map();
          buckets.set(rowPath.key, byCol);
        }
        let bucket = byCol.get(colPath.key);
        if (!bucket) {
          bucket = { records: [], rowPath, colPath };
          byCol.set(colPath.key, bucket);
        }
        bucket.records.push(record);
      }
    }
  }

  const cells = new Map();
  for (const [rowKey, byCol] of buckets) {
    const results = new Map();
    for (const [colKey, bucket] of byCol) {
      results.set(colKey, applyTotalsReducer(reducer, bucket, cube.measure));
    }
    cells.set(rowKey, results);
  }

  return {
    cells,
    row: {
      chain: rowChain,
      dimensions: rowAxis.dimensions,
      ignored: rowAxis.ignored,
      grandTotal: rowAxis.grandTotal,
      paths: rowPaths,
    },
    col: {
      chain: colChain,
      dimensions: colAxis.dimensions,
      ignored: colAxis.ignored,
      grandTotal: colAxis.grandTotal,
      paths: colPaths,
    },
    measure: { ...cube.measure },
    skipped: false,
  };
}

/**
 * 同时上卷多个度量，并按 measure 维度分列。
 *
 * 每个度量先按自己的 cube 调用 rollupTotals()，再把列路径追加 measure label，
 * 合并成统一的汇总立方体。列小计/总计由 withTotals() 按 measure 展开。
 *
 * @param {Array<{ label: string, cube: ReturnType<import('../model/aggregate.mjs').aggregate> }>} measures
 * @param {{
 *   rows?: { subtotals?: string[], grandTotal?: boolean },
 *   cols?: { subtotals?: string[], grandTotal?: boolean },
 *   reduce?: (records: ReadonlyArray<object>, context: object) =>
 *     { value: unknown, __count?: number, __valueCount?: number },
 *   measureKey?: string,
 *   valueKey?: string
 * }} options
 * @returns {ReturnType<typeof rollupTotals> & { col: { measure: { key: string, members: string[] } } }}
 */
export function rollupMultiTotals(measures, options = {}) {
  if (!Array.isArray(measures) || measures.length === 0) {
    throw new TypeError('rollupMultiTotals: measures 至少需要一项');
  }

  const measureKey = options.measureKey ?? 'measure';
  const valueKey = options.valueKey ?? 'value';
  if (typeof measureKey !== 'string' || measureKey === '') {
    throw new TypeError('rollupMultiTotals: measureKey 必须是非空字符串');
  }
  if (typeof valueKey !== 'string' || valueKey === '') {
    throw new TypeError('rollupMultiTotals: valueKey 必须是非空字符串');
  }

  const labels = new Set();
  for (const item of measures) {
    if (!item || typeof item !== 'object') {
      throw new TypeError('rollupMultiTotals: 每个度量必须是对象');
    }
    if (typeof item.label !== 'string' || item.label === '') {
      throw new TypeError('rollupMultiTotals: 每个度量必须有非空字符串 label');
    }
    if (labels.has(item.label)) {
      throw new Error(`rollupMultiTotals: 度量 label 重复: ${item.label}`);
    }
    labels.add(item.label);
  }

  const mergedCells = new Map();
  const rowPaths = new Map();
  const colPaths = new Map();
  let rowChain = null;
  let colChain = null;
  let rowDimensions = null;
  let colDimensions = null;
  let rowIgnored = null;
  let colIgnored = null;
  let rowGrand = false;
  let colGrand = false;
  let any = false;

  for (const { label, cube } of measures) {
    const rolled = rollupTotals(cube, {
      rows: options.rows,
      cols: options.cols,
      reduce: options.reduce,
    });

    if (rowChain === null) {
      rowChain = rolled.row.chain;
      colChain = rolled.col.chain;
      rowDimensions = rolled.row.dimensions;
      colDimensions = rolled.col.dimensions;
      rowIgnored = rolled.row.ignored;
      colIgnored = rolled.col.ignored;
      rowGrand = rolled.row.grandTotal;
      colGrand = rolled.col.grandTotal;
    } else {
      assertMultiMeasureChain(rolled.row.chain, rowChain, '行');
      assertMultiMeasureChain(rolled.col.chain, colChain, '列');
    }

    const colKeyMap = new Map();
    for (const [oldKey, path] of rolled.col.paths) {
      const values = [...path.values, label];
      const key = pathKey(values);
      colKeyMap.set(oldKey, key);
      if (!colPaths.has(key)) {
        colPaths.set(key, {
          ...path,
          key,
          values,
          path: [...path.path, { key: measureKey, value: label }],
        });
      }
    }

    for (const [key, path] of rolled.row.paths) {
      if (!rowPaths.has(key)) rowPaths.set(key, path);
    }

    for (const [rowKey, byCol] of rolled.cells) {
      let target = mergedCells.get(rowKey);
      if (!target) {
        target = new Map();
        mergedCells.set(rowKey, target);
      }
      for (const [oldColKey, result] of byCol) {
        const newColKey = colKeyMap.get(oldColKey);
        if (!newColKey) continue;
        target.set(newColKey, result);
        any = true;
      }
    }
  }

  return {
    cells: mergedCells,
    row: {
      chain: rowChain ?? [],
      dimensions: rowDimensions ?? [],
      ignored: rowIgnored ?? [],
      grandTotal: rowGrand,
      paths: rowPaths,
    },
    col: {
      chain: [...(colChain ?? []), measureKey],
      dimensions: colDimensions ?? [],
      ignored: colIgnored ?? [],
      grandTotal: colGrand,
      paths: colPaths,
      measure: {
        key: measureKey,
        members: measures.map((item) => item.label),
      },
    },
    measure: { key: valueKey, aggregate: 'multi' },
    skipped: !any,
  };
}

function assertMultiMeasureChain(actual, expected, axisName) {
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`rollupMultiTotals: ${axisName}轴链不一致`);
  }
}

/**
 * 在基础布局上同时插入行、列小计/总计，返回新的展示布局。
 *
 * 行、列都走父块内小计：父 member 的 size 增加，子层显示“小计”；
 * 总计的深层用占位链填满。交叉格从 rollupTotals() / rollupMultiTotals()
 * 的统一汇总立方体取值；多度量时列汇总按 measure 分列。
 *
 * @param {ReturnType<import('../model/pivot-layout.mjs').layoutPivot>} layout
 * @param {ReturnType<typeof rollupTotals>} rolled
 * @param {{
 *   labels?: {
 *     subtotal?: string | ((value: unknown) => string),
 *     total?: string | (() => string)
 *   }
 * }} options
 * @returns {ReturnType<import('../model/pivot-layout.mjs').layoutPivot>}
 */
export function withTotals(layout, rolled, options = {}) {
  assertLayout(layout);
  assertTotalsRolled(rolled);
  if (rolled.skipped) return layout;
  if (layout.size.rows === 0 || layout.size.cols === 0) return layout;

  assertChain(layout.axes?.row?.chain, rolled.row.chain, '行');
  assertChain(layout.axes?.col?.chain, rolled.col.chain, '列');

  const labels = { ...DEFAULT_TOTALS_LABELS, ...(options.labels ?? {}) };
  const rowSlots = collectAxisSlots(layout.axes?.row, rolled.row, labels);
  const colSlots = collectAxisSlots(layout.axes?.col, rolled.col, labels);
  if (rowSlots.length === 0 && colSlots.length === 0) return layout;

  const newRows = layout.size.rows + rowSlots.length;
  const newCols = layout.size.cols + colSlots.length;
  const mapRow = createOffsetMapper(rowSlots);
  const mapCol = createOffsetMapper(colSlots);

  const originalCells = layout.cells.map((cell) => {
    const x = mapCol(cell.x);
    const y = mapRow(cell.y);
    return { ...cell, key: `${x},${y}`, x, y, vector: [x, y] };
  });

  const rowPositions = [
    ...collectBasePositions(layout.axes?.row, rolled.row.chain).map((position) => ({
      ...position,
      newOffset: mapRow(position.offset),
    })),
    ...rowSlots.map((slot) => slotPosition(slot)),
  ];
  const colPositions = [
    ...collectBasePositions(layout.axes?.col, rolled.col.chain).map((position) => ({
      ...position,
      newOffset: mapCol(position.offset),
    })),
    ...colSlots.map((slot) => slotPosition(slot)),
  ];

  const extraCells = [];
  for (const rowPosition of rowPositions) {
    for (const colPosition of colPositions) {
      if (rowPosition.kind === 'base' && colPosition.kind === 'base') {
        continue;
      }
      const result = rolled.cells
        .get(rowPosition.key)
        ?.get(colPosition.key);
      if (!result) continue;
      extraCells.push(
        makeCrossCell(rowPosition, colPosition, result, rolled.measure),
      );
    }
  }

  const cells = [...originalCells, ...extraCells].sort(
    (a, b) => a.y - b.y || a.x - b.x,
  );
  const cellMap = new Map(cells.map((cell) => [cell.key, cell]));

  const rowLayout = layout.axes?.row;
  const colLayout = layout.axes?.col;
  const rowHeader = rowSlots.length
    ? rebuildAxisHeader(
        rowLayout.header,
        'row',
        0,
        rolled.row.chain,
        rowSlots,
        slotMap(rowSlots),
        totalSlotsOf(rowSlots),
        mapRow,
      )
    : rowLayout?.header ?? null;
  const colHeader = colSlots.length
    ? rebuildAxisHeader(
        colLayout.header,
        'col',
        0,
        rolled.col.chain,
        colSlots,
        slotMap(colSlots),
        totalSlotsOf(colSlots),
        mapCol,
      )
    : colLayout?.header ?? null;

  const axes = { ...layout.axes };
  if (rowLayout) {
    axes.row = {
      ...rowLayout,
      length: newRows,
      header: rowHeader,
    };
  }
  if (colLayout) {
    axes.col = {
      ...colLayout,
      length: newCols,
      header: colHeader,
    };
  }

  return {
    ...layout,
    size: { rows: newRows, cols: newCols },
    cells,
    cellMap,
    axes,
    matrix: null,
    points: [],
    totals: {
      rows: {
        dimensions: [...rolled.row.dimensions],
        grandTotal: Boolean(rolled.row.grandTotal),
      },
      cols: {
        dimensions: [...rolled.col.dimensions],
        grandTotal: Boolean(rolled.col.grandTotal),
      },
    },
    toPixel(cellSize = {}) {
      const width = cellSize.width ?? 1;
      const height = cellSize.height ?? 1;
      return cells.map((cell) => ({
        ...cell,
        px: cell.x * width,
        py: cell.y * height,
      }));
    },
  };
}
/**
 * 在基础布局上插入行小计 / 行总计，返回新的展示布局。
 *
 * 不修改输入 layout；无汇总、无行轴、空数据时原样返回。
 * 这是只含行轴的兼容入口；需要列小计或双轴交叉时用 withTotals()。
 *
 * @param {ReturnType<import('../model/pivot-layout.mjs').layoutPivot>} layout
 * @param {ReturnType<typeof rollupRowTotals>} rolled
 * @param {{
 *   labels?: {
 *     subtotal?: string | ((value: unknown) => string),
 *     total?: string | (() => string)
 *   }
 * }} options
 * @returns {ReturnType<import('../model/pivot-layout.mjs').layoutPivot>}
 */
export function withRowTotals(layout, rolled, options = {}) {
  assertLayout(layout);
  assertRolled(rolled);
  if (rolled.skipped) return layout;
  if (!layout.axes?.row?.header) return layout;
  if (layout.size.rows === 0) return layout;
  if (rolled.dimensions.length === 0 && !rolled.grandTotal) return layout;

  assertChain(layout.axes.row.chain, rolled.rowChain, '行');
  assertChain(layout.axes.col?.chain, rolled.colChain, '列');

  const labels = { ...DEFAULT_TOTALS_LABELS, ...(options.labels ?? {}) };
  const slots = collectSlots(layout, rolled, labels);
  if (slots.length === 0) return layout;

  const newRows = layout.size.rows + slots.length;
  const mapOffset = createOffsetMapper(slots);
  const columnPaths = collectColumnPaths(layout);

  const originalCells = layout.cells.map((cell) => {
    const y = mapOffset(cell.y);
    return { ...cell, key: `${cell.x},${y}`, y, vector: [cell.x, y] };
  });

  const extraCells = [];
  for (const slot of slots) {
    if (slot.kind === 'subtotal') {
      const rowKey = pathKey(slot.path.map((item) => item.value));
      const byColumn = rolled.subtotals.get(rowKey);
      if (!byColumn) continue;

      for (const [colKey, column] of columnPaths) {
        const result = byColumn.get(colKey);
        if (!result) continue;
        extraCells.push(
          makeTotalsCell(
            slot,
            column.x,
            column.values,
            result,
            rolled.measure,
            rolled.colChain,
          ),
        );
      }
    } else if (rolled.grand) {
      for (const [colKey, column] of columnPaths) {
        const result = rolled.grand.get(colKey);
        if (!result) continue;
        extraCells.push(
          makeTotalsCell(
            slot,
            column.x,
            column.values,
            result,
            rolled.measure,
            rolled.colChain,
          ),
        );
      }
    }
  }

  const cells = [...originalCells, ...extraCells].sort(
    (a, b) => a.y - b.y || a.x - b.x,
  );
  const cellMap = new Map(cells.map((cell) => [cell.key, cell]));

  const rowHeader = rebuildAxisHeader(
    layout.axes.row.header,
    'row',
    0,
    layout.axes.row.chain ?? [],
    slots,
    slotMap(slots),
    totalSlotsOf(slots),
    mapOffset,
  );

  return {
    ...layout,
    size: { rows: newRows, cols: layout.size.cols },
    cells,
    cellMap,
    axes: {
      ...layout.axes,
      row: {
        ...layout.axes.row,
        length: newRows,
        header: rowHeader,
      },
    },
    matrix: null,
    points: [],
    totals: {
      dimensions: [...rolled.dimensions],
      grandTotal: Boolean(rolled.grandTotal),
    },
    toPixel(cellSize = {}) {
      const width = cellSize.width ?? 1;
      const height = cellSize.height ?? 1;
      return cells.map((cell) => ({
        ...cell,
        px: cell.x * width,
        py: cell.y * height,
      }));
    },
  };
}

/** 维度值序列的稳定键；上卷和布局派生必须使用同一套规则。 */
export function pathKey(values) {
  if (!Array.isArray(values)) {
    throw new TypeError('pathKey: values 必须是数组');
  }
  return JSON.stringify(values.map(valueKey));
}

/** 内置上卷规则，与核心 aggregate 的语义保持一致。 */
export const ROLLUP_REDUCERS = Object.freeze({
  sum,
  count,
  avg,
  min,
  max,
});

// ---------------------------------------------------------------------------
// 上卷
// ---------------------------------------------------------------------------

function sum(records, { measure }) {
  let value = 0;
  for (const record of records) {
    const current = record[measure.key];
    if (isFiniteNumber(current)) value += current;
  }
  return { value, ...sumMeta(records) };
}

function count(records, { measure }) {
  let value = 0;
  for (const record of records) {
    const current = record[measure.key];
    if (isFiniteNumber(current)) value += current;
  }
  const meta = sumMeta(records);
  return { value, __count: meta.__count, __valueCount: meta.__valueCount };
}

function avg(records, { measure }) {
  let weighted = 0;
  let weight = 0;
  for (const record of records) {
    const current = record[measure.key];
    const valueCount = record.__valueCount;
    if (isFiniteNumber(current) && isFiniteNumber(valueCount) && valueCount > 0) {
      weighted += current * valueCount;
      weight += valueCount;
    }
  }
  const meta = sumMeta(records);
  return {
    value: weight === 0 ? null : weighted / weight,
    __count: meta.__count,
    __valueCount: weight,
  };
}

function min(records, { measure }) {
  let value = null;
  for (const record of records) {
    const current = record[measure.key];
    if (isFiniteNumber(current) && (value === null || current < value)) {
      value = current;
    }
  }
  return { value, ...sumMeta(records) };
}

function max(records, { measure }) {
  let value = null;
  for (const record of records) {
    const current = record[measure.key];
    if (isFiniteNumber(current) && (value === null || current > value)) {
      value = current;
    }
  }
  return { value, ...sumMeta(records) };
}

function applyReducer(reducer, bucket, measure) {
  const result = reducer(bucket.records, {
    measure,
    dimension: bucket.dimension,
    path: bucket.path,
    columns: bucket.columns,
  });

  if (!result || typeof result !== 'object') {
    throw new TypeError('rollupRowTotals: reduce 必须返回对象');
  }

  const meta = sumMeta(bucket.records);
  return {
    value: result.value,
    __count: Number.isFinite(result.__count) ? result.__count : meta.__count,
    __valueCount: Number.isFinite(result.__valueCount)
      ? result.__valueCount
      : meta.__valueCount,
  };
}

function sumMeta(records) {
  let count = 0;
  let valueCount = 0;
  for (const record of records) {
    if (isFiniteNumber(record.__count)) count += record.__count;
    if (isFiniteNumber(record.__valueCount)) {
      valueCount += record.__valueCount;
    }
  }
  return { __count: count, __valueCount: valueCount };
}

function builtinReducer(measure) {
  const reducer = ROLLUP_REDUCERS[measure.aggregate];
  if (!reducer) {
    throw new Error(
      `totals: 不支持的聚合方式 ${measure.aggregate}，请提供 reduce`,
    );
  }
  return reducer;
}

function skippedResult(cube, rowChain, colChain, ignored = []) {
  return {
    subtotals: new Map(),
    grand: null,
    dimensions: [],
    ignored,
    rowChain,
    colChain,
    measure: { ...cube.measure },
    grandTotal: false,
    skipped: true,
  };
}

function normalizeTotalsConfig(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('rollupTotals: options 必须是对象');
  }

  const rows = normalizeTotalsAxis(options.rows, 'rows');
  const cols = normalizeTotalsAxis(options.cols, 'cols');
  if (options.reduce !== undefined && typeof options.reduce !== 'function') {
    throw new TypeError('rollupTotals: options.reduce 必须是函数');
  }

  return { rows, cols, reduce: options.reduce };
}

function normalizeTotalsAxis(raw, name) {
  if (raw === undefined || raw === null) {
    return { subtotals: [], grandTotal: false };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(`rollupTotals: options.${name} 必须是对象`);
  }

  const rawSubtotals = raw.subtotals ?? [];
  if (!Array.isArray(rawSubtotals)) {
    throw new TypeError(`rollupTotals: options.${name}.subtotals 必须是数组`);
  }

  const subtotals = [];
  for (const key of rawSubtotals) {
    if (typeof key !== 'string' || key === '') {
      throw new TypeError('rollupTotals: 小计维度必须是非空字符串');
    }
    if (!subtotals.includes(key)) subtotals.push(key);
  }

  if (
    raw.grandTotal !== undefined &&
    typeof raw.grandTotal !== 'boolean'
  ) {
    throw new TypeError(
      `rollupTotals: options.${name}.grandTotal 必须是布尔值`,
    );
  }

  return { subtotals, grandTotal: raw.grandTotal ?? false };
}

function prepareAxisTotals(axisConfig, chain, axisName) {
  if (chain.length === 0) {
    if (axisConfig.subtotals.length > 0) {
      throw new Error(
        `rollupTotals: 没有${axisName}维度，不能配置${axisName}小计`,
      );
    }
    return { chain, dimensions: [], ignored: [], grandTotal: false };
  }

  for (const key of axisConfig.subtotals) {
    if (!chain.includes(key)) {
      throw new Error(
        `rollupTotals: 小计维度 ${key} 不在${axisName}轴上`,
      );
    }
  }

  const leaf = chain[chain.length - 1];
  return {
    chain,
    dimensions: axisConfig.subtotals.filter((key) => key !== leaf),
    ignored: axisConfig.subtotals.filter((key) => key === leaf),
    grandTotal: axisConfig.grandTotal,
  };
}

function buildRecordPaths(chain, values, subtotalDepths, grandTotal, paths) {
  const candidates = [];
  const base = {
    key: pathKey(values),
    kind: 'base',
    values,
    path: chain.map((key, index) => ({ key, value: values[index] })),
    dimension: null,
  };
  candidates.push(base);
  registerPath(paths, base);

  for (const { key, depth } of subtotalDepths) {
    const prefix = values.slice(0, depth + 1);
    const item = {
      key: pathKey(prefix),
      kind: 'subtotal',
      values: prefix,
      path: chain.slice(0, depth + 1).map((dimKey, index) => ({
        key: dimKey,
        value: prefix[index],
      })),
      dimension: key,
    };
    candidates.push(item);
    registerPath(paths, item);
  }

  if (grandTotal) {
    const item = {
      key: pathKey([]),
      kind: 'total',
      values: [],
      path: [],
      dimension: null,
    };
    candidates.push(item);
    registerPath(paths, item);
  }

  return candidates;
}

function registerPath(paths, item) {
  if (!paths.has(item.key)) paths.set(item.key, item);
}

function applyTotalsReducer(reducer, bucket, measure) {
  const result = reducer(bucket.records, {
    measure,
    dimension:
      bucket.rowPath.kind === 'subtotal' ? bucket.rowPath.dimension : null,
    colDimension:
      bucket.colPath.kind === 'subtotal' ? bucket.colPath.dimension : null,
    path: bucket.rowPath.path,
    columns: bucket.colPath.path,
    rowKind: bucket.rowPath.kind,
    colKind: bucket.colPath.kind,
  });

  if (!result || typeof result !== 'object') {
    throw new TypeError('rollupTotals: reduce 必须返回对象');
  }

  const meta = sumMeta(bucket.records);
  return {
    value: result.value,
    __count: Number.isFinite(result.__count) ? result.__count : meta.__count,
    __valueCount: Number.isFinite(result.__valueCount)
      ? result.__valueCount
      : meta.__valueCount,
  };
}

function skippedTotalsResult(cube, rowAxis, colAxis) {
  return {
    cells: new Map(),
    row: {
      chain: rowAxis.chain,
      dimensions: rowAxis.dimensions,
      ignored: rowAxis.ignored,
      grandTotal: false,
      paths: new Map(),
    },
    col: {
      chain: colAxis.chain,
      dimensions: colAxis.dimensions,
      ignored: colAxis.ignored,
      grandTotal: false,
      paths: new Map(),
    },
    measure: { ...cube.measure },
    skipped: true,
  };
}

// ---------------------------------------------------------------------------
// 布局派生
// ---------------------------------------------------------------------------

function collectSlots(layout, rolled, labels) {
  return collectAxisSlots(layout.axes.row, rolled, labels);
}

function collectAxisSlots(axisLayout, axisRolled, labels) {
  if (!axisLayout?.header) return [];

  const chain = axisLayout.chain ?? [];
  const depthByDimension = new Map();
  for (const key of axisRolled.dimensions) {
    const depth = chain.indexOf(key);
    if (depth >= 0) depthByDimension.set(depth, key);
  }

  const slots = [];
  if (depthByDimension.size > 0) {
    const walk = (node, depth, values) => {
      for (const member of node.members) {
        const nextValues = [...values, member.value];
        const dimension = depthByDimension.get(depth);
        if (dimension) {
          const baseSlot = {
            oldOffset: member.offset + member.size,
            depth,
            dimension,
            path: chain.slice(0, depth + 1).map((key, index) => ({
              key,
              value: nextValues[index],
            })),
            label: subtotalLabel(member.value, labels.subtotal),
            kind: 'subtotal',
          };
          slots.push(...expandMeasureSlot(baseSlot, axisRolled));
        }
        if (member.children) walk(member.children, depth + 1, nextValues);
      }
    };
    walk(axisLayout.header, 0, []);
  }

  if (axisRolled.grandTotal) {
    const baseSlot = {
      oldOffset: axisLayout.length,
      depth: -1,
      dimension: null,
      path: [],
      label: totalLabel(labels.total),
      kind: 'total',
    };
    slots.push(...expandMeasureSlot(baseSlot, axisRolled));
  }

  slots.sort((a, b) => {
    if (a.oldOffset !== b.oldOffset) return a.oldOffset - b.oldOffset;
    if (a.depth !== b.depth) return b.depth - a.depth;
    const kindDiff = kindRank(a.kind) - kindRank(b.kind);
    if (kindDiff !== 0) return kindDiff;
    return (a.order ?? 0) - (b.order ?? 0);
  });
  slots.forEach((slot, index) => {
    slot.newOffset = slot.oldOffset + index;
  });
  return slots;
}

function expandMeasureSlot(slot, axisRolled) {
  const measure = axisRolled.measure;
  if (!measure?.members?.length) return [slot];

  return measure.members.map((label, index) => ({
    ...slot,
    path:
      slot.kind === 'subtotal'
        ? [...slot.path, { key: measure.key, value: label }]
        : [{ key: measure.key, value: label }],
    label: `${slot.label} · ${label}`,
    measure: label,
    order: index,
  }));
}

function createOffsetMapper(slots) {
  return (oldOffset) => {
    let low = 0;
    let high = slots.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (slots[mid].oldOffset <= oldOffset) low = mid + 1;
      else high = mid;
    }
    return oldOffset + low;
  };
}

function slotMap(slots) {
  const map = new Map();
  for (const slot of slots) {
    if (slot.kind === 'total') continue;
    const key = `${slot.depth}|${slot.oldOffset}`;
    const list = map.get(key);
    if (list) list.push(slot);
    else map.set(key, [slot]);
  }
  return map;
}

function totalSlotsOf(slots) {
  return slots.filter((slot) => slot.kind === 'total');
}

function collectBasePositions(axisLayout, chain) {
  if (!axisLayout?.header) {
    return [
      {
        offset: 0,
        values: [],
        path: [],
        key: pathKey([]),
        kind: 'base',
      },
    ];
  }

  const positions = [];
  const walk = (node, values) => {
    for (const member of node.members) {
      const nextValues = [...values, member.value];
      if (member.children) {
        walk(member.children, nextValues);
      } else {
        const itemPath = chain.map((key, index) => ({
          key,
          value: nextValues[index],
        }));
        const key = pathKey(nextValues);
        for (let index = 0; index < member.size; index += 1) {
          positions.push({
            offset: member.offset + index,
            values: nextValues,
            path: itemPath,
            key,
            kind: 'base',
          });
        }
      }
    }
  };
  walk(axisLayout.header, []);
  return positions;
}

function slotPosition(slot) {
  const values = slot.path.map((item) => item.value);
  return {
    key: pathKey(values),
    values,
    path: slot.path,
    kind: slot.kind,
    dimension: slot.dimension,
    newOffset: slot.newOffset,
  };
}

function makeCrossCell(rowPosition, colPosition, result, measure) {
  const members = {};
  for (const item of rowPosition.path) members[item.key] = item.value;
  for (const item of colPosition.path) members[item.key] = item.value;

  const record = {
    ...members,
    [measure.key]: result.value,
    __count: result.__count,
    __valueCount: result.__valueCount,
  };

  const kind =
    rowPosition.kind === 'total' || colPosition.kind === 'total'
      ? 'total'
      : 'subtotal';

  const cell = {
    key: `${colPosition.newOffset},${rowPosition.newOffset}`,
    x: colPosition.newOffset,
    y: rowPosition.newOffset,
    vector: [colPosition.newOffset, rowPosition.newOffset],
    value: result.value,
    members,
    record,
    kind,
    rowGroup: rowPosition.path.map((item) => ({ ...item })),
    colGroup: colPosition.path.map((item) => ({ ...item })),
    rowKind: rowPosition.kind,
    colKind: colPosition.kind,
  };

  const rowDimension =
    rowPosition.kind === 'subtotal' ? rowPosition.dimension : null;
  const colDimension =
    colPosition.kind === 'subtotal' ? colPosition.dimension : null;
  if (rowDimension) cell.rowDimension = rowDimension;
  if (colDimension) cell.colDimension = colDimension;
  const dimension = rowDimension ?? colDimension;
  if (dimension) cell.dimension = dimension;

  return cell;
}

function collectColumnPaths(layout) {
  const paths = new Map();
  const colAxis = layout.axes?.col;
  if (!colAxis?.header) {
    paths.set(pathKey([]), { x: 0, values: [] });
    return paths;
  }

  const walk = (node, values) => {
    for (const member of node.members) {
      const nextValues = [...values, member.value];
      if (member.children) {
        walk(member.children, nextValues);
      } else {
        const key = pathKey(nextValues);
        if (!paths.has(key)) {
          paths.set(key, { x: member.offset, values: nextValues });
        }
      }
    }
  };
  walk(colAxis.header, []);
  return paths;
}

function makeTotalsCell(slot, x, colValues, result, measure, colChain) {
  const members = {};
  for (let index = 0; index < colChain.length; index += 1) {
    members[colChain[index]] = colValues[index];
  }
  for (const item of slot.path) members[item.key] = item.value;

  const record = {
    ...members,
    [measure.key]: result.value,
    __count: result.__count,
    __valueCount: result.__valueCount,
  };

  const cell = {
    key: `${x},${slot.newOffset}`,
    x,
    y: slot.newOffset,
    vector: [x, slot.newOffset],
    value: result.value,
    members,
    record,
    kind: slot.kind,
    rowGroup: slot.path.map((item) => ({ ...item })),
  };
  if (slot.dimension) cell.dimension = slot.dimension;
  return cell;
}

function rebuildAxisHeader(
  node,
  axis,
  depth,
  chain,
  slots,
  slotByKey,
  totalSlots,
  mapOffset,
) {
  const members = [];
  for (const member of node.members) {
    const end = member.offset + member.size;
    const cloned = {
      ...member,
      offset: mapOffset(member.offset),
      size: newMemberSize(member, depth, slots),
    };

    if (member.children) {
      cloned.children = rebuildAxisHeader(
        member.children,
        axis,
        depth + 1,
        chain,
        slots,
        slotByKey,
        [],
        mapOffset,
      );
    }

    const ownerSlots = slotByKey.get(`${depth}|${end}`);
    if (ownerSlots) {
      if (!cloned.children) {
        throw new Error(
          `withTotals: 小计维度 ${ownerSlots[0].dimension} 必须是父维度`,
        );
      }
      cloned.children = {
        ...cloned.children,
        members: [
          ...cloned.children.members,
          ...ownerSlots.map((slot) =>
            makeSubtotalMember(slot, depth + 1, chain, axis),
          ),
        ],
      };
    }

    members.push(cloned);
  }

  if (depth === 0) {
    for (const slot of totalSlots) {
      members.push(makeTotalMember(slot, chain, axis));
    }
  }

  return { ...node, members };
}

/** 父 member 的新 size：原始行 + 内部小计 + 自己的小计行。 */
function newMemberSize(member, depth, slots) {
  const end = member.offset + member.size;
  let size = member.size;

  for (const slot of slots) {
    if (slot.oldOffset > member.offset && slot.oldOffset < end) {
      size += 1;
    } else if (
      slot.oldOffset === end &&
      slot.kind === 'subtotal' &&
      slot.depth >= depth
    ) {
      size += 1;
    }
  }

  return size;
}

function makeSubtotalMember(slot, depth, chain, axis) {
  return {
    value: slot.label,
    index: -1,
    offset: slot.newOffset,
    size: 1,
    children: placeholderChildren(slot, depth + 1, chain, axis),
    kind: 'subtotal',
    dimension: slot.dimension,
  };
}

function makeTotalMember(slot, chain, axis) {
  return {
    value: slot.label,
    index: -1,
    offset: slot.newOffset,
    size: 1,
    children: placeholderChildren(slot, 1, chain, axis),
    kind: 'total',
  };
}

/** 总计/小计占用的深层表头用空单元格填满，避免露出画布背景。 */
function placeholderChildren(slot, depth, chain, axis) {
  if (depth >= chain.length) return null;
  return {
    key: chain[depth],
    axis,
    members: [
      {
        value: '',
        index: -1,
        offset: slot.newOffset,
        size: 1,
        children: placeholderChildren(slot, depth + 1, chain, axis),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 校验与标签
// ---------------------------------------------------------------------------

function normalizeConfig(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('rollupRowTotals: options 必须是对象');
  }

  const rows = options.rows ?? {};
  if (!rows || typeof rows !== 'object' || Array.isArray(rows)) {
    throw new TypeError('rollupRowTotals: options.rows 必须是对象');
  }

  const rawSubtotals = rows.subtotals ?? [];
  if (!Array.isArray(rawSubtotals)) {
    throw new TypeError('rollupRowTotals: options.rows.subtotals 必须是数组');
  }

  const subtotals = [];
  for (const key of rawSubtotals) {
    if (typeof key !== 'string' || key === '') {
      throw new TypeError('rollupRowTotals: 小计维度必须是非空字符串');
    }
    if (!subtotals.includes(key)) subtotals.push(key);
  }

  if (
    rows.grandTotal !== undefined &&
    typeof rows.grandTotal !== 'boolean'
  ) {
    throw new TypeError('rollupRowTotals: options.rows.grandTotal 必须是布尔值');
  }

  if (options.reduce !== undefined && typeof options.reduce !== 'function') {
    throw new TypeError('rollupRowTotals: options.reduce 必须是函数');
  }

  return {
    subtotals,
    grandTotal: rows.grandTotal ?? false,
    reduce: options.reduce,
  };
}

function assertCube(cube) {
  if (
    !cube ||
    typeof cube !== 'object' ||
    !Array.isArray(cube.rows) ||
    !Array.isArray(cube.dimensions) ||
    !cube.measure ||
    typeof cube.measure.key !== 'string' ||
    typeof cube.measure.aggregate !== 'string'
  ) {
    throw new TypeError(
      'rollupRowTotals: cube 必须是 aggregate() 的返回值（缺少 rows / dimensions / measure）',
    );
  }
}

function assertLayout(layout) {
  if (
    !layout ||
    typeof layout !== 'object' ||
    !layout.size ||
    !Array.isArray(layout.cells)
  ) {
    throw new TypeError(
      'withRowTotals: layout 必须是 layoutPivot() 的返回值',
    );
  }
}

function assertRolled(rolled) {
  if (
    !rolled ||
    typeof rolled !== 'object' ||
    !(rolled.subtotals instanceof Map) ||
    !Array.isArray(rolled.rowChain) ||
    !Array.isArray(rolled.colChain) ||
    !rolled.measure
  ) {
    throw new TypeError(
      'withRowTotals: rolled 必须是 rollupRowTotals() 的返回值',
    );
  }
}

function assertTotalsRolled(rolled) {
  if (
    !rolled ||
    typeof rolled !== 'object' ||
    !(rolled.cells instanceof Map) ||
    !rolled.row ||
    !rolled.col ||
    !Array.isArray(rolled.row.chain) ||
    !Array.isArray(rolled.col.chain) ||
    !rolled.measure
  ) {
    throw new TypeError(
      'withTotals: rolled 必须是 rollupTotals() 的返回值',
    );
  }
}

function assertChain(actual, expected, axisName) {
  const left = Array.isArray(actual) ? actual : [];
  if (
    left.length !== expected.length ||
    left.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`withRowTotals: ${axisName}轴链与 rollup 结果不一致`);
  }
}

function subtotalLabel(value, template) {
  if (typeof template === 'function') return String(template(value));
  const text =
    typeof template === 'string' && template !== ''
      ? template
      : DEFAULT_TOTALS_LABELS.subtotal;

  if (value === null || value === undefined) {
    return text.replace('{value}', '').trim() || '小计';
  }
  return text.replace('{value}', String(value));
}

function totalLabel(template) {
  if (typeof template === 'function') return String(template());
  return typeof template === 'string' && template !== ''
    ? template
    : DEFAULT_TOTALS_LABELS.total;
}

function dimensionsOnAxis(dimensions, axis) {
  return dimensions.filter(
    (dimension) =>
      dimension &&
      dimension.axis === axis &&
      typeof dimension.key === 'string' &&
      dimension.key !== '',
  );
}

/** 按 parent 关系还原单链顺序，与 layoutPivot 的 chain 保持对齐。 */
function axisChain(dimensions, axis) {
  const axisDims = dimensionsOnAxis(dimensions, axis);
  if (axisDims.length === 0) return [];

  const roots = axisDims.filter((dimension) => !dimension.parent);
  if (roots.length !== 1) return axisDims;

  const chain = [];
  const seen = new Set();
  let cursor = roots[0];
  while (cursor) {
    if (seen.has(cursor.key)) return axisDims;
    seen.add(cursor.key);
    chain.push(cursor);
    const children = axisDims.filter(
      (dimension) => dimension.parent === cursor.key,
    );
    cursor = children.length === 1 ? children[0] : null;
  }

  return chain.length === axisDims.length ? chain : axisDims;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function kindRank(kind) {
  return kind === 'total' ? 1 : 0;
}
