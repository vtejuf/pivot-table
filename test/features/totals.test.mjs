import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, layoutPivot } from '../../src/model/index.mjs';
import { renderPivot } from '../../src/render/index.mjs';
import { combineMeasures } from '../../src/features/dual-measure.mjs';
import {
  pathKey,
  rollupMultiTotals,
  rollupRowTotals,
  rollupTotals,
  withRowTotals,
  withTotals,
} from '../../src/features/totals.mjs';

const dimensions = [
  { key: 'region', axis: 'row' },
  { key: 'city', axis: 'row', parent: 'region' },
  { key: 'year', axis: 'col', order: 'asc' },
];

const detail = [
  { region: 'east', city: 'hangzhou', year: 2023, sales: 10 },
  { region: 'east', city: 'hangzhou', year: 2024, sales: 20 },
  { region: 'east', city: 'shanghai', year: 2023, sales: 30 },
  { region: 'west', city: 'chengdu', year: 2023, sales: 40 },
];

const gridDimensions = [
  { key: 'region', axis: 'row' },
  { key: 'city', axis: 'row', parent: 'region' },
  { key: 'year', axis: 'col' },
  { key: 'product', axis: 'col', parent: 'year' },
];

const gridDetail = [
  { region: 'east', city: 'hangzhou', year: 2023, product: 'phone', sales: 10 },
  { region: 'east', city: 'hangzhou', year: 2024, product: 'phone', sales: 20 },
  { region: 'east', city: 'shanghai', year: 2023, product: 'laptop', sales: 30 },
  { region: 'west', city: 'chengdu', year: 2023, product: 'phone', sales: 40 },
];

function makeCube(measure = { key: 'sales', aggregate: 'sum' }, rows = detail) {
  return aggregate(rows, { dimensions, measure });
}

function makeBase(cube = makeCube(), mode = 'cartesian') {
  return layoutPivot(cube.rows, {
    dimensions,
    value: cube.measure.key,
    mode,
  });
}

function makeGridCube() {
  return aggregate(gridDetail, {
    dimensions: gridDimensions,
    measure: { key: 'sales', aggregate: 'sum' },
  });
}

function makeGridBase(cube = makeGridCube()) {
  return layoutPivot(cube.rows, {
    dimensions: gridDimensions,
    value: cube.measure.key,
    mode: 'compact',
  });
}

function makeMultiGrid() {
  const sumCube = makeGridCube();
  const countCube = aggregate(gridDetail, { dimensions: gridDimensions });
  const dual = combineMeasures({
    dimensions: gridDimensions,
    measures: [
      { label: 'sales', rows: sumCube.rows, valueField: sumCube.measure.key },
      {
        label: 'count',
        rows: countCube.rows,
        valueField: countCube.measure.key,
      },
    ],
  });
  const base = layoutPivot(dual.rows, {
    dimensions: dual.dimensions,
    value: dual.value,
    mode: 'compact',
  });
  return { sumCube, countCube, dual, base };
}

function createFakeContext() {
  const calls = [];
  const ctx = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    lineWidth: 1,
    save() {
      calls.push({ op: 'save' });
    },
    restore() {
      calls.push({ op: 'restore' });
    },
    beginPath() {
      calls.push({ op: 'beginPath' });
    },
    rect(...args) {
      calls.push({ op: 'rect', args });
    },
    clip() {
      calls.push({ op: 'clip' });
    },
    fillRect(...args) {
      calls.push({ op: 'fillRect', args, fillStyle: ctx.fillStyle });
    },
    strokeRect(...args) {
      calls.push({ op: 'strokeRect', args, strokeStyle: ctx.strokeStyle });
    },
    moveTo(...args) {
      calls.push({ op: 'moveTo', args });
    },
    lineTo(...args) {
      calls.push({ op: 'lineTo', args });
    },
    stroke() {
      calls.push({ op: 'stroke' });
    },
    fillText(...args) {
      calls.push({ op: 'fillText', args });
    },
  };
  return { ctx, calls };
}

function textValues(calls) {
  return calls
    .filter((call) => call.op === 'fillText')
    .map((call) => call.args[0]);
}

function assertHeaderSizes(members, expected) {
  assert.equal(
    members.reduce((sum, member) => sum + member.size, 0),
    expected,
  );
  for (const member of members) {
    if (member.children) {
      assertHeaderSizes(member.children.members, member.size);
    }
  }
}

test('上卷：按 region 生成小计，按列组合保留值', () => {
  const cube = makeCube();
  const rolled = rollupRowTotals(cube, {
    rows: { subtotals: ['region'], grandTotal: true },
  });

  assert.equal(rolled.skipped, false);
  assert.deepEqual(rolled.dimensions, ['region']);
  assert.deepEqual(rolled.ignored, []);
  assert.deepEqual(rolled.rowChain, ['region', 'city']);
  assert.deepEqual(rolled.colChain, ['year']);
  assert.equal(rolled.grandTotal, true);

  const east = rolled.subtotals.get(pathKey(['east']));
  assert.equal(east.get(pathKey([2023])).value, 40);
  assert.equal(east.get(pathKey([2023])).__count, 2);
  assert.equal(east.get(pathKey([2024])).value, 20);

  const west = rolled.subtotals.get(pathKey(['west']));
  assert.equal(west.get(pathKey([2023])).value, 40);
  assert.equal(west.has(pathKey([2024])), false);

  assert.equal(rolled.grand.get(pathKey([2023])).value, 80);
  assert.equal(rolled.grand.get(pathKey([2024])).value, 20);
});

