/**
 * 可视化模块：Canvas 2D 渲染器。
 *
 * 渲染基于 geometry 给出的屏幕矩形，数据格和表头都只画当前视口内的部分。
 * 表头冻结：滚动时行/列表头保持贴边，数据区按 scrollX / scrollY 平移。
 *
 * 用法：
 *
 *     renderPivot(canvas, layout, {
 *       viewport: { width, height, scrollX, scrollY },
 *       heatmap: true,
 *     });
 *
 * 也可以直接传 CanvasRenderingContext2D（此时视口由 viewport 决定，不做
 * canvas 尺寸设置），便于在已有画布或测试替身上复用。
 */

import { computePivotGeometry, rectsIntersect } from './geometry.mjs';
import { DEFAULT_THEME, mixHex, readableTextColor } from './theme.mjs';

/**
 * 在 canvas 上绘制透视表。
 *
 * @param {HTMLCanvasElement | CanvasRenderingContext2D} target
 * @param {ReturnType<import('../model/pivot-layout.mjs').layoutPivot>} layout
 * @param {{
 *   viewport?: { width?: number, height?: number, scrollX?: number, scrollY?: number },
 *   cellSize?: { width?: number, height?: number },
 *   headerSize?: { row?: number, col?: number },
 *   overscan?: number,
 *   dpr?: number,
 *   theme?: Partial<typeof DEFAULT_THEME>,
 *   heatmap?: boolean | {
 *     enabled?: boolean, min?: number, max?: number, from?: string, to?: string
 *   },
 *   formatValue?: (value: unknown, cell: object) => string | null | undefined,
 *   cellStyle?: (cell: object | null, context: object) =>
 *     { background?: string, text?: string } | undefined
 * }} options
 * @returns {{
 *   geometry: ReturnType<typeof computePivotGeometry>,
 *   stats: {
 *     cellsInGrid: number, drawnCells: number, drawnValues: number,
 *     textDraws: number, headerCells: number, gridLines: number,
 *     visible: { x0: number, x1: number, y0: number, y1: number },
 *     heatmap: { min: number, max: number } | null
 *   }
 * }}
 */
export function renderPivot(target, layout, options = {}) {
  const isCanvas = typeof target?.getContext === 'function';
  if (!isCanvas && typeof target?.fillRect !== 'function') {
    throw new TypeError(
      'renderPivot: 需要 HTMLCanvasElement 或 CanvasRenderingContext2D',
    );
  }

  const theme = mergeTheme(options.theme);
  let ctx = target;
  let viewport = options.viewport ? { ...options.viewport } : undefined;

  if (isCanvas) {
    // 只有在缺少视口尺寸时才需要自然内容尺寸；常见路径（宽高都提供）避免重复计算。
    const missingWidth = viewport?.width === undefined || viewport?.width === null;
    const missingHeight = viewport?.height === undefined || viewport?.height === null;
    const natural =
      missingWidth || missingHeight
        ? computePivotGeometry(layout, { ...options, viewport: undefined })
        : null;
    const width =
      viewport?.width ??
      (isPositive(target.clientWidth) ? target.clientWidth : natural.contentSize.width);
    const height =
      viewport?.height ??
      (isPositive(target.clientHeight) ? target.clientHeight : natural.contentSize.height);

    viewport = { ...viewport, width, height };
    const dpr =
      options.dpr ??
      (typeof globalThis.devicePixelRatio === 'number' ? globalThis.devicePixelRatio : 1);
    ctx = setupCanvas(target, width, height, dpr);
    if (!ctx) throw new Error('renderPivot: canvas.getContext("2d") 返回 null');
  }

  const geometry = computePivotGeometry(layout, { ...options, viewport });
  const heat = resolveHeatScale(layout, options.heatmap, theme);
  const cellMap =
    layout.cellMap instanceof Map
      ? layout.cellMap
      : new Map((layout.cells ?? []).map((cell) => [`${cell.x},${cell.y}`, cell]));

  const stats = {
    cellsInGrid: layout.size.rows * layout.size.cols,
    drawnCells: 0,
    drawnValues: 0,
    textDraws: 0,
    headerCells: 0,
    gridLines: 0,
    visible: { ...geometry.visible },
    heatmap: heat ? { min: heat.min, max: heat.max } : null,
  };

  paint(ctx, layout, geometry, theme, options, cellMap, heat, stats);
  return { geometry, stats };
}

/**
 * 设置 canvas 的物理像素尺寸与 DPR 变换，返回 2d 上下文。
 * 单独导出，方便调用者在 renderPivot 之外控制尺寸。
 */
export function setupCanvas(canvas, width, height, dpr = 1) {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const targetWidth = Math.max(1, Math.round(width * ratio));
  const targetHeight = Math.max(1, Math.round(height * ratio));

  // 给 canvas.width 赋相同值也会清空画布并重新分配缓冲区。滚动重绘时
  // 尺寸通常不变，必须跳过赋值才能保持逐帧性能。
  if (canvas.width !== targetWidth) canvas.width = targetWidth;
  if (canvas.height !== targetHeight) canvas.height = targetHeight;

  if (canvas.style) {
    const cssWidth = `${width}px`;
    const cssHeight = `${height}px`;
    if (canvas.style.width !== cssWidth) canvas.style.width = cssWidth;
    if (canvas.style.height !== cssHeight) canvas.style.height = cssHeight;
  }
  const ctx = canvas.getContext('2d');
  if (ctx?.setTransform) ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return ctx;
}

