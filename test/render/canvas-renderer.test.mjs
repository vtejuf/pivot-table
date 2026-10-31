import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, layoutPivot } from '../../src/model/index.mjs';
import { renderPivot } from '../../src/render/index.mjs';

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
    setTransform(...args) {
      calls.push({ op: 'setTransform', args });
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
      calls.push({ op: 'stroke', strokeStyle: ctx.strokeStyle });
    },
    fillText(...args) {
      calls.push({ op: 'fillText', args, fillStyle: ctx.fillStyle });
    },
  };
  return { ctx, calls };
}

function fillTexts(calls) {
  return calls.filter((call) => call.op === 'fillText');
}

test('绘制数据格、表头与网格线', () => {
  const { ctx, calls } = createFakeContext();
  const { stats, geometry } = renderPivot(ctx, makeLayout());

  assert.equal(stats.cellsInGrid, 12);
  assert.equal(stats.drawnCells, 12);
  assert.equal(stats.drawnValues, 4);
  assert.equal(stats.textDraws, 4);
  assert.equal(stats.headerCells, 10); // region 2 + city 6（cartesian 补齐）+ year 2
  assert.equal(stats.gridLines, (2 + 1) + (6 + 1));
  assert.deepEqual(stats.visible, geometry.visible);

  const texts = fillTexts(calls).map((call) => call.args[0]);
  for (const text of [
    'east',
    'west',
    'hangzhou',
    'shanghai',
    'chengdu',
    '2023',
    '2024',
    '10',
    '20',
    '30',
    '40',
  ]) {
    assert.ok(texts.includes(text), `缺少文本 ${text}`);
  }
});

test('viewport 裁剪：只绘制可见单元格和表头', () => {
  const { ctx, calls } = createFakeContext();
  const { stats } = renderPivot(ctx, makeLayout(), {
    viewport: { width: 176 + 192, height: 28 + 56 },
  });

  assert.deepEqual(stats.visible, { x0: 0, x1: 1, y0: 0, y1: 1 });
  assert.equal(stats.drawnCells, 4);
  assert.equal(stats.drawnValues, 3); // 10 / 20 / 30
  assert.equal(stats.headerCells, 5); // region east + city 2 + year 2

  const texts = fillTexts(calls).map((call) => call.args[0]);
  assert.ok(texts.includes('10'));
  assert.ok(texts.includes('30'));
  assert.ok(!texts.includes('40'));
});

test('负滚动偏移被 clamp 到 0，不会抛错', () => {
  const { ctx } = createFakeContext();
  const { geometry, stats } = renderPivot(ctx, makeLayout(), {
    viewport: { width: 368, height: 196, scrollX: -20, scrollY: -40 },
  });

  assert.equal(geometry.viewport.scrollX, 0);
  assert.equal(geometry.viewport.scrollY, 0);
  assert.equal(stats.drawnValues, 4);
});

test('大网格只绘制视口内的格子', () => {
  const bigDimensions = [
    { key: 'r', axis: 'row' },
    { key: 'c', axis: 'col' },
  ];
  const bigRows = [];
  for (let r = 0; r < 150; r += 1) {
    for (let c = 0; c < 150; c += 1) {
      bigRows.push({ r: `r${r}`, c: `c${c}`, v: r + c });
    }
  }
  const layout = layoutPivot(bigRows, {
    dimensions: bigDimensions,
    value: 'v',
  });
  assert.equal(layout.size.rows, 150);
  assert.equal(layout.size.cols, 150);

  const { ctx, calls } = createFakeContext();
  const { stats } = renderPivot(ctx, layout, {
    viewport: { width: 88 + 480, height: 28 + 280 },
  });

  assert.equal(stats.cellsInGrid, 22500);
  assert.deepEqual(stats.visible, { x0: 0, x1: 4, y0: 0, y1: 9 });
  assert.equal(stats.drawnCells, 50);
  assert.equal(stats.drawnValues, 50);
  assert.equal(stats.headerCells, 15); // 10 行表头 + 5 列表头
  assert.ok(fillTexts(calls).length <= 50 + 15);
});