test('维度配置顺序与层级顺序不同也能上卷', () => {
  const shuffled = [
    { key: 'year', axis: 'col' },
    { key: 'city', axis: 'row', parent: 'region' },
    { key: 'region', axis: 'row' },
  ];
  const cube = aggregate(detail, {
    dimensions: shuffled,
    measure: { key: 'sales', aggregate: 'sum' },
  });
  const rolled = rollupRowTotals(cube, {
    rows: { subtotals: ['region'], grandTotal: true },
  });

  assert.deepEqual(rolled.rowChain, ['region', 'city']);
  assert.deepEqual(rolled.colChain, ['year']);
  assert.equal(
    rolled.subtotals.get(pathKey(['east'])).get(pathKey([2023])).value,
    40,
  );

  const base = layoutPivot(cube.rows, {
    dimensions: shuffled,
    value: 'sales',
  });
  const display = withRowTotals(base, rolled);
  assert.equal(display.size.rows, 9);
});

test('叶子维度被忽略，全关直接 skipped', () => {
  const leaf = rollupRowTotals(makeCube(), {
    rows: { subtotals: ['city'] },
  });
  assert.equal(leaf.skipped, true);
  assert.deepEqual(leaf.dimensions, []);
  assert.deepEqual(leaf.ignored, ['city']);

  const off = rollupRowTotals(makeCube(), {});
  assert.equal(off.skipped, true);
  assert.equal(off.subtotals.size, 0);
  assert.equal(off.grand, null);
});

test('只开总计时不生成小计', () => {
  const rolled = rollupRowTotals(makeCube(), {
    rows: { grandTotal: true },
  });

  assert.equal(rolled.skipped, false);
  assert.equal(rolled.subtotals.size, 0);
  assert.equal(rolled.grand.get(pathKey([2023])).value, 80);
  assert.equal(rolled.grand.get(pathKey([2024])).value, 20);
});

test('自定义 reducer 收到分组上下文，且不修改输入记录', () => {
  const cube = makeCube();
  const snapshot = JSON.stringify(cube.rows);
  const calls = [];

  const rolled = rollupRowTotals(cube, {
    rows: { subtotals: ['region'], grandTotal: true },
    reduce(records, context) {
      calls.push({ length: records.length, context });
      return {
        value: records.length,
        __count: records.length,
        __valueCount: records.length,
      };
    },
  });

  assert.equal(JSON.stringify(cube.rows), snapshot);
  assert.ok(calls.some((call) => call.context.dimension === 'region'));
  assert.ok(calls.some((call) => call.context.dimension === null));

  const east2023 = calls.find(
    (call) =>
      call.context.dimension === 'region' &&
      call.context.path[0].value === 'east' &&
      call.context.columns[0].value === 2023,
  );
  assert.ok(east2023);
  assert.equal(east2023.length, 2);
  assert.equal(
    rolled.subtotals.get(pathKey(['east'])).get(pathKey([2023])).value,
    2,
  );
});

test('avg 用 __valueCount 加权，而不是简单平均', () => {
  const avgDetail = [
    { region: 'east', city: 'hangzhou', year: 2023, sales: 10 },
    { region: 'east', city: 'hangzhou', year: 2023, sales: 20 },
    { region: 'east', city: 'shanghai', year: 2023, sales: 30 },
  ];
  const cube = aggregate(avgDetail, {
    dimensions,
    measure: { key: 'sales', aggregate: 'avg' },
  });
  const rolled = rollupRowTotals(cube, {
    rows: { subtotals: ['region'] },
  });

  const result = rolled.subtotals
    .get(pathKey(['east']))
    .get(pathKey([2023]));

  // hangzhou 15（2 条）+ shanghai 30（1 条）=> (15 × 2 + 30) / 3 = 20
  assert.equal(result.value, 20);
  assert.equal(result.__valueCount, 3);
  assert.equal(result.__count, 3);
});

test('min / max 合并子组并跳过空组', () => {
  const minRolled = rollupRowTotals(
    makeCube({ key: 'sales', aggregate: 'min' }),
    { rows: { subtotals: ['region'], grandTotal: true } },
  );
  assert.equal(
    minRolled.subtotals.get(pathKey(['east'])).get(pathKey([2023])).value,
    10,
  );
  assert.equal(minRolled.grand.get(pathKey([2023])).value, 10);

  const maxRolled = rollupRowTotals(
    makeCube({ key: 'sales', aggregate: 'max' }),
    { rows: { subtotals: ['region'], grandTotal: true } },
  );
  assert.equal(
    maxRolled.subtotals.get(pathKey(['east'])).get(pathKey([2023])).value,
    30,
  );
  assert.equal(maxRolled.grand.get(pathKey([2023])).value, 40);
});

