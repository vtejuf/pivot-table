/**
 * 主页与 examples/canvas.html 共用的透视表 Demo 控制器。
 *
 * UI 契约通过 data-demo-* 属性查找，页面可以只提供其中一部分控件：
 *   [data-demo-canvas]   canvas（必需）
 *   [data-demo-mode]     布局模式 select：compact / cartesian
 *   [data-demo-measure]  度量 select：sales / count
 *   [data-demo-dual-measure] 并列度量 checkbox
 *   [data-demo-heatmap]  数值色阶 checkbox
 *   [data-demo-marker]   高值标记 checkbox（自定义 feature 示例）
 *   [data-demo-collapse] 折叠模式 checkbox（点击父表头折叠 / 展开）
 *   [data-demo-overlay]  角区标签开关
 *   [data-demo-row-subtotal] 行小计 checkbox
 *   [data-demo-row-total]    行总计 checkbox
 *   [data-demo-col-subtotal] 列小计 checkbox
 *   [data-demo-col-total]    列总计 checkbox
 *   [data-demo-width]    列宽 range
 *   [data-demo-reset]    重置滚动按钮
 *   [data-demo-zoom]     列宽显示
 *   [data-demo-grid-size] / [data-demo-stats] / [data-demo-matrix] 状态文本
 *
 * 并列度量只负责布局数据：度量作为列轴最末层维度。热力图由 feature 通过
 * cellStyle 提供；双度量时按 measure 分别计算色阶。高值标记由
 * features/cell-marker.mjs 提供，cellStyle 上色 + overlay 画角标。
 *
 * 折叠模式由 features/collapse.mjs 接入：开启后点击行/列父表头折叠，
 * 关闭时清除状态并恢复完整布局。首版只支持 compact 单度量，与并列度量、
 * 行/列汇总、cartesian 互斥（控件会自动禁用并清除折叠状态）。
 *
 * 滚动条始终启用：由 features/scrollbar.mjs 在核心绘制后叠加，无需控件。
 * 交互后显示，停止操作约 900ms 后淡出；悬停或拖动滚动条时固定显示。
 * 指针命中滚动条时优先拖动滚动条，其余区域继续拖拽平移；滚轮、方向键和
 * 滚动条最终都写回 scrollX / scrollY，然后统一重绘。
 *
 * 行/列小计、总计由 features/totals.mjs 接入：单度量用 rollupTotals()，
 * 并列度量用 rollupMultiTotals() 按 measure 分列上卷，再由 withTotals() 派生。
 *
 * 后续扩展点（折叠/展开）：
 * - 在 rebuildLayout() 里对可见成员集合做过滤或上卷，再调用 totals/layout；
 * - 新控件继续用 data-demo-* 暴露，并在 createPivotDemo 内绑定。
 */

import { layoutPivot } from '../src/model/index.mjs';
import {
  createCornerLabels,
  renderWithOverlay,
} from '../src/features/overlay.mjs';
import {
  createScrollbarAutoHide,
  createScrollbarOverlay,
  scrollFromThumbPosition,
} from '../src/features/scrollbar.mjs';
import { combineMeasures } from '../src/features/dual-measure.mjs';
import { createHeatmapStyle } from '../src/features/heatmap.mjs';
import { createCellMarker } from '../src/features/cell-marker.mjs';
import {
  collapseCube,
  drawCollapseIndicators,
  hitTestHeader,
} from '../src/features/collapse.mjs';
import {
  rollupMultiTotals,
  rollupTotals,
  withTotals,
} from '../src/features/totals.mjs';
import { salesCube, countCube } from '../examples/sample-data.mjs';

const DEFAULT_CELL_WIDTH = 104;
const DEFAULT_HEIGHT = 560;
/** 自动隐藏后不再响应 pointerdown，避免误触不可见的滚动条。 */
const SCROLLBAR_HIT_OPACITY = 0.05;

const requestFrame =
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (callback) => setTimeout(callback, 16);
const cancelFrame =
  typeof cancelAnimationFrame === 'function'
    ? cancelAnimationFrame
    : clearTimeout;

