/**
 * 滚动条 feature：Canvas 视口边缘的悬浮滚动条。
 *
 * 核心 renderer 不绘制滚动条；本模块只读取 computePivotGeometry() 的结果，
 * 在核心绘制结束后叠加两条轨道，并提供命中测试与拖拽换算，供 site 层绑定
 * 指针事件。滚动条覆盖在数据区右缘/下缘，不改变核心几何和默认输出。
 *
 * 轨道从数据区起点开始，避开冻结的列表头 / 行表头；两个方向都可滚动时，
 * 右下角留出交叉空隙，避免两条轨道互相覆盖。
 *
 * 用法：
 *
 *     import { createScrollbarOverlay } from './src/features/scrollbar.mjs';
 *     import { renderWithOverlay } from './src/features/overlay.mjs';
 *
 *     const scrollbars = createScrollbarOverlay();
 *     renderWithOverlay(canvas, layout, options, scrollbars.draw);
 *
 *     // 指针事件
 *     const hit = scrollbars.hitTest(x, y);      // { axis, part, bar } | null
 *     const bars = scrollbars.getGeometry();     // 当前滚动条几何
 *     const next = scrollFromThumbPosition(hit.bar, y, grabOffset);
 *
 * thumb 的几何映射只依赖视口、内容尺寸和 maxScroll，不修改 layout / geometry。
 */

export const DEFAULT_SCROLLBAR_THEME = Object.freeze({
  /** 轨道厚度（CSS 像素）。 */
  thickness: 10,
  /** thumb 的最小长度，保证大内容时仍可抓取。 */
  minThumbSize: 24,
  /** 轨道与视口边缘 / 数据区边缘的间距。 */
  inset: 3,
  /** 两条轨道在右下角交叉处的留白。 */
  gap: 2,
  trackColor: 'rgba(15, 23, 42, 0.06)',
  thumbColor: 'rgba(71, 85, 105, 0.45)',
  thumbHoverColor: 'rgba(51, 65, 85, 0.66)',
  thumbActiveColor: 'rgba(37, 99, 235, 0.75)',
});

/**
 * 计算两条滚动条的轨道、thumb 和命中信息。
 *
 * @param {ReturnType<import('../render/geometry.mjs').computePivotGeometry>} geometry
 * @param {{
 *   thickness?: number,
 *   minThumbSize?: number,
 *   inset?: number,
 *   gap?: number
 * }} options
 * @returns {{
 *   viewport: { width: number, height: number },
 *   thickness: number,
 *   vertical: object,
 *   horizontal: object,
 *   corner: { x: number, y: number, width: number, height: number } | null
 * }}
 */
export function computeScrollbarGeometry(geometry, options = {}) {
  assertGeometry(geometry);

  const thickness = numberOption(
    options.thickness,
    DEFAULT_SCROLLBAR_THEME.thickness,
    'thickness',
  );
  const minThumbSize = numberOption(
    options.minThumbSize,
    DEFAULT_SCROLLBAR_THEME.minThumbSize,
    'minThumbSize',
  );
  const inset = numberOption(
    options.inset,
    DEFAULT_SCROLLBAR_THEME.inset,
    'inset',
    { allowZero: true },
  );
  const gap = numberOption(
    options.gap,
    DEFAULT_SCROLLBAR_THEME.gap,
    'gap',
    { allowZero: true },
  );

  const { viewport } = geometry;
  const dataOrigin = geometry.dataOrigin ?? { x: 0, y: 0 };
  const dataSize = geometry.dataSize ?? { width: 0, height: 0 };
  const dataViewport = geometry.dataViewport ?? {
    width: Math.max(0, viewport.width - dataOrigin.x),
    height: Math.max(0, viewport.height - dataOrigin.y),
  };

  const crossGap = thickness + gap;
  const verticalBase =
    viewport.canScrollY === true &&
    dataViewport.height > 0 &&
    dataSize.height > 0;
  const horizontalBase =
    viewport.canScrollX === true &&
    dataViewport.width > 0 &&
    dataSize.width > 0;

  const verticalTrack = {
    x: viewport.width - inset - thickness,
    y: dataOrigin.y + inset,
    width: thickness,
    height: 0,
  };
  verticalTrack.height = Math.max(
    0,
    viewport.height -
      inset -
      (horizontalBase ? crossGap : 0) -
      verticalTrack.y,
  );

  const horizontalTrack = {
    x: dataOrigin.x + inset,
    y: viewport.height - inset - thickness,
    width: 0,
    height: thickness,
  };
  horizontalTrack.width = Math.max(
    0,
    viewport.width -
      inset -
      (verticalBase ? crossGap : 0) -
      horizontalTrack.x,
  );

  const verticalVisible =
    verticalBase && verticalTrack.height > 0 && verticalTrack.x >= 0;
  const horizontalVisible =
    horizontalBase && horizontalTrack.width > 0 && horizontalTrack.y >= 0;

  const vertical = makeBar({
    axis: 'y',
    horizontal: false,
    visible: verticalVisible,
    track: verticalTrack,
    dataViewportSize: dataViewport.height,
    contentSize: dataSize.height,
    scroll: viewport.scrollY,
    maxScroll: viewport.maxScrollY,
    minThumbSize,
  });

  const horizontal = makeBar({
    axis: 'x',
    horizontal: true,
    visible: horizontalVisible,
    track: horizontalTrack,
    dataViewportSize: dataViewport.width,
    contentSize: dataSize.width,
    scroll: viewport.scrollX,
    maxScroll: viewport.maxScrollX,
    minThumbSize,
  });

  return {
    viewport: { width: viewport.width, height: viewport.height },
    thickness,
    vertical,
    horizontal,
    corner:
      verticalVisible && horizontalVisible
        ? {
            x: viewport.width - inset - thickness,
            y: viewport.height - inset - thickness,
            width: thickness,
            height: thickness,
          }
        : null,
  };
}

