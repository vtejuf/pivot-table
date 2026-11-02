import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, layoutPivot } from '../../src/model/index.mjs';
import { computePivotGeometry } from '../../src/render/index.mjs';
import { createCellMarker } from '../../src/features/cell-marker.mjs';

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

function makeLayout() {
  const cube = aggregate(rows, {
    dimensions,
    measure: { key: 'sales', aggregate: 'sum' },
  });
  return layoutPivot(cube.rows, { dimensions, value: 'sales' });
}

function createFakeContext() {
  const calls = [];
  const ctx = {
    fillStyle: '#000000',
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
  };
  return { ctx, calls };
}

test('cellStyle 只给命中谓词的格子返回样式', () => {
  const marker = createCellMarker(makeLayout(), {
    test: (cell) => cell.value >= 25,
  });

  assert.deepEqual(marker.cellStyle({ value: 30 }), {
    background: '#fef3c7',
    text: '#92400e',
  });
  assert.equal(marker.cellStyle({ value: 10 }), undefined);
  assert.equal(marker.cellStyle(null), undefined);
});

test('draw 只标记可见格子，并在 dataClip 内绘制', () => {
  const layout = makeLayout();
  const marker = createCellMarker(layout, {
    test: (cell) => cell.value >= 25,
  });

  const full = computePivotGeometry(layout);
  const { ctx, calls } = createFakeContext();
  assert.equal(marker.draw(ctx, { geometry: full }), 2);

  const fills = calls.filter((call) => call.op === 'fillRect');
  assert.equal(fills.length, 2);
  assert.ok(calls.some((call) => call.op === 'clip'));
  assert.equal(calls[0].op, 'save');
  assert.equal(calls.at(-1).op, 'restore');

  // 小视口只露出第一行（值为 10），没有命中的标记。
  const small = computePivotGeometry(layout, {
    viewport: { width: 176 + 96, height: 28 + 28 },
  });
  assert.equal(marker.draw(ctx, { geometry: small }), 0);
  assert.equal(marker.draw(ctx, {}), 0);
});

test('自定义颜色、尺寸与 markerInset 生效', () => {
  const layout = makeLayout();
  const marker = createCellMarker(layout, {
    test: () => true,
    background: '#111111',
    text: '#ffffff',
    markerColor: '#ff0000',
    markerSize: 4,
    markerInset: 1,
  });

  assert.deepEqual(marker.cellStyle({ value: 1 }), {
    background: '#111111',
    text: '#ffffff',
  });

  const { ctx, calls } = createFakeContext();
  assert.equal(marker.draw(ctx, { geometry: computePivotGeometry(layout) }), 4);
  const fills = calls.filter((call) => call.op === 'fillRect');
  assert.ok(fills.every((fill) => fill.fillStyle === '#ff0000'));
  assert.ok(fills.every((fill) => fill.args[2] === 4 && fill.args[3] === 4));
});

test('参数与目标校验', () => {
  assert.throws(() => createCellMarker(null), /layout/);
  assert.throws(() => createCellMarker({ cells: [] }, {}), /test/);
  assert.throws(
    () => createCellMarker({ cells: [] }, { test: () => true, markerSize: 0 }),
    /markerSize/,
  );
  assert.throws(
    () =>
      createCellMarker({ cells: [] }, { test: () => true, markerInset: -1 }),
    /markerInset/,
  );

  const marker = createCellMarker(makeLayout(), { test: () => true });
  assert.throws(() => marker.draw(null, { geometry: {} }), /CanvasRenderingContext2D/);
});
