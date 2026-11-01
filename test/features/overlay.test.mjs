import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, layoutPivot } from '../../src/model/index.mjs';
import {
  createCornerLabels,
  DEFAULT_OVERLAY_FONT,
  renderWithOverlay,
} from '../../src/features/overlay.mjs';

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
      calls.push({ op: 'stroke', strokeStyle: ctx.strokeStyle });
    },
    fillText(...args) {
      calls.push({
        op: 'fillText',
        args,
        fillStyle: ctx.fillStyle,
        font: ctx.font,
        textAlign: ctx.textAlign,
      });
    },
    measureText(text) {
      return { width: Array.from(String(text)).length * 6 };
    },
  };
  return { ctx, calls };
}

function fillTexts(calls) {
  return calls.filter((call) => call.op === 'fillText');
}

test('renderWithOverlay 在核心绘制之后执行自定义 draw', () => {
  const { ctx, calls } = createFakeContext();
  const layout = makeLayout();
  let received = null;

  const result = renderWithOverlay(
    ctx,
    layout,
    {
      viewport: { width: 400, height: 200 },
      theme: { headerBackground: '#000000' },
    },
    (context, payload) => {
      received = payload;
      assert.equal(typeof context.fillText, 'function');
      context.fillStyle = '#ff0000';
      context.fillText('自定义叠加', 4, 4);
    },
  );

  assert.ok(result.geometry);
  assert.equal(received.layout, layout);
  assert.equal(received.geometry, result.geometry);
  assert.equal(received.options.viewport.width, 400);
  assert.equal(received.theme.headerBackground, '#000000');
  assert.equal(received.theme.background, '#ffffff');

  const texts = fillTexts(calls);
  assert.ok(texts.some((call) => call.args[0] === '自定义叠加'));

  const overlayIndex = calls.findIndex(
    (call) => call.op === 'fillText' && call.args[0] === '自定义叠加',
  );
  const coreIndex = calls.findIndex(
    (call) => call.op === 'fillText' && call.args[0] === 'east',
  );
  assert.ok(overlayIndex > coreIndex, 'overlay 应在核心表头之后绘制');
});

test('draw 抛错时恢复 context 并向上抛出', () => {
  const { ctx, calls } = createFakeContext();

  assert.throws(
    () =>
      renderWithOverlay(ctx, makeLayout(), {}, () => {
        throw new Error('boom');
      }),
    /boom/,
  );

  const saves = calls.filter((call) => call.op === 'save').length;
  const restores = calls.filter((call) => call.op === 'restore').length;
  assert.equal(saves, restores);
});

test('draw 必须是函数', () => {
  const { ctx } = createFakeContext();
  assert.throws(
    () => renderWithOverlay(ctx, makeLayout(), {}, null),
    /draw 必须是函数/,
  );
});

test('示例 overlay 在角区画出行/列维度名', () => {
  const { ctx, calls } = createFakeContext();
  const layout = makeLayout();

  const result = renderWithOverlay(
    ctx,
    layout,
    { viewport: { width: 400, height: 200 } },
    createCornerLabels(),
  );

  assert.equal(result.geometry.corner.width, 2 * 88);
  assert.equal(result.geometry.corner.height, 28);

  const texts = fillTexts(calls).map((call) => call.args[0]);
  assert.ok(texts.includes('列 year'));
  assert.ok(texts.includes('行 region › city'));

  const overlayText = fillTexts(calls).find(
    (call) => call.args[0] === '行 region › city',
  );
  assert.equal(overlayText.font, DEFAULT_OVERLAY_FONT);
  assert.equal(overlayText.textAlign, 'left');
});

test('自定义行/列标签与分隔符', () => {
  const { ctx, calls } = createFakeContext();

  renderWithOverlay(
    ctx,
    makeLayout(),
    { viewport: { width: 400, height: 200 } },
    createCornerLabels({
      rowLabel: '地区 / 城市',
      colLabel: '年份',
    }),
  );

  const texts = fillTexts(calls).map((call) => call.args[0]);
  assert.ok(texts.includes('地区 / 城市'));
  assert.ok(texts.includes('年份'));
});

test('纯列透视没有角区时跳过', () => {
  const colOnlyDimensions = [{ key: 'year', axis: 'col' }];
  const cube = aggregate(
    [
      { year: 2023, sales: 1 },
      { year: 2024, sales: 2 },
    ],
    {
      dimensions: colOnlyDimensions,
      measure: { key: 'sales', aggregate: 'sum' },
    },
  );
  const layout = layoutPivot(cube.rows, {
    dimensions: colOnlyDimensions,
    value: 'sales',
  });

  assert.equal(layout.axes.row, null);

  const { ctx, calls } = createFakeContext();
  const draw = createCornerLabels();
  let drawn = null;

  renderWithOverlay(
    ctx,
    layout,
    { viewport: { width: 400, height: 200 } },
    (context, payload) => {
      drawn = draw(context, payload);
    },
  );

  assert.equal(drawn, false);
  const texts = fillTexts(calls).map((call) => call.args[0]);
  assert.ok(!texts.some((text) => text.startsWith('列 ')));
});

test('角区过窄时用省略号截断', () => {
  const { ctx, calls } = createFakeContext();

  renderWithOverlay(
    ctx,
    makeLayout(),
    {
      viewport: { width: 400, height: 200 },
      headerSize: { row: 30 },
    },
    createCornerLabels(),
  );

  const texts = fillTexts(calls).map((call) => call.args[0]);
  const rowText = texts.find((text) => text.startsWith('行 '));
  assert.ok(rowText, '没有画出行轴标签');
  assert.ok(rowText.endsWith('…'), `期望省略号，实际 ${rowText}`);
});

test('createCornerLabels 校验自定义标签类型', () => {
  assert.throws(() => createCornerLabels({ rowLabel: 42 }), /rowLabel/);
  assert.throws(() => createCornerLabels({ colLabel: {} }), /colLabel/);
});

test('overlay 不修改布局对象', () => {
  const layout = makeLayout();
  const before = {
    rows: layout.size.rows,
    cols: layout.size.cols,
    cells: layout.cells.length,
    matrix: layout.matrix?.map((row) => [...row]),
  };

  const { ctx } = createFakeContext();
  renderWithOverlay(
    ctx,
    layout,
    { viewport: { width: 400, height: 200 } },
    createCornerLabels(),
  );

  assert.deepEqual(
    {
      rows: layout.size.rows,
      cols: layout.size.cols,
      cells: layout.cells.length,
      matrix: layout.matrix?.map((row) => [...row]),
    },
    before,
  );
});

test('传 canvas 时在 DPR 变换后叠加', () => {
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

  let receivedGeometry = null;
  renderWithOverlay(canvas, makeLayout(), { dpr: 2 }, (context, { geometry }) => {
    receivedGeometry = geometry;
    context.fillText('canvas overlay', 1, 1);
  });

  assert.equal(canvas.width, 800);
  assert.equal(canvas.height, 600);
  assert.equal(receivedGeometry.viewport.width, 400);
  assert.ok(
    fillTexts(calls).some((call) => call.args[0] === 'canvas overlay'),
  );
});
