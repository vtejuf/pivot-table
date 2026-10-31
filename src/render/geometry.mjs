/**
 * 可视化模块：几何层。
 *
 * 只做坐标换算，不接触 canvas / DOM，因此可以在 Node 里直接测试。
 * 输入是 layoutPivot() 的结果，输出一个带视口信息的坐标系统：
 *
 * - 内容坐标：所有表头和单元格按格子尺寸铺开后的坐标，原点在左上角。
 * - 屏幕坐标：内容坐标减去滚动偏移，行/列表头冻结在视口边缘。
 *
 * 渲染器只需要消费 screen rect，不必自己推导表头位置。
 */

const DEFAULTS = {
  cellWidth: 96,
  cellHeight: 28,
  rowHeaderWidth: 88,
  colHeaderHeight: 28,
};

/**
 * @param {ReturnType<import('../model/pivot-layout.mjs').layoutPivot>} layout
 * @param {{
 *   cellSize?: { width?: number, height?: number },
 *   headerSize?: { row?: number, col?: number },
 *   viewport?: { width?: number, height?: number, scrollX?: number, scrollY?: number },
 *   overscan?: number
 * }} options
 */
export function computePivotGeometry(layout, options = {}) {
  assertLayout(layout);

  const cellWidth = numberOption(options.cellSize?.width, DEFAULTS.cellWidth, {
    name: 'cellSize.width',
    allowZero: false,
  });
  const cellHeight = numberOption(options.cellSize?.height, DEFAULTS.cellHeight, {
    name: 'cellSize.height',
    allowZero: false,
  });
  const rowHeaderWidth = numberOption(options.headerSize?.row, DEFAULTS.rowHeaderWidth, {
    name: 'headerSize.row',
  });
  const colHeaderHeight = numberOption(options.headerSize?.col, DEFAULTS.colHeaderHeight, {
    name: 'headerSize.col',
  });
  const overscan = Math.floor(
    numberOption(options.overscan, 0, { name: 'overscan' }),
  );

  const rowDepth = layout.axes?.row?.chain?.length ?? 0;
  const colDepth = layout.axes?.col?.chain?.length ?? 0;
  const cols = layout.size.cols;
  const rows = layout.size.rows;

  const dataOrigin = {
    x: rowDepth * rowHeaderWidth,
    y: colDepth * colHeaderHeight,
  };
  const cellSize = { width: cellWidth, height: cellHeight };
  const headerSize = { row: rowHeaderWidth, col: colHeaderHeight };
  const dataSize = {
    width: cols * cellWidth,
    height: rows * cellHeight,
  };
  const contentSize = {
    width: dataOrigin.x + dataSize.width,
    height: dataOrigin.y + dataSize.height,
  };

  const viewport = normalizeViewport(options.viewport, contentSize);
  const dataViewport = {
    x: dataOrigin.x,
    y: dataOrigin.y,
    width: Math.max(0, viewport.width - dataOrigin.x),
    height: Math.max(0, viewport.height - dataOrigin.y),
  };

  const xRange = axisRange(cols, cellWidth, viewport.scrollX, dataViewport.width, overscan);
  const yRange = axisRange(rows, cellHeight, viewport.scrollY, dataViewport.height, overscan);

  const cellRect = (x, y) => ({
    x: dataOrigin.x + x * cellWidth - viewport.scrollX,
    y: dataOrigin.y + y * cellHeight - viewport.scrollY,
    width: cellWidth,
    height: cellHeight,
  });

  const rowHeaderRect = (depth, offset, size) => ({
    x: depth * rowHeaderWidth,
    y: dataOrigin.y + offset * cellHeight - viewport.scrollY,
    width: rowHeaderWidth,
    height: size * cellHeight,
  });

  const colHeaderRect = (depth, offset, size) => ({
    x: dataOrigin.x + offset * cellWidth - viewport.scrollX,
    y: depth * colHeaderHeight,
    width: size * cellWidth,
    height: colHeaderHeight,
  });

  return {
    layout,
    cellSize,
    headerSize,
    depths: { row: rowDepth, col: colDepth },
    grid: { cols, rows },
    dataOrigin,
    dataSize,
    contentSize,
    viewport,
    dataViewport,
    dataClip: dataViewport,
    rowHeaderClip: {
      x: 0,
      y: dataOrigin.y,
      width: dataOrigin.x,
      height: dataViewport.height,
    },
    colHeaderClip: {
      x: dataOrigin.x,
      y: 0,
      width: dataViewport.width,
      height: dataOrigin.y,
    },
    corner: { x: 0, y: 0, width: dataOrigin.x, height: dataOrigin.y },
    /** 内容坐标里当前可见的内容范围，供表头按 offset 剪枝。 */
    contentVisible: {
      x: viewport.scrollX,
      y: viewport.scrollY,
      width: dataViewport.width,
      height: dataViewport.height,
    },
    visible: {
      x0: xRange.start,
      x1: xRange.end,
      y0: yRange.start,
      y1: yRange.end,
    },
    cellRect,
    rowHeaderRect,
    colHeaderRect,
  };
}