export function createPivotDemo(root = document, options = {}) {
  const scope = root ?? document;
  const canvas = scope.querySelector('[data-demo-canvas]');
  if (!canvas) {
    throw new Error('createPivotDemo: 页面缺少 [data-demo-canvas]');
  }

  const stage = canvas.parentElement ?? canvas;
  const modeSelect = scope.querySelector('[data-demo-mode]');
  const measureSelect = scope.querySelector('[data-demo-measure]');
  const dualInput = scope.querySelector('[data-demo-dual-measure]');
  const heatmapInput = scope.querySelector('[data-demo-heatmap]');
  const markerInput = scope.querySelector('[data-demo-marker]');
  const collapseInput = scope.querySelector('[data-demo-collapse]');
  const overlayInput = scope.querySelector('[data-demo-overlay]');
  const rowSubtotalInput = scope.querySelector('[data-demo-row-subtotal]');
  const rowTotalInput = scope.querySelector('[data-demo-row-total]');
  const colSubtotalInput = scope.querySelector('[data-demo-col-subtotal]');
  const colTotalInput = scope.querySelector('[data-demo-col-total]');
  const widthInput = scope.querySelector('[data-demo-width]');
  const resetButton = scope.querySelector('[data-demo-reset]');
  const zoomEl = scope.querySelector('[data-demo-zoom]');
  const gridSizeEl = scope.querySelector('[data-demo-grid-size]');
  const statsEl = scope.querySelector('[data-demo-stats]');
  const matrixEl = scope.querySelector('[data-demo-matrix]');

  const getHeight =
    typeof options.height === 'function'
      ? options.height
      : () => options.height ?? DEFAULT_HEIGHT;
  const getWidth =
    typeof options.width === 'function'
      ? options.width
      : () => Math.max(320, stage.clientWidth || 0);

  const dualCube = combineMeasures({
    dimensions: salesCube.dimensions,
    measures: [
      {
        label: '销售额',
        rows: salesCube.rows,
        valueField: salesCube.measure.key,
      },
      {
        label: '订单数',
        rows: countCube.rows,
        valueField: countCube.measure.key,
      },
    ],
  });

  let layout = null;
  let scrollX = 0;
  let scrollY = 0;
  let lastGeometry = null;
  let heatmapStyle = null;
  let heatmapCellStyle = null;
  let markerFeature = null;
  let totalsActive = false;
  let hoverAxis = null;
  let collapseMode = false;
  const collapsed = new Set();
  const cornerLabels = createCornerLabels();
  const scrollbarOverlay = createScrollbarOverlay();
  const autoHide = createScrollbarAutoHide();
  let scrollbarTimer = 0;
  let scrollbarFrame = 0;
  const cleanups = [];

  const listen = (target, type, handler, listenerOptions) => {
    if (!target) return;
    target.addEventListener(type, handler, listenerOptions);
    cleanups.push(() => target.removeEventListener(type, handler, listenerOptions));
  };

  const currentCube = () =>
    measureSelect?.value === 'count' ? countCube : salesCube;
  const isDual = () => Boolean(dualInput?.checked);

  function syncDualControls(dual) {
    if (measureSelect) measureSelect.disabled = dual;
  }

  function syncCollapseControl({ dual, totalsRequested, mode }) {
    if (!collapseInput) {
      collapseMode = false;
      collapsed.clear();
      return;
    }

    const unsupported = dual || totalsRequested || mode === 'cartesian';
    collapseInput.disabled = unsupported;

    if (unsupported) {
      if (collapseInput.checked) collapseInput.checked = false;
      collapseMode = false;
      collapsed.clear();
      canvas.classList.remove('is-header-hover');
      return;
    }

    collapseMode = Boolean(collapseInput.checked);
    if (!collapseMode) collapsed.clear();
  }

  function rebuildLayout(resetScroll = true) {
    const dual = isDual();
    const mode = modeSelect?.value ?? 'compact';
    const rowSubtotal = Boolean(rowSubtotalInput?.checked);
    const rowTotal = Boolean(rowTotalInput?.checked);
    const colSubtotal = Boolean(colSubtotalInput?.checked);
    const colTotal = Boolean(colTotalInput?.checked);
    const totalsRequested =
      rowSubtotal || rowTotal || colSubtotal || colTotal;

    syncCollapseControl({ dual, totalsRequested, mode });

    const cube = dual ? dualCube : currentCube();
    const source =
      collapseMode &&
      collapsed.size > 0 &&
      !dual &&
      !totalsRequested &&
      mode === 'compact'
        ? collapseCube(cube, collapsed)
        : cube;
    const base = layoutPivot(source.rows, {
      dimensions: source.dimensions,
      value: dual ? cube.value : cube.measure.key,
      mode,
    });

    totalsActive = false;

    if (!dual && totalsRequested) {
      const rolled = rollupTotals(cube, {
        rows: {
          subtotals: rowSubtotal ? ['region'] : [],
          grandTotal: rowTotal,
        },
        cols: {
          subtotals: colSubtotal ? ['year'] : [],
          grandTotal: colTotal,
        },
      });
      layout = withTotals(base, rolled);
      totalsActive = !rolled.skipped;
    } else if (dual && totalsRequested) {
      const rolled = rollupMultiTotals(
        [
          { label: '销售额', cube: salesCube },
          { label: '订单数', cube: countCube },
        ],
        {
          rows: {
            subtotals: rowSubtotal ? ['region'] : [],
            grandTotal: rowTotal,
          },
          cols: {
            subtotals: colSubtotal ? ['year'] : [],
            grandTotal: colTotal,
          },
          measureKey: dualCube.measureKey,
          valueKey: dualCube.value,
        },
      );
      layout = withTotals(base, rolled);
      totalsActive = !rolled.skipped;
    } else {
      layout = base;
    }

    heatmapStyle = null;
    heatmapCellStyle = null;
    markerFeature = null;
    if (resetScroll) {
      scrollX = 0;
      scrollY = 0;
    }
    render();
  }

  function getHeatmapCellStyle() {
    if (heatmapInput && !heatmapInput.checked) return undefined;
    if (!heatmapStyle) {
      const dataCells = layout.cells.filter((cell) => !cell.kind);
      const style = createHeatmapStyle(
        { ...layout, cells: dataCells },
        { measureKey: 'measure' },
      );
      heatmapStyle = style;
      heatmapCellStyle = (cell) =>
        cell?.kind ? undefined : style.cellStyle(cell);
    }
    return heatmapCellStyle;
  }

  function getMarkerFeature() {
    if (!markerInput?.checked || !layout) return null;
    if (markerFeature) return markerFeature;

    const values = layout.cells
      .map((cell) => cell.value)
      .filter((value) => typeof value === 'number' && Number.isFinite(value))
      .sort((a, b) => a - b);

    const threshold =
      values.length > 0
        ? values[Math.min(values.length - 1, Math.floor(values.length * 0.8))]
        : Number.POSITIVE_INFINITY;

    markerFeature = createCellMarker(layout, {
      test: (cell) =>
        typeof cell.value === 'number' &&
        Number.isFinite(cell.value) &&
        cell.value >= threshold,
    });
    return markerFeature;
  }

  function headerHit(point) {
    if (!collapseMode || !layout || !lastGeometry) return null;
    return hitTestHeader(layout, lastGeometry, point);
  }

  function toggleCollapse(target) {
    if (!target) return;
    if (collapsed.has(target.key)) collapsed.delete(target.key);
    else collapsed.add(target.key);
    canvas.classList.remove('is-header-hover');
    rebuildLayout(false);
  }

  function updateHeaderHover(point) {
    canvas.classList.toggle('is-header-hover', Boolean(headerHit(point)));
  }

  function render() {
    if (!layout) return;

    const cellWidth = clampNumber(widthInput?.value, 40, 240, DEFAULT_CELL_WIDTH);
    const marker = getMarkerFeature();
    const heatmap = getHeatmapCellStyle();
    const cellStyle =
      marker && heatmap
        ? (cell, context) =>
            marker.cellStyle(cell, context) ?? heatmap(cell, context)
        : (marker?.cellStyle ?? heatmap);

    const renderOptions = {
      viewport: {
        width: Math.max(320, getWidth()),
        height: Math.max(240, getHeight()),
        scrollX,
        scrollY,
      },
      cellSize: { width: cellWidth, height: 28 },
      headerSize: { row: Math.max(68, Math.round(cellWidth * 0.86)), col: 28 },
      cellStyle,
      formatValue: (value) =>
        typeof value === 'number' ? value.toLocaleString('zh-CN') : String(value),
    };

    const drawOverlays = (ctx, context) => {
      if (collapseMode) {
        drawCollapseIndicators(ctx, {
          layout,
          geometry: context.geometry,
          collapsed,
        });
      }
      if (marker) marker.draw(ctx, context);
      if (overlayInput?.checked) cornerLabels(ctx, context);
      scrollbarOverlay.draw(ctx, context);
    };

    const { geometry, stats } = renderWithOverlay(
      canvas,
      layout,
      renderOptions,
      drawOverlays,
    );

    lastGeometry = geometry;
    scrollX = geometry.viewport.scrollX;
    scrollY = geometry.viewport.scrollY;

    // 布局 / 视口变化后滚动条可能消失，清掉残留的 hover 状态。
    if (hoverAxis) {
      const bars = scrollbarOverlay.getGeometry(geometry);
      const stillVisible =
        hoverAxis === 'y' ? bars?.vertical.visible : bars?.horizontal.visible;
      if (!stillVisible) {
        hoverAxis = null;
        scrollbarOverlay.setHover(null);
        canvas.classList.remove('is-scrollbar-hover');
        unpinScrollbars();
      }
    }

    updateStatus(cellWidth, stats);
  }

  function clearScrollbarTimers() {
    if (scrollbarTimer) {
      clearTimeout(scrollbarTimer);
      scrollbarTimer = 0;
    }
    if (scrollbarFrame) {
      cancelFrame(scrollbarFrame);
      scrollbarFrame = 0;
    }
  }

  function startScrollbarFade() {
    cancelFrame(scrollbarFrame);
    scrollbarFrame = 0;
    if (autoHide.pinned) return;

    const step = () => {
      scrollbarFrame = 0;
      const opacity = autoHide.opacity();
      scrollbarOverlay.setOpacity(opacity);
      render();

      if (opacity > 0) {
        scrollbarFrame = requestFrame(step);
      }
    };
    step();
  }

  function scheduleScrollbarHide() {
    if (scrollbarTimer || autoHide.pinned) return;

    scrollbarTimer = setTimeout(() => {
      scrollbarTimer = 0;
      startScrollbarFade();
    }, autoHide.delay);
  }

  function revealScrollbars() {
    clearScrollbarTimers();
    autoHide.show();
    scrollbarOverlay.setOpacity(1);
    scheduleScrollbarHide();
  }

  function pinScrollbars() {
    clearScrollbarTimers();
    autoHide.setPinned(true);
    scrollbarOverlay.setOpacity(1);
  }

  function unpinScrollbars() {
    if (!autoHide.pinned) return;
    autoHide.setPinned(false);
    scheduleScrollbarHide();
  }

  function updateStatus(cellWidth, stats) {
    if (zoomEl) zoomEl.textContent = `${cellWidth}px`;

    if (gridSizeEl) {
      gridSizeEl.innerHTML =
        `<strong>${layout.size.rows} 行 × ${layout.size.cols} 列</strong>` +
        ` · ${layout.mode}` +
        (totalsActive ? ' · 行/列汇总' : '') +
        (collapseMode ? ` · 折叠 ${collapsed.size}` : '') +
        (isDual() ? ' · 并列度量' : '');
    }

    if (statsEl) {
      statsEl.innerHTML =
        `绘制 <strong>${stats.drawnCells}</strong>/${stats.cellsInGrid} 格` +
        ` · 表头 <strong>${stats.headerCells}</strong> 块` +
        ` · 网格线 <strong>${stats.gridLines}</strong> 条`;
    }

    if (matrixEl) {
      matrixEl.textContent = totalsActive
        ? '含汇总 · 无全局矩阵'
        : layout.matrix
          ? `固定矩阵 ${layout.matrix.length}×${layout.matrix[0].length}`
          : '分段仿射 · 无全局矩阵';
    }
  }

  listen(modeSelect, 'change', () => rebuildLayout());
  listen(measureSelect, 'change', () => rebuildLayout());
  listen(dualInput, 'change', () => {
    syncDualControls(isDual());
    rebuildLayout();
  });
  listen(heatmapInput, 'change', render);
  listen(markerInput, 'change', render);
  listen(collapseInput, 'change', () => {
    canvas.classList.remove('is-header-hover');
    rebuildLayout(false);
  });
  listen(overlayInput, 'change', render);
  listen(rowSubtotalInput, 'change', () => rebuildLayout());
  listen(rowTotalInput, 'change', () => rebuildLayout());
  listen(colSubtotalInput, 'change', () => rebuildLayout());
  listen(colTotalInput, 'change', () => rebuildLayout());
  listen(widthInput, 'input', render);
  listen(resetButton, 'click', () => {
    revealScrollbars();
    scrollX = 0;
    scrollY = 0;
    render();
  });

  listen(
    canvas,
    'wheel',
    (event) => {
      event.preventDefault();
      revealScrollbars();
      const unit = event.deltaMode === 1 ? 16 : 1;
      scrollX += (event.shiftKey ? event.deltaY : event.deltaX) * unit;
      scrollY += (event.shiftKey ? 0 : event.deltaY) * unit;
      render();
    },
    { passive: false },
  );

  function canvasPoint(event) {
    const rect =
      typeof canvas.getBoundingClientRect === 'function'
        ? canvas.getBoundingClientRect()
        : null;
    const viewport = lastGeometry?.viewport;
    if (rect && viewport && rect.width > 0 && rect.height > 0) {
      return {
        x: ((event.clientX - rect.left) / rect.width) * viewport.width,
        y: ((event.clientY - rect.top) / rect.height) * viewport.height,
      };
    }
    return { x: event.offsetX ?? 0, y: event.offsetY ?? 0 };
  }

  function applyScrollbarDrag(point) {
    if (!scrollbarDrag || !lastGeometry) return;

    const bars = scrollbarOverlay.getGeometry(lastGeometry);
    const bar = scrollbarDrag.axis === 'y' ? bars?.vertical : bars?.horizontal;
    if (!bar?.visible) return;

    const position = scrollbarDrag.axis === 'y' ? point.y : point.x;
    const next = scrollFromThumbPosition(
      bar,
      position,
      scrollbarDrag.grabOffset,
    );
    if (scrollbarDrag.axis === 'y') scrollY = next;
    else scrollX = next;
    render();
  }

  function updateScrollbarHover(point) {
    const hit = lastGeometry
      ? scrollbarOverlay.hitTest(point.x, point.y, lastGeometry)
      : null;
    const axis = hit?.axis ?? null;
    if (axis === hoverAxis) return;

    hoverAxis = axis;
    scrollbarOverlay.setHover(axis);
    canvas.classList.toggle('is-scrollbar-hover', Boolean(axis));
    if (axis) pinScrollbars();
    else unpinScrollbars();
    render();
  }

  let drag = null;
  let scrollbarDrag = null;

  listen(canvas, 'pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const point = canvasPoint(event);
    const hit = lastGeometry
      ? scrollbarOverlay.hitTest(point.x, point.y, lastGeometry)
      : null;

    if (hit && scrollbarOverlay.opacity > SCROLLBAR_HIT_OPACITY) {
      const thumbStart = hit.axis === 'y' ? hit.bar.thumb.y : hit.bar.thumb.x;
      scrollbarDrag = {
        pointerId: event.pointerId,
        axis: hit.axis,
        grabOffset:
          hit.part === 'thumb'
            ? (hit.axis === 'y' ? point.y : point.x) - thumbStart
            : hit.bar.thumbLength / 2,
      };
      scrollbarOverlay.setActive(hit.axis);
      pinScrollbars();
      canvas.classList.add('is-scrollbar-dragging');
      canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      if (hit.part === 'track') applyScrollbarDrag(point);
      else render();
      return;
    }

    if (collapseMode) {
      const header = headerHit(point);
      if (header) {
        event.preventDefault();
        toggleCollapse(header);
        return;
      }
    }

    revealScrollbars();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollX,
      scrollY,
    };
    canvas.setPointerCapture?.(event.pointerId);
    canvas.classList.add('is-dragging');
    render();
  });

  listen(canvas, 'pointermove', (event) => {
    if (scrollbarDrag && scrollbarDrag.pointerId === event.pointerId) {
      applyScrollbarDrag(canvasPoint(event));
      return;
    }

    if (drag) {
      if (drag.pointerId !== event.pointerId) return;
      revealScrollbars();
      scrollX = drag.scrollX - (event.clientX - drag.startX);
      scrollY = drag.scrollY - (event.clientY - drag.startY);
      render();
      return;
    }

    if (event.pointerType !== 'touch') {
      const point = canvasPoint(event);
      updateHeaderHover(point);
      updateScrollbarHover(point);
    }
  });

  listen(canvas, 'pointerleave', () => {
    if (scrollbarDrag) return;
    canvas.classList.remove('is-header-hover');
    const hadHover = hoverAxis !== null;
    hoverAxis = null;
    scrollbarOverlay.setHover(null);
    canvas.classList.remove('is-scrollbar-hover');
    unpinScrollbars();
    if (hadHover) render();
  });

  const endDrag = (event) => {
    const endsScrollbar =
      scrollbarDrag !== null && scrollbarDrag.pointerId === event.pointerId;
    const endsPan = drag !== null && drag.pointerId === event.pointerId;
    if (!endsScrollbar && !endsPan) return;

    if (endsScrollbar) {
      scrollbarDrag = null;
      scrollbarOverlay.setActive(null);
      canvas.classList.remove('is-scrollbar-dragging');

      const point = canvasPoint(event);
      const hit = lastGeometry
        ? scrollbarOverlay.hitTest(point.x, point.y, lastGeometry)
        : null;
      if (hit) {
        hoverAxis = hit.axis;
        scrollbarOverlay.setHover(hit.axis);
        canvas.classList.add('is-scrollbar-hover');
        pinScrollbars();
      } else {
        hoverAxis = null;
        scrollbarOverlay.setHover(null);
        canvas.classList.remove('is-scrollbar-hover');
        unpinScrollbars();
      }
      render();
    }
    if (endsPan) {
      drag = null;
      canvas.classList.remove('is-dragging');
    }
    if (canvas.hasPointerCapture?.(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };
  listen(canvas, 'pointerup', endDrag);
  listen(canvas, 'pointercancel', endDrag);

  listen(canvas, 'keydown', (event) => {
    const step = 48;
    const page = Math.max(
      step,
      (lastGeometry?.dataViewport.height ?? 400) - 28,
    );

    switch (event.key) {
      case 'ArrowLeft':
        scrollX -= step;
        break;
      case 'ArrowRight':
        scrollX += step;
        break;
      case 'ArrowUp':
        scrollY -= step;
        break;
      case 'ArrowDown':
        scrollY += step;
        break;
      case 'PageUp':
        scrollY -= page;
        break;
      case 'PageDown':
        scrollY += page;
        break;
      case 'Home':
        scrollX = 0;
        scrollY = 0;
        break;
      case 'End':
        scrollX = lastGeometry?.viewport.maxScrollX ?? Number.MAX_SAFE_INTEGER;
        scrollY = lastGeometry?.viewport.maxScrollY ?? Number.MAX_SAFE_INTEGER;
        break;
      default:
        return;
    }

    event.preventDefault();
    revealScrollbars();
    render();
  });

  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => render());
    observer.observe(stage);
    cleanups.push(() => observer.disconnect());
  } else {
    listen(window, 'resize', render);
  }

  if (dualInput) syncDualControls(isDual());
  rebuildLayout();

  if (lastGeometry?.viewport.canScrollX || lastGeometry?.viewport.canScrollY) {
    revealScrollbars();
  }

  return {
    render,
    rebuild: rebuildLayout,
    destroy() {
      clearScrollbarTimers();
      while (cleanups.length > 0) cleanups.pop()();
    },
    get layout() {
      return layout;
    },
    get geometry() {
      return lastGeometry;
    },
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