test('rollupTotals：列小计/总计按基础行路径上卷', () => {
  const cube = makeGridCube();
  const rolled = rollupTotals(cube, {
    cols: { subtotals: ['year'], grandTotal: true },
  });

  assert.deepEqual(rolled.row.chain, ['region', 'city']);
  assert.deepEqual(rolled.col.chain, ['year', 'product']);
  assert.deepEqual(rolled.row.dimensions, []);
  assert.deepEqual(rolled.col.dimensions, ['year']);
  assert.equal(rolled.col.grandTotal, true);

  const hangzhou = rolled.cells.get(pathKey(['east', 'hangzhou']));
  assert.equal(hangzhou.get(pathKey([2023])).value, 10);
  assert.equal(hangzhou.get(pathKey([2024])).value, 20);
  assert.equal(hangzhou.get(pathKey([])).value, 30);

  const shanghai = rolled.cells.get(pathKey(['east', 'shanghai']));
  assert.equal(shanghai.get(pathKey([2023])).value, 30);
  assert.equal(shanghai.get(pathKey([])).value, 30);

  const chengdu = rolled.cells.get(pathKey(['west', 'chengdu']));
  assert.equal(chengdu.get(pathKey([2023])).value, 40);
  assert.equal(chengdu.has(pathKey([2024])), false);
  assert.equal(chengdu.get(pathKey([])).value, 40);

  // 基础行 × 基础列已经由 layout.cells 提供，不进入汇总表。
  assert.equal(hangzhou.get(pathKey([2023, 'phone'])), undefined);
});

test('rollupTotals：行列小计/总计交叉格', () => {
  const cube = makeGridCube();
  const rolled = rollupTotals(cube, {
    rows: { subtotals: ['region'], grandTotal: true },
    cols: { subtotals: ['year'], grandTotal: true },
  });

  assert.deepEqual(rolled.row.dimensions, ['region']);
  assert.deepEqual(rolled.col.dimensions, ['year']);

  const east2023 = rolled.cells.get(pathKey(['east'])).get(pathKey([2023]));
  assert.equal(east2023.value, 40);
  assert.equal(east2023.__count, 2);
  assert.equal(
    rolled.cells.get(pathKey(['east'])).get(pathKey([])).value,
    60,
  );
  assert.equal(
    rolled.cells.get(pathKey([])).get(pathKey([2023])).value,
    80,
  );
  assert.equal(
    rolled.cells.get(pathKey([])).get(pathKey([2024])).value,
    20,
  );
  assert.equal(rolled.cells.get(pathKey([])).get(pathKey([])).value, 100);
});

test('rollupTotals：自定义 reducer 收到列维度上下文', () => {
  const calls = [];
  const rolled = rollupTotals(makeGridCube(), {
    cols: { subtotals: ['year'], grandTotal: true },
    reduce(records, context) {
      calls.push({ length: records.length, context });
      return { value: records.length };
    },
  });

  const yearSubtotal = calls.find(
    (call) =>
      call.context.colDimension === 'year' &&
      call.context.colKind === 'subtotal' &&
      call.context.rowKind === 'base' &&
      call.context.path[0].value === 'east' &&
      call.context.path[1].value === 'hangzhou',
  );
  assert.ok(yearSubtotal);
  assert.equal(yearSubtotal.length, 1);

  const total = calls.find(
    (call) =>
      call.context.colKind === 'total' &&
      call.context.rowKind === 'base' &&
      call.context.path[0].value === 'east' &&
      call.context.path[1].value === 'hangzhou',
  );
  assert.ok(total);
  assert.equal(total.length, 2);
  assert.equal(
    rolled.cells.get(pathKey(['east', 'hangzhou'])).get(pathKey([])).value,
    2,
  );
});

test('rollupTotals：叶子列维度被忽略', () => {
  const cube = makeGridCube();
  const base = makeGridBase(cube);
  const rolled = rollupTotals(cube, {
    cols: { subtotals: ['product'] },
  });
  assert.equal(rolled.skipped, true);
  assert.deepEqual(rolled.col.dimensions, []);
  assert.deepEqual(rolled.col.ignored, ['product']);
  assert.equal(withTotals(base, rolled), base);
});

test('withTotals：列小计/总计插入列并重建列表头', () => {
  const cube = makeGridCube();
  const base = makeGridBase(cube);
  const rolled = rollupTotals(cube, {
    cols: { subtotals: ['year'], grandTotal: true },
  });
  const display = withTotals(base, rolled);

  assert.equal(base.size.rows, 3);
  assert.equal(base.size.cols, 3);
  assert.equal(display.size.rows, 3);
  assert.equal(display.size.cols, 6);
  assert.equal(display.matrix, null);

  assert.deepEqual(
    display.axes.col.header.members.map((member) => [
      member.value,
      member.offset,
      member.size,
      member.kind ?? null,
    ]),
    [
      [2023, 0, 3, null],
      [2024, 3, 2, null],
      ['总计', 5, 1, 'total'],
    ],
  );

  assert.deepEqual(
    display.axes.col.header.members[0].children.members.map((member) => [
      member.value,
      member.offset,
      member.size,
      member.kind ?? null,
    ]),
    [
      ['phone', 0, 1, null],
      ['laptop', 1, 1, null],
      ['2023 小计', 2, 1, 'subtotal'],
    ],
  );

  const totalMember = display.axes.col.header.members[2];
  assert.equal(totalMember.children.members[0].value, '');
  assert.equal(totalMember.children.members[0].offset, 5);

  // 原始列 0,1 保持，原列 2 被 2023 小计推到 x=3。
  assert.equal(display.cellMap.get('0,0').value, 10);
  assert.equal(display.cellMap.get('3,0').value, 20);

  // 基础行 × 列小计/总计。
  assert.equal(display.cellMap.get('2,0').value, 10);
  assert.equal(display.cellMap.get('4,0').value, 20);
  assert.equal(display.cellMap.get('5,0').value, 30);
  assert.equal(display.cellMap.get('2,1').value, 30);
  assert.equal(display.cellMap.get('2,2').value, 40);
  assert.equal(display.cellMap.get('5,2').value, 40);
  assert.equal(display.cellMap.get('4,2'), undefined);

  assertHeaderSizes(display.axes.row.header.members, display.size.rows);
  assertHeaderSizes(display.axes.col.header.members, display.size.cols);
});

