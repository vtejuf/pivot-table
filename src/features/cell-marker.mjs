/**
 * 自定义 feature 示例：按谓词标记格子。
 *
 * 这是「如何写自己的 feature」的最小完整示例：
 * - cellStyle：命中谓词的格子返回背景 / 文字色；
 * - draw：通过 renderWithOverlay 在命中格子右上角画一个小标记；
 * - 只读 layout / geometry，不修改核心对象，也不新增核心 API。
 *
 * 用法：
 *
 *     import { createCellMarker } from './src/features/cell-marker.mjs';
 *     import { renderWithOverlay } from './src/features/overlay.mjs';
 *
 *     const marker = createCellMarker(layout, {
 *       test: (cell) => typeof cell.value === 'number' && cell.value >= 300,
 *     });
 *
 *     renderWithOverlay(canvas, layout, {
 *       viewport,
 *       cellStyle: marker.cellStyle,
 *     }, marker.draw);
 *
 * 完整挂载点说明见 docs/custom-features.md。
 */

const DEFAULTS = Object.freeze({
  background: '#fef3c7',
  text: '#92400e',
  markerColor: '#d97706',
  markerSize: 6,
  markerInset: 3,
});

/**
 * @param {ReturnType<import('../model/pivot-layout.mjs').layoutPivot>} layout
 * @param {{
 *   test: (cell: object) => boolean,
 *   background?: string,
 *   text?: string,
 *   markerColor?: string,
 *   markerSize?: number,
 *   markerInset?: number
 * }} options
 * @returns {{
 *   cellStyle: (cell: object | null) => { background: string, text: string } | undefined,
 *   draw: (ctx: CanvasRenderingContext2D, context: { geometry?: object }) => number,
 *   test: (cell: object) => boolean,
 *   markerSize: number
 * }}
 */
export function createCellMarker(layout, options = {}) {
  if (!layout || !Array.isArray(layout.cells)) {
    throw new TypeError(
      'createCellMarker: layout 必须是 layoutPivot() 的返回值（缺少 cells）',
    );
  }
  if (typeof options.test !== 'function') {
    throw new TypeError('createCellMarker: options.test 必须是函数');
  }

  const test = options.test;
  const background = options.background ?? DEFAULTS.background;
  const text = options.text ?? DEFAULTS.text;
  const markerColor = options.markerColor ?? DEFAULTS.markerColor;
  const markerSize = numberOption(
    options.markerSize,
    DEFAULTS.markerSize,
    'markerSize',
  );
  const markerInset = numberOption(
    options.markerInset,
    DEFAULTS.markerInset,
    'markerInset',
    { allowZero: true },
  );

  const cellMap =
    layout.cellMap instanceof Map
      ? layout.cellMap
      : new Map(layout.cells.map((cell) => [`${cell.x},${cell.y}`, cell]));

  const cellStyle = (cell) => {
    if (!cell || !test(cell)) return undefined;
    return { background, text };
  };

  const draw = (ctx, { geometry } = {}) => {
    if (!ctx || typeof ctx.fillRect !== 'function') {
      throw new TypeError(
        'createCellMarker: draw 需要 CanvasRenderingContext2D',
      );
    }
    if (!geometry || !geometry.visible) return 0;

    const { x0, x1, y0, y1 } = geometry.visible;
    if (x1 < x0 || y1 < y0) return 0;

    let drawn = 0;
    ctx.save();
    try {
      if (geometry.dataClip) {
        ctx.beginPath();
        ctx.rect(
          geometry.dataClip.x,
          geometry.dataClip.y,
          geometry.dataClip.width,
          geometry.dataClip.height,
        );
        ctx.clip();
      }

      ctx.fillStyle = markerColor;
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const cell = cellMap.get(`${x},${y}`);
          if (!cell || !test(cell)) continue;

          const rect = geometry.cellRect(x, y);
          const size = Math.min(markerSize, rect.width, rect.height);
          ctx.fillRect(
            rect.x + rect.width - size - markerInset,
            rect.y + markerInset,
            size,
            size,
          );
          drawn += 1;
        }
      }
    } finally {
      ctx.restore();
    }

    return drawn;
  };

  return { cellStyle, draw, test, markerSize };
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