test('formatValue 与 cellStyle 可定制显示', () => {
  const { ctx, calls } = createFakeContext();
  renderPivot(ctx, makeLayout(), {
    formatValue: (value) => `¥${value}`,
    cellStyle: (cell) =>
      cell && cell.value === 40
        ? { background: '#fef3c7', text: '#92400e' }
        : undefined,
  });

  const texts = fillTexts(calls);
  assert.ok(texts.some((call) => call.args[0] === '¥40'));
  assert.ok(!texts.some((call) => call.args[0] === '40'));

  const highlighted = calls.find(
    (call) =>
      call.op === 'fillRect' &&
      call.fillStyle === '#fef3c7' &&
      call.args[2] === 96,
  );
  assert.ok(highlighted, '自定义背景没有绘制');
  const highlightedText = texts.find((call) => call.args[0] === '¥40');
  assert.equal(highlightedText.fillStyle, '#92400e');
});

test('传 canvas 时按 DPR 设置物理尺寸，并用 client 尺寸作为视口', () => {
  const { ctx, calls } = createFakeContext();
  const canvas = {
    width: 0,
    height: 0,
    style: {},
    clientWidth: 400,
    clientHeight: 300,
    getContext(type) {
      assert.equal(type, '2d');
      return ctx;
    },
  };

  const { geometry } = renderPivot(canvas, makeLayout(), { dpr: 2 });

  assert.equal(canvas.width, 800);
  assert.equal(canvas.height, 600);
  assert.equal(canvas.style.width, '400px');
  assert.equal(canvas.style.height, '300px');
  assert.deepEqual(
    calls.find((call) => call.op === 'setTransform').args,
    [2, 0, 0, 2, 0, 0],
  );
  assert.equal(geometry.viewport.width, 400);
  assert.equal(geometry.viewport.height, 300);
});

test('传入非法目标会给出明确错误', () => {
  assert.throws(() => renderPivot({}, makeLayout()), /HTMLCanvasElement/);
});

test('compact 布局使用实际成员块渲染', () => {
  const layout = makeLayout({ mode: 'compact' });
  assert.equal(layout.size.rows, 3);
  assert.equal(layout.matrix, null);

  const { ctx } = createFakeContext();
  const { stats } = renderPivot(ctx, layout);

  assert.equal(stats.drawnCells, 6);
  assert.equal(stats.drawnValues, 4);
  assert.equal(stats.headerCells, 7); // region 2 + city 3 + year 2
});

test('空数据不会崩溃，也不绘制任何格子', () => {
  const emptyDimensions = [{ key: 'a', axis: 'row' }];
  const cube = aggregate([], { dimensions: emptyDimensions });
  const layout = layoutPivot(cube.rows, {
    dimensions: emptyDimensions,
    value: cube.measure.key,
  });

  const { ctx, calls } = createFakeContext();
  const { stats } = renderPivot(ctx, layout);

  assert.equal(stats.cellsInGrid, 0);
  assert.equal(stats.drawnCells, 0);
  assert.equal(stats.drawnValues, 0);
  assert.equal(stats.headerCells, 0);
  assert.equal(fillTexts(calls).length, 0);
});

test('尺寸不变时不会重新分配 canvas 缓冲区', () => {
  const { ctx } = createFakeContext();
  let widthAssignments = 0;
  let heightAssignments = 0;
  const canvas = {
    _width: 0,
    _height: 0,
    style: {},
    clientWidth: 400,
    clientHeight: 300,
    get width() {
      return this._width;
    },
    set width(value) {
      widthAssignments += 1;
      this._width = value;
    },
    get height() {
      return this._height;
    },
    set height(value) {
      heightAssignments += 1;
      this._height = value;
    },
    getContext() {
      return ctx;
    },
  };

  renderPivot(canvas, makeLayout(), { dpr: 1 });
  renderPivot(canvas, makeLayout(), { dpr: 1 });

  assert.equal(widthAssignments, 1);
  assert.equal(heightAssignments, 1);
});
