/**
 * 自定义叠加渲染 feature 示例。
 *
 * 核心 renderPivot 只画自己的图层；本 feature 在它结束后把同一个 2D
 * context 交给调用方的 draw 回调，用来画角标、参考线、图标、选中框等装饰。
 * 核心的几何、绘制顺序、默认输出都不变，overlay 始终位于最上层。
 *
 * 这是“不修改冻结核心”的扩展点示例：
 * - renderWithOverlay()：通用入口，先核心、后自定义；
 * - createCornerLabels()：内置示例，在冻结的角区画行/列维度名。
 *
 * 用法：
 *
 *     import { renderWithOverlay, createCornerLabels } from './src/features/overlay.mjs';
 *
 *     renderWithOverlay(canvas, layout, viewportOptions, createCornerLabels());
 *
 *     // 或者完全自定义
 *     renderWithOverlay(canvas, layout, viewportOptions, (ctx, { geometry }) => {
 *       ctx.fillStyle = '#ef4444';
 *       ctx.fillRect(geometry.corner.width - 8, 0, 8, 8);
 *     });
 */

import { DEFAULT_THEME, renderPivot } from '../render/index.mjs';

export const DEFAULT_OVERLAY_FONT = '10px ui-sans-serif, system-ui, sans-serif';

/**
 * 在 core renderPivot 之后叠加自定义绘制。
 *
 * draw 的坐标系与 renderPivot 相同：CSS 像素。传 canvas 时 DPR 变换已经
 * 由核心设置好；传 2D context 时由调用方负责变换。draw 抛错时也会恢复
 * context 状态，不会把 save/restore 栈留给下一次绘制。
 *
 * @param {HTMLCanvasElement | CanvasRenderingContext2D} target
 * @param {ReturnType<import('../model/pivot-layout.mjs').layoutPivot>} layout
 * @param {{
 *   viewport?: { width?: number, height?: number, scrollX?: number, scrollY?: number },
 *   cellSize?: { width?: number, height?: number },
 *   headerSize?: { row?: number, col?: number },
 *   overscan?: number,
 *   dpr?: number,
 *   theme?: object,
 *   formatValue?: (value: unknown, cell: object) => string | null | undefined,
 *   cellStyle?: (cell: object | null, context: object) =>
 *     { background?: string, text?: string } | undefined
 * }} options 与 renderPivot 相同的渲染选项
 * @param {(ctx: CanvasRenderingContext2D, context: {
 *   layout: object,
 *   geometry: object,
 *   theme: object,
 *   options: object
 * }) => void} draw 自定义绘制回调
 * @returns {ReturnType<typeof renderPivot>}
 */
export function renderWithOverlay(target, layout, options = {}, draw) {
  if (typeof draw !== 'function') {
    throw new TypeError('renderWithOverlay: draw 必须是函数');
  }

  const result = renderPivot(target, layout, options);
  const ctx = resolveContext(target);
  const context = {
    layout,
    geometry: result.geometry,
    options,
    theme: { ...DEFAULT_THEME, ...(options.theme ?? {}) },
  };

  ctx.save();
  try {
    draw(ctx, context);
  } finally {
    ctx.restore();
  }

  return result;
}

/**
 * 内置示例：在左上角（冻结角区）画行/列维度名。
 *
 * 这不是核心布局的一部分，也不承诺“角区能放下所有维度名”：
 * - 文本来自 layout.axes.*.chain（维度 key），可用 rowLabel / colLabel 覆盖；
 * - 宽度不够时用省略号截断；
 * - 纯行 / 纯列透视没有角区时直接跳过，不报错；
 * - 只读取 layout / geometry，不修改任何核心对象。
 *
 * 需要更复杂的角区内容时，直接写自己的 draw 回调即可。
 *
 * @param {{
 *   rowLabel?: string,
 *   colLabel?: string,
 *   separator?: string,
 *   rowPrefix?: string,
 *   colPrefix?: string,
 *   font?: string,
 *   color?: string,
 *   lineColor?: string,
 *   accentColor?: string,
 *   background?: string,
 *   padding?: number
 * }} options
 * @returns {(ctx: CanvasRenderingContext2D, context: object) => boolean}
 *   返回是否实际绘制（角区为空时返回 false）。
 */