test('withTotals：行列同时汇总并填充交叉格', () => {
  const cube = makeGridCube();
  const base = makeGridBase(cube);
  const before = {
    rows: base.size.rows,
    cols: base.size.cols,
    cells: base.cells.length,
    colHeader: base.axes.col.header.members.map((member) => [
      member.value,
      member.offset,
      member.size,
    ]),
  };
  const rolled = rollupTotals(cube, {
    rows: { subtotals: ['region'], grandTotal: true },
    cols: { subtotals: ['year'], grandTotal: true },
  });
  const display = withTotals(base, rolled);

  assert.equal(base.size.rows, before.rows);
  assert.equal(base.size.cols, before.cols);
  assert.equal(base.cells.length, before.cells);
  assert.deepEqual(
    base.axes.col.header.members.map((member) => [
      member.value,
      member.offset,
      member.size,
    ]),
    before.colHeader,
  );

  assert.equal(display.size.rows, 6);
  assert.equal(display.size.cols, 6);
  assert.deepEqual(
    display.axes.row.header.members.map((member) => [
      member.value,
      member.offset,
      member.size,
    ]),
    [
      ['east', 0, 3],
      ['west', 3, 2],
      ['总计', 5, 1],
    ],
  );
  assert.deepEqual(
    display.axes.col.header.members.map((member) => [
      member.value,
      member.offset,
      member.size,
    ]),
    [
      [2023, 0, 3],
      [2024, 3, 2],
      ['总计', 5, 1],
    ],
  );

  const east2023 = display.cellMap.get('2,2');
  assert.equal(east2023.value, 40);
  assert.equal(east2023.kind, 'subtotal');
  assert.equal(east2023.rowKind, 'subtotal');
  assert.equal(east2023.colKind, 'subtotal');
  assert.equal(east2023.rowDimension, 'region');
  assert.equal(east2023.colDimension, 'year');
  assert.deepEqual(east2023.rowGroup, [{ key: 'region', value: 'east' }]);
  assert.deepEqual(east2023.colGroup, [{ key: 'year', value: 2023 }]);
  assert.deepEqual(east2023.members, { region: 'east', year: 2023 });

  assert.equal(display.cellMap.get('4,2').value, 20);
  assert.equal(display.cellMap.get('2,5').value, 80);
  assert.equal(display.cellMap.get('4,5').value, 20);
  assert.equal(display.cellMap.get('5,2').value, 60);
  assert.equal(display.cellMap.get('5,5').value, 100);
  assert.equal(display.cellMap.get('5,5').kind, 'total');

  // 基础行 × 列小计、行小计 × 基础列。
  assert.equal(display.cellMap.get('2,0').value, 10);
  assert.equal(display.cellMap.get('0,2').value, 10);
  assert.equal(display.cellMap.get('5,0').value, 30);

  assertHeaderSizes(display.axes.row.header.members, display.size.rows);
  assertHeaderSizes(display.axes.col.header.members, display.size.cols);
});

test('withTotals：纯列透视也能插入列汇总', () => {
  const colOnlyDimensions = [
    { key: 'year', axis: 'col' },
    { key: 'product', axis: 'col', parent: 'year' },
  ];
  const colOnlyCube = aggregate(gridDetail, {
    dimensions: colOnlyDimensions,
    measure: { key: 'sales', aggregate: 'sum' },
  });
  const base = layoutPivot(colOnlyCube.rows, {
    dimensions: colOnlyDimensions,
    value: 'sales',
    mode: 'compact',
  });
  const rolled = rollupTotals(colOnlyCube, {
    cols: { subtotals: ['year'], grandTotal: true },
  });
  const display = withTotals(base, rolled);

  assert.equal(base.size.rows, 1);
  assert.equal(display.size.rows, 1);
  assert.ok(display.size.cols > base.size.cols);
  assert.equal(display.axes.row, null);
  assert.equal(display.cellMap.get('2,0').value, 80);
  assert.equal(display.cellMap.get('5,0').value, 100);
  assertHeaderSizes(display.axes.col.header.members, display.size.cols);
});

