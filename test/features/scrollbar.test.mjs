import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, layoutPivot } from '../../src/model/index.mjs';
import { computePivotGeometry } from '../../src/render/index.mjs';
import {
  computeScrollbarGeometry,
  createScrollbarAutoHide,
  createScrollbarOverlay,
  drawScrollbars,
  hitTestScrollbars,
  scrollFromThumbPosition,
} from '../../src/features/scrollbar.mjs';

const dimensions = [
  { key: 'r', axis: 'row' },
  { key: 'c', axis: 'col' },
];

function makeLayout(rowCount = 20, colCount = 20) {
  const rows = [];
  for (let r = 0; r < rowCount; r += 1) {
    for (let c = 0; c < colCount; c += 1) {
      rows.push({ r: `r${r}`, c: `c${c}`, v: r + c });
    }
  }
  const cube = aggregate(rows, {
    dimensions,
    measure: { key: 'v', aggregate: 'sum' },
  });
  return layoutPivot(cube.rows, { dimensions, value: 'v' });
}

const layout = makeLayout();
const viewport = { width: 688, height: 328 };

function makeGeometry(options = {}) {
  return computePivotGeometry(layout, {
    viewport: { ...viewport, ...options },
  });
}

function createFakeContext() {
  const calls = [];
  const ctx = {
    fillStyle: '#000000',
    globalAlpha: 1,
    save() {
      calls.push({ op: 'save' });
    },
    restore() {
      calls.push({ op: 'restore' });
    },
    fillRect(...args) {
      calls.push({
        op: 'fillRect',
        args,
        fillStyle: ctx.fillStyle,
        globalAlpha: ctx.globalAlpha,
      });
    },
  };
  return { ctx, calls };
}

