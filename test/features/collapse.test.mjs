import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, layoutPivot } from '../../src/model/index.mjs';
import { computePivotGeometry } from '../../src/render/index.mjs';
import {
  COLLAPSED_VALUE,
  collapseCube,
  collapseKey,
  drawCollapseIndicators,
  hitTestHeader,
} from '../../src/features/collapse.mjs';

const dimensions = [
  { key: 'region', axis: 'row' },
  { key: 'city', axis: 'row', parent: 'region' },
  { key: 'year', axis: 'col', order: 'asc' },
];

const rows = [
  { region: 'east', city: 'hangzhou', year: 2023, sales: 10 },
  { region: 'east', city: 'hangzhou', year: 2024, sales: 20 },
  { region: 'east', city: 'shanghai', year: 2023, sales: 30 },
  { region: 'west', city: 'chengdu', year: 2023, sales: 40 },
];

function makeCube(measure = { key: 'sales', aggregate: 'sum' }) {
  return aggregate(rows, { dimensions, measure });
}

function makeLayout(source) {
  return layoutPivot(source.rows, {
    dimensions: source.dimensions,
    value: 'sales',
    mode: 'compact',
  });
}

function createFakeContext() {
  const calls = [];
  const ctx = {
    fillStyle: '#000000',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
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
    fillText(...args) {
      calls.push({ op: 'fillText', args, fillStyle: ctx.fillStyle });
    },
  };
  return { ctx, calls };
}

test('折叠行成员时按父级重新上卷，并保留“全部”子成员', () => {
  const cube = makeCube();
  const collapsed = new Set([collapseKey('row', 'region', 'east')]);
  const result = collapseCube(cube, collapsed);

  assert.equal(result.changed, true);
  assert.equal(result.rows.length, 3);

  const east2023 = result.rows.find((row) => row.year === 2023 && row.region === 'east');
  assert.equal(east2023.city, COLLAPSED_VALUE);
  assert.equal(east2023.sales, 40);
  assert.equal(east2023.__count, 2);
  assert.equal(east2023.__valueCount, 2);

  const east2024 = result.rows.find((row) => row.year === 2024 && row.region === 'east');
  assert.equal(east2024.city, COLLAPSED_VALUE);
  assert.equal(east2024.sales, 20);

  const west = result.rows.find((row) => row.region === 'west');
  assert.equal(west.city, 'chengdu');
  assert.equal(west.sales, 40);

  const layout = makeLayout(result);
  assert.equal(layout.size.rows, 2);
  assert.equal(layout.size.cols, 2);
  assert.deepEqual(
    layout.cells.map((cell) => [cell.members.region, cell.value]),
    [
      ['east', 40],
      ['east', 20],
      ['west', 40],
    ],
  );
});

test('折叠列成员时按列父级重新上卷', () => {
  const colDimensions = [
    { key: 'region', axis: 'row' },
    { key: 'year', axis: 'col', order: 'asc' },
    { key: 'product', axis: 'col', parent: 'year' },
  ];
  const colRows = [
    { region: 'east', year: 2023, product: 'phone', sales: 10 },
    { region: 'east', year: 2023, product: 'laptop', sales: 20 },
    { region: 'east', year: 2024, product: 'phone', sales: 30 },
    { region: 'west', year: 2023, product: 'phone', sales: 40 },
  ];
  const cube = aggregate(colRows, {
    dimensions: colDimensions,
    measure: { key: 'sales', aggregate: 'sum' },
  });
  const result = collapseCube(cube, new Set([collapseKey('col', 'year', 2023)]));

  assert.equal(result.changed, true);
  const collapsed = result.rows.filter((row) => row.year === 2023);
  assert.ok(collapsed.every((row) => row.product === COLLAPSED_VALUE));
  assert.deepEqual(
    collapsed.map((row) => [row.region, row.sales]).sort(),
    [
      ['east', 30],
      ['west', 40],
    ],
  );

  const layout = makeLayout(result);
  assert.equal(layout.size.rows, 2);
  assert.equal(layout.size.cols, 2);
});