/** 两个屏幕矩形是否真正相交（宽或高为 0 视为不相交）。 */
export function rectsIntersect(a, b) {
  return (
    a.width > 0 &&
    a.height > 0 &&
    b.width > 0 &&
    b.height > 0 &&
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

// ---------------------------------------------------------------------------
// 内部
// ---------------------------------------------------------------------------

function assertLayout(layout) {
  if (
    !layout ||
    typeof layout !== 'object' ||
    !layout.size ||
    !Number.isInteger(layout.size.rows) ||
    !Number.isInteger(layout.size.cols) ||
    layout.size.rows < 0 ||
    layout.size.cols < 0
  ) {
    throw new TypeError(
      'computePivotGeometry: layout 必须是 layoutPivot() 的返回值（缺少合法的 size.rows / size.cols）',
    );
  }
}

function numberOption(value, fallback, { name, allowZero = true }) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new Error(`${name} 必须是${allowZero ? '非负' : '正'}有限数值`);
  }
  return value;
}

function finiteNumberOption(value, fallback, name) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} 必须是有限数值`);
  }
  return value;
}

function normalizeViewport(raw, contentSize) {
  const width = numberOption(raw?.width, contentSize.width, { name: 'viewport.width' });
  const height = numberOption(raw?.height, contentSize.height, { name: 'viewport.height' });
  const maxScrollX = Math.max(0, contentSize.width - width);
  const maxScrollY = Math.max(0, contentSize.height - height);

  // 滚动偏移来自滚轮/拖拽等 UI 输入，越界（包括负数）直接 clamp；
  // 只有 NaN / Infinity 这种非有限值才视为配置错误。
  const scrollX = clamp(
    finiteNumberOption(raw?.scrollX, 0, 'viewport.scrollX'),
    0,
    maxScrollX,
  );
  const scrollY = clamp(
    finiteNumberOption(raw?.scrollY, 0, 'viewport.scrollY'),
    0,
    maxScrollY,
  );

  return {
    width,
    height,
    scrollX,
    scrollY,
    maxScrollX,
    maxScrollY,
    canScrollX: maxScrollX > 0,
    canScrollY: maxScrollY > 0,
  };
}

function axisRange(count, unitSize, scroll, viewSize, overscan) {
  if (count <= 0 || viewSize <= 0) return { start: 0, end: -1 };

  const start = clamp(Math.floor(scroll / unitSize) - overscan, 0, count - 1);
  const end = clamp(
    Math.ceil((scroll + viewSize) / unitSize) - 1 + overscan,
    0,
    count - 1,
  );
  return { start, end };
}

function clamp(value, lower, upper) {
  return Math.min(upper, Math.max(lower, value));
}