// ---------------------------------------------------------------------------
// 绘制
// ---------------------------------------------------------------------------

function paint(ctx, layout, geometry, theme, options, cellMap, heat, stats) {
  const viewport = geometry.viewport;

  ctx.save();
  ctx.lineWidth = 1;
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  const valueEntries = paintCellBackgrounds(
    ctx,
    layout,
    geometry,
    theme,
    options,
    cellMap,
    heat,
    stats,
  );
  paintGridLines(ctx, geometry, theme, stats);
  paintCellText(ctx, geometry, theme, valueEntries, stats);
  paintHeaders(ctx, layout, geometry, theme, stats);
  paintCorner(ctx, geometry, theme);
  paintSeparators(ctx, geometry, theme);

  ctx.restore();
}

function paintCellBackgrounds(
  ctx,
  layout,
  geometry,
  theme,
  options,
  cellMap,
  heat,
  stats,
) {
  const { x0, x1, y0, y1 } = geometry.visible;
  if (x1 < x0 || y1 < y0) return [];

  const entries = [];
  ctx.save();
  clipRect(ctx, geometry.dataClip);

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const cell = cellMap.get(`${x},${y}`) ?? null;
      const rect = geometry.cellRect(x, y);
      const custom = options.cellStyle?.(cell, { x, y, layout, geometry });

      const hasValue = cell !== null && cell.value !== null && cell.value !== undefined;
      let background = hasValue
        ? y % 2 === 0
          ? theme.cellBackground
          : theme.stripeBackground
        : theme.emptyBackground;

      let heatBackground = null;
      if (heat && hasValue && typeof cell.value === 'number' && Number.isFinite(cell.value)) {
        heatBackground = heat.color(cell.value);
        background = heatBackground;
      }
      if (custom?.background) background = custom.background;

      if (background) {
        ctx.fillStyle = background;
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      }

      stats.drawnCells += 1;
      if (hasValue) {
        stats.drawnValues += 1;
        const raw = options.formatValue
          ? options.formatValue(cell.value, cell)
          : String(cell.value);
        if (raw !== null && raw !== undefined && String(raw) !== '') {
          let color = theme.text;
          if (heatBackground) color = readableTextColor(heatBackground, theme.heatmap);
          if (custom?.text) color = custom.text;
          entries.push({ rect, text: String(raw), color });
        }
      }
    }
  }

  ctx.restore();
  return entries;
}

function paintCellText(ctx, geometry, theme, entries, stats) {
  if (entries.length === 0) return;

  ctx.save();
  clipRect(ctx, geometry.dataClip);
  ctx.font = theme.valueFont;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const entry of entries) {
    ctx.fillStyle = entry.color;
    drawClippedText(
      ctx,
      entry.text,
      entry.rect,
      entry.rect.x + entry.rect.width / 2,
    );
    stats.textDraws += 1;
  }

  ctx.restore();
}

function paintGridLines(ctx, geometry, theme, stats) {
  const { x0, x1, y0, y1 } = geometry.visible;
  if (x1 < x0 || y1 < y0) return;

  const { dataClip, dataOrigin, cellSize, viewport } = geometry;
  ctx.save();
  clipRect(ctx, dataClip);
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();

  for (let x = x0; x <= x1 + 1; x += 1) {
    const px = pixelLine(dataOrigin.x + x * cellSize.width - viewport.scrollX);
    ctx.moveTo(px, dataClip.y);
    ctx.lineTo(px, dataClip.y + dataClip.height);
    stats.gridLines += 1;
  }
  for (let y = y0; y <= y1 + 1; y += 1) {
    const py = pixelLine(dataOrigin.y + y * cellSize.height - viewport.scrollY);
    ctx.moveTo(dataClip.x, py);
    ctx.lineTo(dataClip.x + dataClip.width, py);
    stats.gridLines += 1;
  }

  ctx.stroke();
  ctx.restore();
}

function paintHeaders(ctx, layout, geometry, theme, stats) {
  const rowAxis = layout.axes?.row;
  if (rowAxis) {
    ctx.save();
    clipRect(ctx, geometry.rowHeaderClip);
    ctx.font = theme.headerFont;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    paintHeaderAxis({
      ctx,
      root: rowAxis.header,
      rectFn: geometry.rowHeaderRect,
      clipBounds: geometry.rowHeaderClip,
      unitSize: geometry.cellSize.height,
      rangeStart: geometry.contentVisible.y,
      rangeSize: geometry.contentVisible.height,
      theme,
      stats,
      align: 'left',
    });
    ctx.restore();
  }

  const colAxis = layout.axes?.col;
  if (colAxis) {
    ctx.save();
    clipRect(ctx, geometry.colHeaderClip);
    ctx.font = theme.headerFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    paintHeaderAxis({
      ctx,
      root: colAxis.header,
      rectFn: geometry.colHeaderRect,
      clipBounds: geometry.colHeaderClip,
      unitSize: geometry.cellSize.width,
      rangeStart: geometry.contentVisible.x,
      rangeSize: geometry.contentVisible.width,
      theme,
      stats,
      align: 'center',
    });
    ctx.restore();
  }
}