/**
 * 命中测试。优先返回 thumb，其次 track；两条轨道之外的区域返回 null。
 *
 * @returns {{ axis: 'x' | 'y', part: 'thumb' | 'track', bar: object } | null}
 */
export function hitTestScrollbars(bars, x, y) {
  if (!bars || !Number.isFinite(x) || !Number.isFinite(y)) return null;

  for (const bar of [bars.vertical, bars.horizontal]) {
    if (!bar?.visible) continue;
    if (containsPoint(bar.thumb, x, y)) {
      return { axis: bar.axis, part: 'thumb', bar };
    }
    if (containsPoint(bar.track, x, y)) {
      return { axis: bar.axis, part: 'track', bar };
    }
  }
  return null;
}

/**
 * 把指针坐标换算成滚动偏移。
 *
 * `grabOffset` 是指针相对 thumb 起点的距离：拖动 thumb 时保持抓取点不动；
 * 点击轨道时传 `thumbLength / 2`，让 thumb 中心跳到点击位置。
 */
export function scrollFromThumbPosition(bar, pointerPosition, grabOffset = 0) {
  assertBar(bar);
  if (!Number.isFinite(pointerPosition)) {
    throw new TypeError('scrollFromThumbPosition: pointerPosition 必须是有限数值');
  }
  if (!Number.isFinite(grabOffset)) {
    throw new TypeError('scrollFromThumbPosition: grabOffset 必须是有限数值');
  }

  const travel = Math.max(0, bar.trackLength - bar.thumbLength);
  if (travel <= 0 || bar.maxScroll <= 0) return 0;

  const offset = clamp(
    pointerPosition - bar.trackStart - grabOffset,
    0,
    travel,
  );
  return (offset / travel) * bar.maxScroll;
}

/**
 * 绘制滚动条。在核心 renderPivot / renderWithOverlay 之后调用。
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geometry
 * @param {object} options 与 computeScrollbarGeometry 相同的尺寸选项，外加颜色
 * @param {{ hover?: 'x' | 'y' | null, active?: 'x' | 'y' | null }} state
 * @returns {ReturnType<typeof computeScrollbarGeometry>}
 */
export function drawScrollbars(ctx, geometry, options = {}, state = {}) {
  if (!ctx || typeof ctx.fillRect !== 'function') {
    throw new TypeError('drawScrollbars: ctx 必须是 CanvasRenderingContext2D');
  }

  const bars = computeScrollbarGeometry(geometry, options);
  const style = resolveStyle(options);
  const visibleBars = [bars.vertical, bars.horizontal].filter(
    (bar) => bar.visible,
  );
  if (visibleBars.length === 0) return bars;

  ctx.save();
  try {
    for (const bar of visibleBars) {
      if (style.trackColor) {
        ctx.fillStyle = style.trackColor;
        ctx.fillRect(
          bar.track.x,
          bar.track.y,
          bar.track.width,
          bar.track.height,
        );
      }

      ctx.fillStyle =
        state.active === bar.axis
          ? style.thumbActiveColor
          : state.hover === bar.axis
            ? style.thumbHoverColor
            : style.thumbColor;
      ctx.fillRect(
        bar.thumb.x,
        bar.thumb.y,
        bar.thumb.width,
        bar.thumb.height,
      );
    }
  } finally {
    ctx.restore();
  }

  return bars;
}

/**
 * 便利封装：把滚动条作为 overlay 的 draw 函数，并保存 hover / active 状态。
 *
 * @param {object} options 尺寸与颜色选项
 * @returns {{
 *   draw: (ctx: CanvasRenderingContext2D, context: object) => object | null,
 *   setHover: (axis: 'x' | 'y' | null) => void,
 *   setActive: (axis: 'x' | 'y' | null) => void,
 *   getGeometry: (geometry?: object) => object | null,
 *   hitTest: (x: number, y: number, geometry?: object) => object | null,
 *   hover: 'x' | 'y' | null,
 *   active: 'x' | 'y' | null
 * }}
 */