test('rollupMultiTotals：列小计/总计按 measure 分列', () => {
  const { sumCube, countCube } = makeMultiGrid();
  const rolled = rollupMultiTotals(
    [
      { label: 'sales', cube: sumCube },
      { label: 'count', cube: countCube },
    ],
    {
      rows: { subtotals: ['region'], grandTotal: true },
      cols: { subtotals: ['year'], grandTotal: true },
      measureKey: 'measure',
      valueKey: 'value',
    },
  );

  assert.deepEqual(rolled.row.chain, ['region', 'city']);
  assert.deepEqual(rolled.col.chain, ['year', 'product', 'measure']);
  assert.deepEqual(rolled.col.dimensions, ['year']);
  assert.deepEqual(rolled.col.measure.members, ['sales', 'count']);
  assert.equal(rolled.skipped, false);

  const hangzhou = rolled.cells.get(pathKey(['east', 'hangzhou']));
  // 基础格 × 基础列仍由 layout.cells 提供，不在汇总表里。
  assert.equal(hangzhou.get(pathKey([2023, 'phone', 'sales'])), undefined);
  assert.equal(hangzhou.get(pathKey([2023, 'sales'])).value, 10);
  assert.equal(hangzhou.get(pathKey([2023, 'count'])).value, 1);
  assert.equal(hangzhou.get(pathKey(['sales'])).value, 30);
  assert.equal(hangzhou.get(pathKey(['count'])).value, 2);

  assert.equal(
    rolled.cells.get(pathKey(['east'])).get(pathKey([2023, 'sales'])).value,
    40,
  );
  assert.equal(
    rolled.cells.get(pathKey(['east'])).get(pathKey([2023, 'count'])).value,
    2,
  );
  assert.equal(
    rolled.cells.get(pathKey([])).get(pathKey(['sales'])).value,
    100,
  );
  assert.equal(
    rolled.cells.get(pathKey([])).get(pathKey(['count'])).value,
    4,
  );
  // 不同度量不能汇总成一个全局值。
  assert.equal(rolled.cells.get(pathKey([])).get(pathKey([])), undefined);
});

test('withTotals：多度量列汇总按 measure 分列', () => {
  const { sumCube, countCube, base } = makeMultiGrid();
  const rolled = rollupMultiTotals(
    [
      { label: 'sales', cube: sumCube },
      { label: 'count', cube: countCube },
    ],
    {
      rows: { subtotals: ['region'], grandTotal: true },
      cols: { subtotals: ['year'], grandTotal: true },
      measureKey: 'measure',
      valueKey: 'value',
    },
  );
  const display = withTotals(base, rolled);

  assert.equal(base.size.rows, 3);
  assert.equal(base.size.cols, 6);
  assert.equal(display.size.rows, 6);
  assert.equal(display.size.cols, 12);

  assert.deepEqual(
    display.axes.col.header.members.map((member) => [
      member.value,
      member.offset,
      member.size,
      member.kind ?? null,
    ]),
    [
      [2023, 0, 6, null],
      [2024, 6, 4, null],
      ['总计 · sales', 10, 1, 'total'],
      ['总计 · count', 11, 1, 'total'],
    ],
  );

  assert.deepEqual(
    display.axes.col.header.members[0].children.members.map((member) => [
      member.value,
      member.offset,
      member.size,
      member.kind ?? null,
    ]),
    [
      ['phone', 0, 2, null],
      ['laptop', 2, 2, null],
      ['2023 小计 · sales', 4, 1, 'subtotal'],
      ['2023 小计 · count', 5, 1, 'subtotal'],
    ],
  );

  assert.equal(display.cellMap.get('4,0').value, 10);
  assert.equal(display.cellMap.get('5,0').value, 1);
  assert.equal(display.cellMap.get('0,2').value, 10);
  assert.equal(display.cellMap.get('1,2').value, 1);
  assert.equal(display.cellMap.get('0,2').members.measure, 'sales');
  assert.equal(display.cellMap.get('1,2').members.measure, 'count');
  assert.equal(display.cellMap.get('4,2').value, 40);
  assert.equal(display.cellMap.get('5,2').value, 2);
  assert.equal(display.cellMap.get('4,2').members.measure, 'sales');
  assert.equal(display.cellMap.get('5,2').members.measure, 'count');
  assert.equal(display.cellMap.get('10,5').value, 100);
  assert.equal(display.cellMap.get('11,5').value, 4);

  assertHeaderSizes(display.axes.row.header.members, display.size.rows);
  assertHeaderSizes(display.axes.col.header.members, display.size.cols);

  const { ctx, calls } = createFakeContext();
  renderPivot(ctx, display);
  const texts = textValues(calls);
  assert.ok(texts.includes('2023 小计 · sales'));
  assert.ok(texts.includes('2023 小计 · count'));
  assert.ok(texts.includes('总计 · sales'));
  assert.ok(texts.includes('总计 · count'));
});

test('withTotals：展示布局可以直接渲染行/列汇总', () => {
  const cube = makeGridCube();
  const display = withTotals(
    makeGridBase(cube),
    rollupTotals(cube, {
      rows: { subtotals: ['region'], grandTotal: true },
      cols: { subtotals: ['year'], grandTotal: true },
    }),
  );
  const { ctx, calls } = createFakeContext();
  const { stats } = renderPivot(ctx, display);
  const texts = textValues(calls);

  assert.equal(stats.cellsInGrid, 36);
  assert.equal(stats.drawnValues, 26);
  assert.ok(texts.includes('east 小计'));
  assert.ok(texts.includes('2023 小计'));
  assert.ok(texts.includes('总计'));
  assert.ok(texts.includes('40'));
  assert.ok(texts.includes('100'));
});