test('avg 使用 __valueCount 加权上卷，空折叠状态返回原 rows', () => {
  const cube = makeCube({ key: 'sales', aggregate: 'avg' });
  const avg = collapseCube(cube, new Set([collapseKey('row', 'region', 'east')]));
  const east2023 = avg.rows.find((row) => row.year === 2023 && row.region === 'east');
  assert.equal(east2023.sales, 20);

  const unchanged = collapseCube(cube, new Set());
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.rows, cube.rows);

  const stale = collapseCube(cube, new Set([collapseKey('row', 'region', 'missing')]));
  assert.equal(stale.changed, false);
  assert.equal(stale.rows, cube.rows);
});

test('hitTestHeader 只返回有子成员的父表头', () => {
  const layout = makeLayout(makeCube());
  const geometry = computePivotGeometry(layout);

  const region = layout.axes.row.header.members[0];
  const regionRect = geometry.rowHeaderRect(0, region.offset, region.size);
  const hit = hitTestHeader(layout, geometry, {
    x: regionRect.x + 5,
    y: regionRect.y + 5,
  });
  assert.equal(hit.axis, 'row');
  assert.equal(hit.dimension, 'region');
  assert.equal(hit.value, region.value);
  assert.equal(hit.key, collapseKey('row', 'region', region.value));

  const city = layout.axes.row.header.members[0].children.members[0];
  const cityRect = geometry.rowHeaderRect(1, city.offset, city.size);
  assert.equal(
    hitTestHeader(layout, geometry, {
      x: cityRect.x + 5,
      y: cityRect.y + 5,
    }),
    null,
  );

  const year = layout.axes.col.header.members[0];
  const yearRect = geometry.colHeaderRect(0, year.offset, year.size);
  const colHit = hitTestHeader(layout, geometry, {
    x: yearRect.x + 5,
    y: yearRect.y + 5,
  });
  // year 是列轴叶子，没有子成员，不能折叠。
  assert.equal(colHit, null);
});

test('hitTestHeader 命中列父成员', () => {
  const colDimensions = [
    { key: 'region', axis: 'row' },
    { key: 'year', axis: 'col', order: 'asc' },
    { key: 'product', axis: 'col', parent: 'year' },
  ];
  const colRows = [
    { region: 'east', year: 2023, product: 'phone', sales: 10 },
    { region: 'east', year: 2023, product: 'laptop', sales: 20 },
    { region: 'west', year: 2023, product: 'phone', sales: 40 },
  ];
  const cube = aggregate(colRows, {
    dimensions: colDimensions,
    measure: { key: 'sales', aggregate: 'sum' },
  });
  const layout = layoutPivot(cube.rows, {
    dimensions: colDimensions,
    value: 'sales',
    mode: 'compact',
  });
  const geometry = computePivotGeometry(layout);
  const year = layout.axes.col.header.members[0];
  const rect = geometry.colHeaderRect(0, year.offset, year.size);
  const hit = hitTestHeader(layout, geometry, {
    x: rect.x + 5,
    y: rect.y + 5,
  });

  assert.equal(hit.axis, 'col');
  assert.equal(hit.dimension, 'year');
  assert.equal(hit.value, year.value);
});

test('drawCollapseIndicators 绘制 + / − 并在表头区域裁剪', () => {
  const layout = makeLayout(makeCube());
  const geometry = computePivotGeometry(layout);
  const collapsed = new Set([collapseKey('row', 'region', 'east')]);
  const { ctx, calls } = createFakeContext();

  const count = drawCollapseIndicators(ctx, {
    layout,
    geometry,
    collapsed,
  });

  assert.equal(count, 2); // region east / west；year 是叶子
  const texts = calls.filter((call) => call.op === 'fillText');
  assert.ok(texts.some((call) => call.args[0] === '+'));
  assert.ok(texts.some((call) => call.args[0] === '−'));
  assert.equal(calls.filter((call) => call.op === 'clip').length, 2);
});

test('参数校验', () => {
  assert.throws(() => collapseCube(null), /cube/);
  assert.throws(() => collapseCube(makeCube(), []), /Set/);
  assert.throws(() => collapseKey('x', 'a', 1), /axis/);
  assert.equal(hitTestHeader(null, null, { x: 0, y: 0 }), null);
  assert.equal(drawCollapseIndicators(null, {}), 0);
});
