/**
 * 热力图 feature：基于核心已有的 cellStyle 回调实现，不修改核心渲染器。
 *
 * - 单度量布局：所有数值共用一个 min/max；
 * - 并列度量布局：按 measure 维度分别计算 min/max，互不干扰；
 * - 空值 / 非数值单元格返回 undefined，交回核心默认样式；
 * - 颜色只写进 cell.background / cell.text，由核心 renderPivot 应用。
 *
 * 核心已不再包含 heatmap 选项；色阶逻辑全部在本 feature。
 */

import { mixHex, readableTextColor } from '../render/theme.mjs';

export const DEFAULT_HEATMAP_COLORS = Object.freeze({
  from: '#eff6ff',
  to: '#1d4ed8',
  darkText: '#0f172a',
  lightText: '#ffffff',
});

/**
 * @param {ReturnType<import('../model/pivot-layout.mjs').layoutPivot>} layout
 * @param {{
 *   measureKey?: string | null,
 *   from?: string,
 *   to?: string,
 *   darkText?: string,
 *   lightText?: string
 * }} options
 * @returns {{
 *   cellStyle: (cell: object | null) => { background: string, text: string } | undefined,
 *   ranges: Map<string, { min: number, max: number }>,
 *   measureKey: string | null,
 *   hasMeasure: boolean,
 *   colors: { from: string, to: string, darkText: string, lightText: string }
 * }}
 */
export function createHeatmapStyle(layout, options = {}) {
  if (!layout || !Array.isArray(layout.cells)) {
    throw new TypeError(
      'createHeatmapStyle: layout 必须是 layoutPivot() 的返回值（缺少 cells）',
    );
  }

  const measureKey =
    options.measureKey === undefined ? 'measure' : options.measureKey;
  const from = options.from ?? DEFAULT_HEATMAP_COLORS.from;
  const to = options.to ?? DEFAULT_HEATMAP_COLORS.to;
  const darkText = options.darkText ?? DEFAULT_HEATMAP_COLORS.darkText;
  const lightText = options.lightText ?? DEFAULT_HEATMAP_COLORS.lightText;

  // 提前校验色值，避免首帧渲染时才抛错。
  mixHex(from, to, 0.5);

  const hasMeasure =
    typeof measureKey === 'string' &&
    layout.cells.some(
      (cell) =>
        cell?.members &&
        Object.prototype.hasOwnProperty.call(cell.members, measureKey),
    );

  const ranges = new Map();
  for (const cell of layout.cells) {
    const value = cell?.value;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;

    const key = seriesKey(cell, measureKey, hasMeasure);
    const range = ranges.get(key);
    if (!range) {
      ranges.set(key, { min: value, max: value });
    } else {
      if (value < range.min) range.min = value;
      if (value > range.max) range.max = value;
    }
  }

  const cellStyle = (cell) => {
    const value = cell?.value;
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;

    const range = ranges.get(seriesKey(cell, measureKey, hasMeasure));
    if (!range) return undefined;

    const t =
      range.max === range.min
        ? 0.5
        : (value - range.min) / (range.max - range.min);
    const background = mixHex(from, to, t);

    return {
      background,
      text: readableTextColor(background, { darkText, lightText }),
    };
  };

  return {
    cellStyle,
    ranges,
    measureKey,
    hasMeasure,
    colors: { from, to, darkText, lightText },
  };
}

function seriesKey(cell, measureKey, hasMeasure) {
  if (!hasMeasure) return '';
  const value = cell?.members?.[measureKey];
  return value === null || value === undefined ? '' : String(value);
}
