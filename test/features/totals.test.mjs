import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, layoutPivot } from '../../src/model/index.mjs';
import { renderPivot } from '../../src/render/index.mjs';
import {
  pathKey,
  rollupRowTotals,
  withRowTotals,
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
      ['east', 0, 3, null],
      ['east 小计', 3, 1, 'subtotal'],
      ['west', 4, 3, null],
      ['west 小计', 7, 1, 'subtotal'],
      ['总计', 8, 1, 'total'],
    ],
  );

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
  assert.equal(onlyTotal.cellMap.get('0,6').value, 80);

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
      ['east', 0, 3, null],
      ['east 小计', 3, 1, 'subtotal'],
      ['west', 4, 3, null],
      ['west 小计', 7, 1, 'subtotal'],
    ],
  );
  assert.equal(onlySubtotal.cellMap.get('0,3').value, 40);
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

  assert.equal(display.axes.row.header.members[1].value, 'east 汇总');
  assert.equal(display.axes.row.header.members[4].value, '全部');
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