test('withTotals：只开行汇总时与行布局一致', () => {
  const cube = makeCube();
  const base = makeBase(cube);
  const rowDisplay = withRowTotals(
    base,
    rollupRowTotals(cube, {
      rows: { subtotals: ['region'], grandTotal: true },
    }),
  );
  const display = withTotals(
    base,
    rollupTotals(cube, {
      rows: { subtotals: ['region'], grandTotal: true },
    }),
  );

  assert.equal(display.size.rows, rowDisplay.size.rows);
  assert.equal(display.size.cols, rowDisplay.size.cols);
  assert.deepEqual(display.axes.row.header, rowDisplay.axes.row.header);
  assert.deepEqual(display.axes.col, rowDisplay.axes.col);

  for (const cell of rowDisplay.cells) {
    const other = display.cellMap.get(cell.key);
    assert.ok(other, `缺少单元格 ${cell.key}`);
    assert.equal(other.value, cell.value);
    assert.equal(other.kind, cell.kind);
  }
});

test('withRowTotals 插入小计/总计行并重建表头', () => {
  const cube = makeCube();
  const base = makeBase(cube);
  const rolled = rollupRowTotals(cube, {
    rows: { subtotals: ['region'], grandTotal: true },
  });
  const display = withRowTotals(base, rolled);

  assert.equal(display.size.rows, 9);
  assert.equal(display.size.cols, 2);
  assert.equal(display.axes.row.length, 9);
  assert.equal(display.matrix, null);
  assert.deepEqual(display.points, []);
  assert.equal(display.cells.length, 9);

  assert.deepEqual(
    display.axes.row.header.members.map((member) => [
      member.value,
      member.offset,
      member.size,
      member.kind ?? null,
    ]),
    [
      ['east', 0, 4, null],
      ['west', 4, 4, null],
      ['总计', 8, 1, 'total'],
    ],
  );

  assert.deepEqual(
    display.axes.row.header.members[0].children.members.map((member) => [
      member.value,
      member.offset,
      member.size,
      member.kind ?? null,
    ]),
    [
      ['hangzhou', 0, 1, null],
      ['shanghai', 1, 1, null],
      ['chengdu', 2, 1, null],
      ['east 小计', 3, 1, 'subtotal'],
    ],
  );

  assert.deepEqual(
    display.axes.row.header.members[1].children.members.map((member) => [
      member.value,
      member.offset,
      member.size,
      member.kind ?? null,
    ]),
    [
      ['hangzhou', 4, 1, null],
      ['shanghai', 5, 1, null],
      ['chengdu', 6, 1, null],
      ['west 小计', 7, 1, 'subtotal'],
    ],
  );

  const totalMember = display.axes.row.header.members[2];
  assert.equal(totalMember.children.members[0].value, '');
  assert.equal(totalMember.children.members[0].offset, 8);
  assert.equal(totalMember.children.members[0].size, 1);
  assertHeaderSizes(display.axes.row.header.members, display.size.rows);

  const east2023 = display.cellMap.get('0,3');
  assert.equal(east2023.value, 40);
  assert.equal(east2023.kind, 'subtotal');
  assert.equal(east2023.dimension, 'region');
  assert.deepEqual(east2023.rowGroup, [{ key: 'region', value: 'east' }]);
  assert.equal(display.cellMap.get('1,3').value, 20);

  assert.equal(display.cellMap.get('0,7').value, 40);
  assert.equal(display.cellMap.get('1,7'), undefined);

  assert.equal(display.cellMap.get('0,8').value, 80);
  assert.equal(display.cellMap.get('1,8').value, 20);
  assert.equal(display.cellMap.get('0,8').kind, 'total');

  // 原始 west/chengdu/2023（原 y=5）被推到 y=6
  assert.equal(display.cellMap.get('0,6').value, 40);
  assert.equal(display.cellMap.get('0,6').kind, undefined);

  const pixels = display.toPixel({ width: 10, height: 20 });
  assert.equal(pixels.length, 9);
  assert.equal(pixels.find((cell) => cell.x === 0 && cell.y === 8).py, 160);
});

test('布局派生：只开总计或只开小计', () => {
  const cube = makeCube();
  const base = makeBase(cube);

  const onlyTotal = withRowTotals(
    base,
    rollupRowTotals(cube, { rows: { grandTotal: true } }),
  );
  assert.equal(onlyTotal.size.rows, 7);
  assert.deepEqual(
    onlyTotal.axes.row.header.members.map((member) => [
      member.value,
      member.offset,
      member.size,
      member.kind ?? null,
    ]),
    [
      ['east', 0, 3, null],
      ['west', 3, 3, null],
      ['总计', 6, 1, 'total'],
    ],
  );
  assert.equal(
    onlyTotal.axes.row.header.members[2].children.members[0].value,
    '',
  );
  assert.equal(onlyTotal.cellMap.get('0,6').value, 80);
  assertHeaderSizes(
    onlyTotal.axes.row.header.members,
    onlyTotal.size.rows,
  );

  const onlySubtotal = withRowTotals(
    base,
    rollupRowTotals(cube, { rows: { subtotals: ['region'] } }),
  );
  assert.equal(onlySubtotal.size.rows, 8);
  assert.deepEqual(
    onlySubtotal.axes.row.header.members.map((member) => [
      member.value,
      member.offset,
      member.size,
      member.kind ?? null,
    ]),
    [
      ['east', 0, 4, null],
      ['west', 4, 4, null],
    ],
  );
  assert.equal(
    onlySubtotal.axes.row.header.members[0].children.members[3].value,
    'east 小计',
  );
  assert.equal(onlySubtotal.cellMap.get('0,3').value, 40);
  assertHeaderSizes(
    onlySubtotal.axes.row.header.members,
    onlySubtotal.size.rows,
  );
});

