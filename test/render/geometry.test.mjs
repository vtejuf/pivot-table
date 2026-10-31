import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, layoutPivot } from '../../src/model/index.mjs';
import {
  computePivotGeometry,
  rectsIntersect,
} from '../../src/render/index.mjs';

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

function makeLayout(options = {}) {
  const cube = aggregate(rows, {
    dimensions,
    measure: { key: 'sales', aggregate: 'sum' },
  });
  return layoutPivot(cube.rows, { dimensions, value: 'sales', ...options });
}

test('默认视口铺满内容，坐标与尺寸可预测', () => {
  const geometry = computePivotGeometry(makeLayout());

  assert.deepEqual(geometry.cellSize, { width: 96, height: 28 });
  assert.deepEqual(geometry.headerSize, { row: 88, col: 28 });
  assert.deepEqual(geometry.depths, { row: 2, col: 1 });
  assert.deepEqual(geometry.grid, { rows: 6, cols: 2 });
  assert.deepEqual(geometry.dataOrigin, { x: 176, y: 28 });
  assert.deepEqual(geometry.contentSize, { width: 368, height: 196 });
  assert.deepEqual(geometry.viewport, {
    width: 368,
    height: 196,
    scrollX: 0,
    scrollY: 0,
    maxScrollX: 0,
    maxScrollY: 0,
    canScrollX: false,
    canScrollY: false,
  });
  assert.deepEqual(geometry.visible, { x0: 0, x1: 1, y0: 0, y1: 5 });
  assert.deepEqual(geometry.dataClip, { x: 176, y: 28, width: 192, height: 168 });
  assert.deepEqual(geometry.corner, { x: 0, y: 0, width: 176, height: 28 });

  assert.deepEqual(geometry.cellRect(1, 2), {
    x: 272,
    y: 84,
    width: 96,
    height: 28,
  });
  assert.deepEqual(geometry.rowHeaderRect(1, 0, 1), {
    x: 88,
    y: 28,
    width: 88,
    height: 28,
  });
  assert.deepEqual(geometry.colHeaderRect(0, 1, 1), {
    x: 272,
    y: 0,
    width: 96,
    height: 28,
  });
});

test('滚动时数据区平移，表头冻结在视口边缘', () => {
  const geometry = computePivotGeometry(makeLayout(), {
    viewport: { width: 368, height: 140, scrollY: 56 },
  });

  assert.equal(geometry.viewport.maxScrollY, 56);
  assert.equal(geometry.viewport.scrollY, 56);
  assert.deepEqual(geometry.visible, { x0: 0, x1: 1, y0: 2, y1: 5 });
  assert.equal(geometry.dataClip.height, 112);

  // 第 2 行刚好滚到数据区顶部
  assert.equal(geometry.cellRect(0, 2).y, 28);
  assert.equal(geometry.rowHeaderRect(0, 2, 1).y, 28);
  // 列表头不随纵向滚动
  assert.equal(geometry.colHeaderRect(0, 0, 2).y, 0);
  // 行表头不随横向滚动
  assert.equal(geometry.rowHeaderRect(0, 0, 3).x, 0);
});

test('滚动偏移被限制在内容范围内，负偏移归零', () => {
  const geometry = computePivotGeometry(makeLayout(), {
    viewport: { width: 200, height: 100, scrollX: 9999 },
  });

  assert.equal(geometry.viewport.maxScrollX, 168);
  assert.equal(geometry.viewport.scrollX, 168);

  const negative = computePivotGeometry(makeLayout(), {
    viewport: { width: 200, height: 100, scrollX: -20, scrollY: -40 },
  });
  assert.equal(negative.viewport.scrollX, 0);
  assert.equal(negative.viewport.scrollY, 0);

  assert.throws(
    () =>
      computePivotGeometry(makeLayout(), {
        viewport: { width: 200, height: 100, scrollY: Number.NaN },
      }),
    /有限数值/,
  );
});

test('可见范围只覆盖视口，overscan 可向两侧多取格子', () => {
  const viewport = { width: 176 + 96, height: 28 + 28 };
  const small = computePivotGeometry(makeLayout(), { viewport });
  assert.deepEqual(small.visible, { x0: 0, x1: 0, y0: 0, y1: 0 });

  const overscanned = computePivotGeometry(makeLayout(), {
    viewport,
    overscan: 1,
  });
  assert.deepEqual(overscanned.visible, { x0: 0, x1: 1, y0: 0, y1: 1 });
});

test('只有行轴时没有列头，数据区从 y=0 开始', () => {
  const rowOnly = [
    { key: 'region', axis: 'row' },
    { key: 'city', axis: 'row', parent: 'region' },
  ];
  const cube = aggregate(rows, {
    dimensions: rowOnly,
    measure: { key: 'sales', aggregate: 'sum' },
  });
  const layout = layoutPivot(cube.rows, { dimensions: rowOnly, value: 'sales' });
  const geometry = computePivotGeometry(layout);

  assert.equal(layout.axes.col, null);
  assert.deepEqual(geometry.depths, { row: 2, col: 0 });
  assert.deepEqual(geometry.dataOrigin, { x: 176, y: 0 });
  assert.deepEqual(geometry.contentSize, { width: 272, height: 168 });
  assert.equal(geometry.colHeaderClip.height, 0);
  assert.deepEqual(geometry.visible, { x0: 0, x1: 0, y0: 0, y1: 5 });
});

test('自定义格子与表头尺寸', () => {
  const geometry = computePivotGeometry(makeLayout(), {
    cellSize: { width: 50, height: 20 },
    headerSize: { row: 40, col: 16 },
  });

  assert.deepEqual(geometry.dataOrigin, { x: 80, y: 16 });
  assert.deepEqual(geometry.contentSize, { width: 180, height: 136 });
  assert.deepEqual(geometry.cellRect(1, 1), {
    x: 130,
    y: 36,
    width: 50,
    height: 20,
  });
});

test('参数校验：非法 layout / 尺寸直接报错', () => {
  assert.throws(() => computePivotGeometry(null), /layoutPivot/);
  assert.throws(
    () => computePivotGeometry({ size: { rows: 1.5, cols: 1 } }),
    /layoutPivot/,
  );
  assert.throws(
    () => computePivotGeometry(makeLayout(), { cellSize: { width: 0 } }),
    /cellSize\.width/,
  );
  assert.throws(
    () => computePivotGeometry(makeLayout(), { viewport: { width: Number.NaN } }),
    /viewport\.width/,
  );
});

test('矩形相交判定把零宽高视为不相交', () => {
  const base = { x: 0, y: 0, width: 10, height: 10 };
  assert.equal(rectsIntersect(base, { x: 5, y: 5, width: 10, height: 10 }), true);
  assert.equal(rectsIntersect(base, { x: 10, y: 0, width: 10, height: 10 }), false);
  assert.equal(rectsIntersect(base, { x: 0, y: 0, width: 0, height: 10 }), false);
});
