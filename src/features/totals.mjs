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
 * 在基础布局上插入行小计 / 行总计，返回新的展示布局。
 *
 * 不修改输入 layout；无汇总、无行轴、空数据时原样返回。
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

  const slotByKey = new Map();
  let totalSlot = null;
  for (const slot of slots) {
    if (slot.kind === 'total') totalSlot = slot;
    else slotByKey.set(`${slot.depth}|${slot.oldOffset}`, slot);
  }

  const rowHeader = rebuildRowHeader(
    layout.axes.row.header,
    0,
    slotByKey,
    totalSlot,
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
      `rollupRowTotals: 不支持的聚合方式 ${measure.aggregate}，请提供 reduce`,
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

// ---------------------------------------------------------------------------
// 布局派生
// ---------------------------------------------------------------------------

function collectSlots(layout, rolled, labels) {
  const rowChain = layout.axes.row.chain ?? [];
  const depthByDimension = new Map();
  for (const key of rolled.dimensions) {
    const depth = rowChain.indexOf(key);
    if (depth >= 0) depthByDimension.set(depth, key);
  }

  const slots = [];
  if (depthByDimension.size > 0) {
    const walk = (node, depth, values) => {
      for (const member of node.members) {
        const nextValues = [...values, member.value];
        const dimension = depthByDimension.get(depth);
        if (dimension) {
          slots.push({
            oldOffset: member.offset + member.size,
            depth,
            dimension,
            path: rowChain.slice(0, depth + 1).map((key, index) => ({
              key,
              value: nextValues[index],
            })),
            label: subtotalLabel(member.value, labels.subtotal),
            kind: 'subtotal',
          });
        }
        if (member.children) walk(member.children, depth + 1, nextValues);
      }
    };
    walk(layout.axes.row.header, 0, []);
  }

  if (rolled.grandTotal) {
    slots.push({
      oldOffset: layout.size.rows,
      depth: -1,
      dimension: null,
      path: [],
      label: totalLabel(labels.total),
      kind: 'total',
    });
  }

  slots.sort((a, b) => {
    if (a.oldOffset !== b.oldOffset) return a.oldOffset - b.oldOffset;
    if (a.depth !== b.depth) return b.depth - a.depth;
    return kindRank(a.kind) - kindRank(b.kind);
  });
  slots.forEach((slot, index) => {
    slot.newOffset = slot.oldOffset + index;
  });
  return slots;
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

function rebuildRowHeader(node, depth, slotByKey, totalSlot, mapOffset) {
  const members = [];
  for (const member of node.members) {
    const cloned = {
      ...member,
      offset: mapOffset(member.offset),
    };
    if (member.children) {
      cloned.children = rebuildRowHeader(
        member.children,
        depth + 1,
        slotByKey,
        null,
        mapOffset,
      );
    }
    members.push(cloned);

    const slot = slotByKey.get(`${depth}|${member.offset + member.size}`);
    if (slot) {
      members.push({
        value: slot.label,
        index: -1,
        offset: slot.newOffset,
        size: 1,
        children: null,
        kind: slot.kind,
        dimension: slot.dimension,
      });
    }
  }

  if (depth === 0 && totalSlot) {
    members.push({
      value: totalSlot.label,
      index: -1,
      offset: totalSlot.newOffset,
      size: 1,
      children: null,
      kind: 'total',
    });
  }

  return { ...node, members };
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