test('三层行轴：小计和总计的深层表头都被占位填满', () => {
  const deepDimensions = [
    { key: 'region', axis: 'row' },
    { key: 'city', axis: 'row', parent: 'region' },
    { key: 'store', axis: 'row', parent: 'city' },
    { key: 'year', axis: 'col' },
  ];
  const deepDetail = [
    { region: 'east', city: 'hangzhou', store: 'A', year: 2023, sales: 10 },
    { region: 'east', city: 'hangzhou', store: 'B', year: 2023, sales: 20 },
    { region: 'west', city: 'chengdu', store: 'C', year: 2023, sales: 30 },
  ];
  const deepCube = aggregate(deepDetail, {
    dimensions: deepDimensions,
    measure: { key: 'sales', aggregate: 'sum' },
  });
  const deepBase = layoutPivot(deepCube.rows, {
    dimensions: deepDimensions,
    value: 'sales',
    mode: 'compact',
  });
  const deepRolled = rollupRowTotals(deepCube, {
    rows: { subtotals: ['region'], grandTotal: true },
  });
  const deepDisplay = withRowTotals(deepBase, deepRolled);

  assert.equal(deepBase.size.rows, 3);
  assert.equal(deepDisplay.size.rows, 6);
  assert.equal(deepDisplay.cellMap.get('0,2').value, 30);
  assert.equal(deepDisplay.cellMap.get('0,3').value, 30);
  assert.equal(deepDisplay.cellMap.get('0,4').value, 30);
  assert.equal(deepDisplay.cellMap.get('0,5').value, 60);

  const rootMembers = deepDisplay.axes.row.header.members;
  assert.deepEqual(
    rootMembers.map((member) => [
      member.value,
      member.offset,
      member.size,
      member.kind ?? null,
    ]),
    [
      ['east', 0, 3, null],
      ['west', 3, 2, null],
      ['总计', 5, 1, 'total'],
    ],
  );

  const eastChildren = rootMembers[0].children.members;
  assert.deepEqual(
    eastChildren.map((member) => [
      member.value,
      member.offset,
      member.size,
      member.kind ?? null,
    ]),
    [
      ['hangzhou', 0, 2, null],
      ['east 小计', 2, 1, 'subtotal'],
    ],
  );

  const subtotalMember = eastChildren[1];
  assert.equal(subtotalMember.children.key, 'store');
  assert.equal(subtotalMember.children.members[0].value, '');
  assert.equal(subtotalMember.children.members[0].offset, 2);

  const totalChildren = rootMembers[2].children.members;
  assert.equal(totalChildren[0].value, '');
  assert.equal(totalChildren[0].offset, 5);
  assert.equal(totalChildren[0].children.members[0].value, '');
  assert.equal(totalChildren[0].children.members[0].offset, 5);

  assertHeaderSizes(rootMembers, deepDisplay.size.rows);
});

test('多层小计：父块嵌套时表头 size 仍然连续', () => {
  const deepDimensions = [
    { key: 'region', axis: 'row' },
    { key: 'city', axis: 'row', parent: 'region' },
    { key: 'store', axis: 'row', parent: 'city' },
    { key: 'year', axis: 'col' },
  ];
  const deepDetail = [
    { region: 'east', city: 'hangzhou', store: 'A', year: 2023, sales: 10 },
    { region: 'east', city: 'hangzhou', store: 'B', year: 2023, sales: 20 },
    { region: 'west', city: 'chengdu', store: 'C', year: 2023, sales: 30 },
  ];
  const deepCube = aggregate(deepDetail, {
    dimensions: deepDimensions,
    measure: { key: 'sales', aggregate: 'sum' },
  });
  const deepBase = layoutPivot(deepCube.rows, {
    dimensions: deepDimensions,
    value: 'sales',
    mode: 'compact',
  });
  const deepRolled = rollupRowTotals(deepCube, {
    rows: { subtotals: ['region', 'city'], grandTotal: true },
  });
  const deepDisplay = withRowTotals(deepBase, deepRolled);

  assert.equal(deepDisplay.size.rows, 8);
  assert.equal(deepDisplay.cellMap.get('0,2').value, 30);
  assert.equal(deepDisplay.cellMap.get('0,3').value, 30);
  assert.equal(deepDisplay.cellMap.get('0,5').value, 30);
  assert.equal(deepDisplay.cellMap.get('0,6').value, 30);
  assert.equal(deepDisplay.cellMap.get('0,7').value, 60);

  const rootMembers = deepDisplay.axes.row.header.members;
  assert.deepEqual(
    rootMembers.map((member) => [
      member.value,
      member.offset,
      member.size,
      member.kind ?? null,
    ]),
    [
      ['east', 0, 4, null],
      ['west', 4, 3, null],
      ['总计', 7, 1, 'total'],
    ],
  );

  const eastChildren = rootMembers[0].children.members;
  assert.deepEqual(
    eastChildren.map((member) => [
      member.value,
      member.offset,
      member.size,
      member.kind ?? null,
    ]),
    [
      ['hangzhou', 0, 3, null],
      ['east 小计', 3, 1, 'subtotal'],
    ],
  );

  const hangzhouChildren = eastChildren[0].children.members;
  assert.deepEqual(
    hangzhouChildren.map((member) => [
      member.value,
      member.offset,
      member.size,
      member.kind ?? null,
    ]),
    [
      ['A', 0, 1, null],
      ['B', 1, 1, null],
      ['hangzhou 小计', 2, 1, 'subtotal'],
    ],
  );

  assertHeaderSizes(rootMembers, deepDisplay.size.rows);
});