export function createScrollbarOverlay(options = {}) {
  let hover = null;
  let active = null;
  let lastGeometry = null;

  const getGeometry = (geometry = lastGeometry) =>
    geometry ? computeScrollbarGeometry(geometry, options) : null;

  const hitTest = (x, y, geometry = lastGeometry) => {
    const bars = getGeometry(geometry);
    return bars ? hitTestScrollbars(bars, x, y) : null;
  };

  return {
    draw(ctx, context = {}) {
      lastGeometry = context.geometry ?? null;
      if (!lastGeometry) return null;
      return drawScrollbars(ctx, lastGeometry, options, { hover, active });
    },
    setHover(axis) {
      hover = normalizeAxis(axis);
    },
    setActive(axis) {
      active = normalizeAxis(axis);
    },
    getGeometry,
    hitTest,
    get hover() {
      return hover;
    },
    get active() {
      return active;
    },
  };
}

// ---------------------------------------------------------------------------
// 内部
// ---------------------------------------------------------------------------

function makeBar({
  axis,
  horizontal,
  visible,
  track,
  dataViewportSize,
  contentSize,
  scroll,
  maxScroll,
  minThumbSize,
}) {
  const trackStart = horizontal ? track.x : track.y;
  const trackLength = horizontal ? track.width : track.height;
  const ratio =
    contentSize > 0 ? clamp(dataViewportSize / contentSize, 0, 1) : 0;
  const thumbLength = visible
    ? Math.min(
        trackLength,
        Math.max(Math.min(minThumbSize, trackLength), trackLength * ratio),
      )
    : 0;
  const travel = Math.max(0, trackLength - thumbLength);
  const scrollRatio = maxScroll > 0 ? clamp(scroll / maxScroll, 0, 1) : 0;
  const thumbOffset = travel * scrollRatio;

  return {
    axis,
    visible,
    track,
    thumb: horizontal
      ? {
          x: trackStart + thumbOffset,
          y: track.y,
          width: thumbLength,
          height: track.height,
        }
      : {
          x: track.x,
          y: trackStart + thumbOffset,
          width: track.width,
          height: thumbLength,
        },
    trackStart,
    trackLength,
    thumbLength,
    scroll,
    maxScroll,
    dataViewportSize,
    contentSize,
  };
}

function resolveStyle(options) {
  return {
    trackColor: options.trackColor ?? DEFAULT_SCROLLBAR_THEME.trackColor,
    thumbColor: options.thumbColor ?? DEFAULT_SCROLLBAR_THEME.thumbColor,
    thumbHoverColor:
      options.thumbHoverColor ?? DEFAULT_SCROLLBAR_THEME.thumbHoverColor,
    thumbActiveColor:
      options.thumbActiveColor ?? DEFAULT_SCROLLBAR_THEME.thumbActiveColor,
  };
}

function containsPoint(rect, x, y) {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    x >= rect.x &&
    x < rect.x + rect.width &&
    y >= rect.y &&
    y < rect.y + rect.height
  );
}

function normalizeAxis(axis) {
  return axis === 'x' || axis === 'y' ? axis : null;
}

function assertGeometry(geometry) {
  const viewport = geometry?.viewport;
  if (
    !geometry ||
    typeof geometry !== 'object' ||
    !viewport ||
    typeof viewport !== 'object' ||
    !Number.isFinite(viewport.width) ||
    viewport.width < 0 ||
    !Number.isFinite(viewport.height) ||
    viewport.height < 0
  ) {
    throw new TypeError(
      'scrollbar: geometry 必须是 computePivotGeometry() 的返回值（缺少合法的 viewport）',
    );
  }
}

function assertBar(bar) {
  if (
    !bar ||
    typeof bar !== 'object' ||
    !Number.isFinite(bar.trackStart) ||
    !Number.isFinite(bar.trackLength) ||
    !Number.isFinite(bar.thumbLength) ||
    !Number.isFinite(bar.maxScroll)
  ) {
    throw new TypeError(
      'scrollFromThumbPosition: bar 必须是 computeScrollbarGeometry() 产出的滚动条',
    );
  }
}

function numberOption(value, fallback, name, { allowZero = false } = {}) {
  if (value === undefined || value === null) return fallback;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    (!allowZero && value === 0)
  ) {
    throw new Error(`${name} 必须是${allowZero ? '非负' : '正'}有限数值`);
  }
  return value;
}

function clamp(value, lower, upper) {
  return Math.min(upper, Math.max(lower, value));
}