function closeTo(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${message}: 期望 ${expected}，实际 ${actual}`,
  );
}

test('两条滚动条避开冻结表头，并在右下角留出交叉空隙', () => {
  const bars = computeScrollbarGeometry(makeGeometry());

  assert.deepEqual(bars.viewport, { width: 688, height: 328 });
  assert.equal(bars.thickness, 10);

  assert.equal(bars.vertical.visible, true);
  assert.deepEqual(bars.vertical.track, {
    x: 675,
    y: 31,
    width: 10,
    height: 282,
  });
  assert.equal(bars.vertical.trackStart, 31);
  assert.equal(bars.vertical.trackLength, 282);
  assert.equal(bars.vertical.maxScroll, 260);

  assert.equal(bars.horizontal.visible, true);
  assert.deepEqual(bars.horizontal.track, {
    x: 91,
    y: 315,
    width: 582,
    height: 10,
  });
  assert.equal(bars.horizontal.trackStart, 91);
  assert.equal(bars.horizontal.trackLength, 582);
  assert.equal(bars.horizontal.maxScroll, 1320);

  assert.deepEqual(bars.corner, { x: 675, y: 315, width: 10, height: 10 });
});

test('thumb 长度按可视数据比例计算，滚动到末尾时贴住轨道末端', () => {
  const start = computeScrollbarGeometry(makeGeometry());
  const end = computeScrollbarGeometry(
    makeGeometry({ scrollX: 99999, scrollY: 99999 }),
  );

  closeTo(start.vertical.thumbLength, (282 * 300) / 560, '垂直 thumb 长度');
  closeTo(start.horizontal.thumbLength, (582 * 600) / 1920, '水平 thumb 长度');

  assert.equal(start.vertical.thumb.y, 31);
  assert.equal(start.horizontal.thumb.x, 91);

  closeTo(
    end.vertical.thumb.y + end.vertical.thumb.height,
    31 + 282,
    '垂直 thumb 末端',
  );
  closeTo(
    end.horizontal.thumb.x + end.horizontal.thumb.width,
    91 + 582,
    '水平 thumb 末端',
  );
  assert.deepEqual(end.viewport, start.viewport);
});

test('内容小于视口时不显示滚动条', () => {
  const geometry = computePivotGeometry(layout);
  assert.equal(geometry.viewport.canScrollX, false);
  assert.equal(geometry.viewport.canScrollY, false);

  const bars = computeScrollbarGeometry(geometry);
  assert.equal(bars.vertical.visible, false);
  assert.equal(bars.horizontal.visible, false);
  assert.equal(bars.corner, null);

  const { ctx, calls } = createFakeContext();
  drawScrollbars(ctx, geometry);
  assert.equal(calls.filter((call) => call.op === 'fillRect').length, 0);
});

test('只有行轴时只显示垂直滚动条', () => {
  const rowOnly = [{ key: 'r', axis: 'row' }];
  const rows = [];
  for (let r = 0; r < 20; r += 1) rows.push({ r: `r${r}`, v: r });
  const cube = aggregate(rows, {
    dimensions: rowOnly,
    measure: { key: 'v', aggregate: 'sum' },
  });
  const rowLayout = layoutPivot(cube.rows, {
    dimensions: rowOnly,
    value: 'v',
  });
  const bars = computeScrollbarGeometry(
    computePivotGeometry(rowLayout, { viewport }),
  );

  assert.equal(bars.horizontal.visible, false);
  assert.equal(bars.vertical.visible, true);
  // 列表头高度为 0，轨道从视口顶部开始；没有水平轨道，不需要让位。
  assert.deepEqual(bars.vertical.track, {
    x: 675,
    y: 3,
    width: 10,
    height: 322,
  });
  assert.equal(bars.corner, null);
});

test('命中测试区分 thumb、track 与轨道外区域', () => {
  const start = computeScrollbarGeometry(makeGeometry());
  const end = computeScrollbarGeometry(
    makeGeometry({ scrollY: 99999 }),
  );

  const thumbHit = hitTestScrollbars(start, 680, 100);
  assert.equal(thumbHit.axis, 'y');
  assert.equal(thumbHit.part, 'thumb');

  // 滚到底后 thumb 在下半段，顶部只剩轨道。
  const trackHit = hitTestScrollbars(end, 680, 40);
  assert.equal(trackHit.axis, 'y');
  assert.equal(trackHit.part, 'track');

  const horizontalHit = hitTestScrollbars(start, 180, 320);
  assert.equal(horizontalHit.axis, 'x');
  assert.equal(horizontalHit.part, 'thumb');

  assert.equal(hitTestScrollbars(start, 300, 200), null);
  assert.equal(hitTestScrollbars(start, 680, 320), null); // 右下角交叉空隙
});

test('scrollFromThumbPosition 把指针位置映射回滚动偏移', () => {
  const bar = computeScrollbarGeometry(makeGeometry()).vertical;
  const travel = bar.trackLength - bar.thumbLength;

  assert.equal(scrollFromThumbPosition(bar, bar.trackStart), 0);
  closeTo(
    scrollFromThumbPosition(bar, bar.trackStart + travel / 2),
    bar.maxScroll / 2,
    '轨道中点',
  );
  closeTo(
    scrollFromThumbPosition(bar, bar.trackStart + travel + 200),
    bar.maxScroll,
    '越过末端',
  );
  closeTo(
    scrollFromThumbPosition(bar, bar.trackStart + 10, 10),
    0,
    '抓取偏移保持 thumb 不动',
  );
});

test('绘制轨道与 thumb，hover / active 使用不同颜色', () => {
  const { ctx, calls } = createFakeContext();
  const bars = drawScrollbars(
    ctx,
    makeGeometry(),
    {
      trackColor: '#eeeeee',
      thumbColor: '#111111',
      thumbHoverColor: '#222222',
      thumbActiveColor: '#333333',
    },
    { hover: 'y', active: 'x' },
  );

  assert.equal(bars.vertical.visible, true);
  const fills = calls.filter((call) => call.op === 'fillRect');
  assert.equal(fills.length, 4);

  assert.equal(fills[0].fillStyle, '#eeeeee'); // 垂直轨道
  assert.equal(fills[1].fillStyle, '#222222'); // 垂直 thumb（hover）
  assert.equal(fills[2].fillStyle, '#eeeeee'); // 水平轨道
  assert.equal(fills[3].fillStyle, '#333333'); // 水平 thumb（active）

  for (const fill of fills) {
    assert.ok(fill.args.every((value) => Number.isFinite(value)));
  }
  assert.equal(calls.filter((call) => call.op === 'save').length, 1);
  assert.equal(calls.filter((call) => call.op === 'restore').length, 1);
});

test('createScrollbarOverlay 缓存几何并提供 hover / active 状态', () => {
  const overlay = createScrollbarOverlay({ thickness: 8, inset: 2 });
  const { ctx, calls } = createFakeContext();

  const bars = overlay.draw(ctx, { geometry: makeGeometry() });
  assert.equal(bars.thickness, 8);
  assert.equal(overlay.getGeometry().vertical.track.width, 8);
  assert.equal(overlay.opacity, 1);

  const hit = overlay.hitTest(680, 100);
  assert.equal(hit.axis, 'y');
  assert.equal(hit.part, 'thumb');

  overlay.setHover('x');
  overlay.setActive('y');
  assert.equal(overlay.hover, 'x');
  assert.equal(overlay.active, 'y');

  calls.length = 0;
  overlay.draw(ctx, { geometry: makeGeometry() });
  const fills = calls.filter((call) => call.op === 'fillRect');
  assert.equal(fills[1].fillStyle, 'rgba(37, 99, 235, 0.75)'); // active 优先
  assert.equal(fills[3].fillStyle, 'rgba(51, 65, 85, 0.66)'); // hover

  overlay.setHover(null);
  overlay.setActive(null);
  assert.equal(overlay.hover, null);
  assert.equal(overlay.active, null);
});

test('opacity 控制滚动条淡出，0 时完全不绘制', () => {
  const { ctx, calls } = createFakeContext();

  drawScrollbars(ctx, makeGeometry(), {}, { opacity: 0.5 });
  let fills = calls.filter((call) => call.op === 'fillRect');
  assert.equal(fills.length, 4);
  assert.ok(fills.every((fill) => fill.globalAlpha === 0.5));

  calls.length = 0;
  drawScrollbars(ctx, makeGeometry(), {}, { opacity: 0 });
  assert.equal(calls.filter((call) => call.op === 'fillRect').length, 0);
  assert.equal(calls.filter((call) => call.op === 'save').length, 0);

  calls.length = 0;
  drawScrollbars(ctx, makeGeometry(), {}, { opacity: 2 });
  fills = calls.filter((call) => call.op === 'fillRect');
  assert.ok(fills.every((fill) => fill.globalAlpha === 1));
});

test('overlay 的 setOpacity 影响绘制并 clamp 到 0..1', () => {
  const overlay = createScrollbarOverlay();
  const { ctx, calls } = createFakeContext();

  overlay.setOpacity(0.25);
  assert.equal(overlay.opacity, 0.25);
  overlay.draw(ctx, { geometry: makeGeometry() });
  let fills = calls.filter((call) => call.op === 'fillRect');
  assert.ok(fills.every((fill) => fill.globalAlpha === 0.25));

  overlay.setOpacity(2);
  assert.equal(overlay.opacity, 1);
  overlay.setOpacity(Number.NaN);
  assert.equal(overlay.opacity, 0);
});

test('createScrollbarAutoHide 按 delay 与 fadeDuration 计算透明度', () => {
  const autoHide = createScrollbarAutoHide({ delay: 900, fadeDuration: 160 });

  assert.equal(autoHide.opacity(0), 0);
  assert.equal(autoHide.isActive(0), false);

  autoHide.show(1000);
  assert.equal(autoHide.opacity(1000), 1);
  assert.equal(autoHide.opacity(1500), 1);
  assert.equal(autoHide.opacity(1900), 1); // elapsed 900，刚开始淡出
  closeTo(autoHide.opacity(1980), 0.5, '淡出中点');
  assert.equal(autoHide.opacity(2060), 0);
  assert.equal(autoHide.opacity(3000), 0);
  assert.equal(autoHide.isActive(1980), true);
  assert.equal(autoHide.isActive(2060), false);

  autoHide.setPinned(true, 3000);
  assert.equal(autoHide.opacity(9999), 1);
  autoHide.setPinned(false, 9999);
  assert.equal(autoHide.opacity(9999), 1);
  assert.equal(autoHide.opacity(9999 + 900), 1);
  assert.equal(autoHide.opacity(9999 + 1060), 0);
});

test('createScrollbarAutoHide 参数校验与零时长', () => {
  assert.throws(
    () => createScrollbarAutoHide({ delay: -1 }),
    /delay/,
  );
  assert.throws(
    () => createScrollbarAutoHide({ fadeDuration: -1 }),
    /fadeDuration/,
  );

  const instant = createScrollbarAutoHide({ delay: 0, fadeDuration: 0 });
  instant.show(10);
  assert.equal(instant.opacity(10), 1);
  assert.equal(instant.opacity(10.001), 0);
});

test('参数校验：非法几何与尺寸直接报错', () => {
  assert.throws(() => computeScrollbarGeometry(null), /geometry/);
  assert.throws(
    () => computeScrollbarGeometry({ viewport: { width: 1 } }),
    /geometry/,
  );
  assert.throws(
    () => computeScrollbarGeometry(makeGeometry(), { thickness: 0 }),
    /thickness/,
  );
  assert.throws(
    () => computeScrollbarGeometry(makeGeometry(), { inset: -1 }),
    /inset/,
  );
  assert.throws(
    () => scrollFromThumbPosition(null, 0),
    /bar/,
  );
});