function paintHeaderAxis({
  ctx,
  root,
  rectFn,
  clipBounds,
  unitSize,
  rangeStart,
  rangeSize,
  theme,
  stats,
  align,
}) {
  const rangeEnd = rangeStart + rangeSize;

  const walk = (node, depth) => {
    const members = node.members ?? [];
    // 成员 offset 单调递增，二分掉视口左侧的整段，避免大维度全量遍历。
    let index = lowerBoundEnd(members, rangeStart, unitSize);

    for (; index < members.length; index += 1) {
      const member = members[index];
      if (member.offset * unitSize >= rangeEnd) break;

      const rect = rectFn(depth, member.offset, member.size);
      if (!rectsIntersect(rect, clipBounds)) continue;

      ctx.fillStyle = theme.headerBackground;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.strokeStyle = theme.grid;
      ctx.strokeRect(
        pixelLine(rect.x),
        pixelLine(rect.y),
        Math.max(0, rect.width - 1),
        Math.max(0, rect.height - 1),
      );

      ctx.fillStyle = theme.headerText;
      const text = member.value === null || member.value === undefined
        ? ''
        : String(member.value);
      if (text !== '') {
        const x =
          align === 'left' ? rect.x + theme.padding : rect.x + rect.width / 2;
        drawClippedText(ctx, text, rect, x);
      }

      stats.headerCells += 1;
      if (member.children) walk(member.children, depth + 1);
    }
  };

  walk(root, 0);
}

function paintCorner(ctx, geometry, theme) {
  const { x, y } = geometry.dataOrigin;
  if (x <= 0 || y <= 0) return;

  ctx.fillStyle = theme.headerBackground;
  ctx.fillRect(0, 0, x, y);
  ctx.strokeStyle = theme.border;
  ctx.strokeRect(0.5, 0.5, x - 1, y - 1);
}

function paintSeparators(ctx, geometry, theme) {
  const { dataOrigin, viewport } = geometry;
  if (dataOrigin.x <= 0 && dataOrigin.y <= 0) return;

  ctx.save();
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.beginPath();

  if (dataOrigin.x > 0) {
    const x = pixelLine(dataOrigin.x);
    ctx.moveTo(x, 0);
    ctx.lineTo(x, viewport.height);
  }
  if (dataOrigin.y > 0) {
    const y = pixelLine(dataOrigin.y);
    ctx.moveTo(0, y);
    ctx.lineTo(viewport.width, y);
  }

  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

function resolveHeatScale(layout, option, theme) {
  if (option === undefined || option === null || option === false) return null;
  if (typeof option !== 'boolean' && (typeof option !== 'object' || Array.isArray(option))) {
    throw new Error('heatmap 必须是布尔值或配置对象');
  }

  const config = option === true ? {} : option;
  if (config.enabled === false) return null;

  const fixedMin = Number.isFinite(config.min);
  const fixedMax = Number.isFinite(config.max);
  const range = fixedMin && fixedMax ? null : scanValueRange(layout);
  const min = fixedMin ? config.min : range.min;
  const max = fixedMax ? config.max : range.max;

  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;

  const from = config.from ?? theme.heatmap.from;
  const to = config.to ?? theme.heatmap.to;

  return {
    min,
    max,
    color(value) {
      const t = max === min ? 0.5 : (value - min) / (max - min);
      return mixHex(from, to, t);
    },
  };
}

/**
 * 数值范围按 layout 对象缓存。layoutPivot() 的返回值视为不可变；修改
 * cell.value 后请重新布局，否则热力色阶可能沿用旧范围。
 */
const valueRangeCache = new WeakMap();

function scanValueRange(layout) {
  const cached = valueRangeCache.get(layout);
  if (cached) return cached;

  let min = Infinity;
  let max = -Infinity;
  for (const cell of layout.cells ?? []) {
    const value = cell.value;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  const range = { min, max };
  valueRangeCache.set(layout, range);
  return range;
}

function mergeTheme(overrides = {}) {
  return {
    ...DEFAULT_THEME,
    ...overrides,
    heatmap: {
      ...DEFAULT_THEME.heatmap,
      ...(overrides.heatmap ?? {}),
    },
  };
}

function clipRect(ctx, rect) {
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, Math.max(0, rect.width), Math.max(0, rect.height));
  ctx.clip();
}

function drawClippedText(ctx, text, rect, x) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
  ctx.fillText(text, x, rect.y + rect.height / 2);
  ctx.restore();
}

function lowerBoundEnd(members, rangeStart, unitSize) {
  let low = 0;
  let high = members.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const member = members[mid];
    if ((member.offset + member.size) * unitSize <= rangeStart) low = mid + 1;
    else high = mid;
  }
  return low;
}

function pixelLine(value) {
  return Math.round(value) + 0.5;
}

function isPositive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