export function createCornerLabels(options = {}) {
  const {
    rowLabel,
    colLabel,
    separator = ' › ',
    rowPrefix = '行',
    colPrefix = '列',
    font = DEFAULT_OVERLAY_FONT,
    color = '#475569',
    lineColor = '#cbd5e1',
    accentColor = '#6366f1',
    background = 'rgba(99, 102, 241, 0.06)',
    padding = 6,
  } = options;

  assertOptionalString(rowLabel, 'rowLabel');
  assertOptionalString(colLabel, 'colLabel');

  return function drawCornerLabels(ctx, { layout, geometry } = {}) {
    const corner = geometry?.corner;
    if (!corner || corner.width <= 0 || corner.height <= 0) return false;

    const rowText =
      rowLabel ?? axisLabel(layout?.axes?.row?.chain, separator, rowPrefix);
    const colText =
      colLabel ?? axisLabel(layout?.axes?.col?.chain, separator, colPrefix);
    if (rowText === '' && colText === '') return false;

    const { x, y, width, height } = corner;
    const accent = Math.min(3, width);
    const left = x + accent + 3;
    const right = x + width - padding;
    const maxWidth = Math.max(0, right - left);

    ctx.save();
    try {
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.clip();

      if (background) {
        ctx.fillStyle = background;
        ctx.fillRect(x, y, width, height);
      }
      if (accentColor && accent > 0) {
        ctx.fillStyle = accentColor;
        ctx.fillRect(x, y, accent, height);
      }

      ctx.font = font;
      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';

      const compact = height < 24 || width < 56;
      if (compact) {
        ctx.textAlign = 'left';
        drawFittedText(
          ctx,
          [rowText, colText].filter(Boolean).join('  |  '),
          left,
          y + height / 2,
          maxWidth,
        );
      } else {
        const split = y + height / 2;
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left, split);
        ctx.lineTo(right, split);
        ctx.stroke();

        ctx.textAlign = 'right';
        drawFittedText(ctx, colText, right, y + height / 4, maxWidth);

        ctx.textAlign = 'left';
        drawFittedText(ctx, rowText, left, y + (height * 3) / 4, maxWidth);
      }

      return true;
    } finally {
      ctx.restore();
    }
  };
}

// ---------------------------------------------------------------------------
// 内部
// ---------------------------------------------------------------------------

function resolveContext(target) {
  if (typeof target?.getContext === 'function') {
    const ctx = target.getContext('2d');
    if (!ctx) {
      throw new Error('renderWithOverlay: canvas.getContext("2d") 返回 null');
    }
    return ctx;
  }
  return target;
}

function axisLabel(chain, separator, prefix) {
  if (!Array.isArray(chain) || chain.length === 0) return '';
  return `${prefix} ${chain.join(separator)}`;
}

function drawFittedText(ctx, text, x, y, maxWidth) {
  if (text === '' || maxWidth <= 0) return;
  const fitted = fitText(ctx, text, maxWidth);
  if (fitted !== '') ctx.fillText(fitted, x, y);
}

function fitText(ctx, text, maxWidth) {
  if (typeof ctx.measureText !== 'function') return text;
  if (ctx.measureText(text).width <= maxWidth) return text;

  const chars = Array.from(text);
  const ellipsis = '…';
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = `${chars.slice(0, mid).join('')}${ellipsis}`;
    if (ctx.measureText(candidate).width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return low === 0 ? '' : `${chars.slice(0, low).join('')}${ellipsis}`;
}

function assertOptionalString(value, name) {
  if (value !== undefined && typeof value !== 'string') {
    throw new TypeError(`createCornerLabels: ${name} 必须是字符串`);
  }
}