test('withRowTotals 不修改输入布局', () => {
  const cube = makeCube();
  const base = makeBase(cube);
  const before = {
    rows: base.size.rows,
    cols: base.size.cols,
    cells: base.cells.length,
    firstCell: { ...base.cells[0] },
    header: base.axes.row.header.members.map((member) => [
      member.value,
      member.offset,
      member.size,
    ]),
  };

  withRowTotals(
    base,
    rollupRowTotals(cube, {
      rows: { subtotals: ['region'], grandTotal: true },
    }),
  );

  assert.equal(base.size.rows, before.rows);
  assert.equal(base.size.cols, before.cols);
  assert.equal(base.cells.length, before.cells);
  assert.deepEqual({ ...base.cells[0] }, before.firstCell);
  assert.deepEqual(
    base.axes.row.header.members.map((member) => [
      member.value,
      member.offset,
      member.size,
    ]),
    before.header,
  );
});

test('无汇总时 withRowTotals 原样返回输入布局', () => {
  const cube = makeCube();
  const base = makeBase(cube);
  const rolled = rollupRowTotals(cube, {});
  assert.equal(withRowTotals(base, rolled), base);
});

test('compact 布局也能正确插入行汇总', () => {
  const rowOnlyDimensions = [
    { key: 'region', axis: 'row' },
    { key: 'city', axis: 'row', parent: 'region' },
  ];
  const cube = aggregate(detail, {
    dimensions: rowOnlyDimensions,
    measure: { key: 'sales', aggregate: 'sum' },
  });
  const base = layoutPivot(cube.rows, {
    dimensions: rowOnlyDimensions,
    value: 'sales',
    mode: 'compact',
  });
  const rolled = rollupRowTotals(cube, {
    rows: { subtotals: ['region'], grandTotal: true },
  });
  const display = withRowTotals(base, rolled);

  assert.equal(base.size.rows, 3);
  assert.equal(display.size.rows, 6);
  assert.equal(display.size.cols, 1);
  assert.equal(display.cellMap.get('0,2').value, 60);
  assert.equal(display.cellMap.get('0,3').value, 40);
  assert.equal(display.cellMap.get('0,4').value, 40);
  assert.equal(display.cellMap.get('0,5').value, 100);
});

test('空数据、纯列透视和轴链不一致的边界', () => {
  const emptyDimensions = [{ key: 'region', axis: 'row' }];
  const emptyCube = aggregate([], {
    dimensions: emptyDimensions,
    measure: { key: 'sales', aggregate: 'sum' },
  });
  const emptyLayout = layoutPivot(emptyCube.rows, {
    dimensions: emptyDimensions,
    value: 'sales',
  });
  const emptyRolled = rollupRowTotals(emptyCube, {
    rows: { subtotals: ['region'], grandTotal: true },
  });
  assert.equal(emptyRolled.skipped, true);
  assert.equal(withRowTotals(emptyLayout, emptyRolled), emptyLayout);

  const colOnlyDimensions = [{ key: 'year', axis: 'col' }];
  const colCube = aggregate(
    [{ year: 2023, sales: 1 }],
    {
      dimensions: colOnlyDimensions,
      measure: { key: 'sales', aggregate: 'sum' },
    },
  );
  const colLayout = layoutPivot(colCube.rows, {
    dimensions: colOnlyDimensions,
    value: 'sales',
  });
  assert.throws(
    () => rollupRowTotals(colCube, { rows: { subtotals: ['year'] } }),
    /没有行维度/,
  );
  assert.equal(withRowTotals(colLayout, rollupRowTotals(colCube, {})), colLayout);

  const cube = makeCube();
  const base = makeBase(cube);
  const rolled = rollupRowTotals(cube, {
    rows: { subtotals: ['region'], grandTotal: true },
  });
  assert.throws(
    () => withRowTotals(base, { ...rolled, rowChain: ['city', 'region'] }),
    /行轴链/,
  );
});

test('自定义标签替换默认文案', () => {
  const cube = makeCube();
  const display = withRowTotals(
    makeBase(cube),
    rollupRowTotals(cube, {
      rows: { subtotals: ['region'], grandTotal: true },
    }),
    {
      labels: {
        subtotal: (value) => `${value} 汇总`,
        total: '全部',
      },
    },
  );

  assert.equal(display.axes.row.header.members[0].value, 'east');
  assert.equal(
    display.axes.row.header.members[0].children.members[3].value,
    'east 汇总',
  );
  assert.equal(display.axes.row.header.members[2].value, '全部');
});

test('展示布局可以直接交给 renderPivot', () => {
  const cube = makeCube();
  const display = withRowTotals(
    makeBase(cube),
    rollupRowTotals(cube, {
      rows: { subtotals: ['region'], grandTotal: true },
    }),
  );
  const { ctx, calls } = createFakeContext();
  const { stats } = renderPivot(ctx, display);
  const texts = textValues(calls);

  assert.equal(stats.cellsInGrid, 18);
  assert.equal(stats.drawnValues, 9);
  assert.ok(texts.includes('east 小计'));
  assert.ok(texts.includes('总计'));
  assert.ok(texts.includes('40'));
  assert.ok(texts.includes('80'));
});
