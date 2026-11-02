/**
 * 主页与 examples/canvas.html 共用的透视表 Demo 控制器。
 *
 * UI 契约通过 data-demo-* 属性查找，页面可以只提供其中一部分控件：
 *   [data-demo-canvas]   canvas（必需）
 *   [data-demo-mode]     布局模式 select：compact / cartesian
 *   [data-demo-measure]  度量 select：sales / count
 *   [data-demo-dual-measure] 并列度量 checkbox
 *   [data-demo-heatmap]  数值色阶 checkbox
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
 * cellStyle 提供；双度量时按 measure 分别计算色阶。
 *
 * 滚动条始终启用：由 features/scrollbar.mjs 在核心绘制后叠加，无需控件。
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
  createScrollbarOverlay,
  scrollFromThumbPosition,
} from '../src/features/scrollbar.mjs';
import { combineMeasures } from '../src/features/dual-measure.mjs';
import { createHeatmapStyle } from '../src/features/heatmap.mjs';
import {
  rollupMultiTotals,
  rollupTotals,
  withTotals,
} from '../src/features/totals.mjs';
import { salesCube, countCube } from '../examples/sample-data.mjs';

const DEFAULT_CELL_WIDTH = 104;
const DEFAULT_HEIGHT = 560;

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
  let totalsActive = false;
  let hoverAxis = null;
  const cornerLabels = createCornerLabels();
  const scrollbarOverlay = createScrollbarOverlay();
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

  function rebuildLayout(resetScroll = true) {
    const dual = isDual();
    const cube = dual ? dualCube : currentCube();
    const base = layoutPivot(cube.rows, {
      dimensions: cube.dimensions,
      value: dual ? cube.value : cube.measure.key,
      mode: modeSelect?.value ?? 'compact',
    });

    totalsActive = false;
    const rowSubtotal = Boolean(rowSubtotalInput?.checked);
    const rowTotal = Boolean(rowTotalInput?.checked);
    const colSubtotal = Boolean(colSubtotalInput?.checked);
    const colTotal = Boolean(colTotalInput?.checked);

    if (!dual && (rowSubtotal || rowTotal || colSubtotal || colTotal)) {
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
    } else if (dual && (rowSubtotal || rowTotal || colSubtotal || colTotal)) {
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

  function render() {
    if (!layout) return;

    const cellWidth = clampNumber(widthInput?.value, 40, 240, DEFAULT_CELL_WIDTH);
    const renderOptions = {
      viewport: {
        width: Math.max(320, getWidth()),
        height: Math.max(240, getHeight()),
        scrollX,
        scrollY,
      },
      cellSize: { width: cellWidth, height: 28 },
      headerSize: { row: Math.max(68, Math.round(cellWidth * 0.86)), col: 28 },
      cellStyle: getHeatmapCellStyle(),
      formatValue: (value) =>
        typeof value === 'number' ? value.toLocaleString('zh-CN') : String(value),
    };

    const drawOverlays = (ctx, context) => {
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
      }
    }

    updateStatus(cellWidth, stats);
  }

  function updateStatus(cellWidth, stats) {
    if (zoomEl) zoomEl.textContent = `${cellWidth}px`;

    if (gridSizeEl) {
      gridSizeEl.innerHTML =
        `<strong>${layout.size.rows} 行 × ${layout.size.cols} 列</strong>` +
        ` · ${layout.mode}` +
        (totalsActive ? ' · 行/列汇总' : '') +
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
  listen(overlayInput, 'change', render);
  listen(rowSubtotalInput, 'change', () => rebuildLayout());
  listen(rowTotalInput, 'change', () => rebuildLayout());
  listen(colSubtotalInput, 'change', () => rebuildLayout());
  listen(colTotalInput, 'change', () => rebuildLayout());
  listen(widthInput, 'input', render);
  listen(resetButton, 'click', () => {
    scrollX = 0;
    scrollY = 0;
    render();
  });

  listen(
    canvas,
    'wheel',
    (event) => {
      event.preventDefault();
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

    if (hit) {
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
      canvas.classList.add('is-scrollbar-dragging');
      canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      if (hit.part === 'track') applyScrollbarDrag(point);
      return;
    }

    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollX,
      scrollY,
    };
    canvas.setPointerCapture?.(event.pointerId);
    canvas.classList.add('is-dragging');
  });

  listen(canvas, 'pointermove', (event) => {
    if (scrollbarDrag && scrollbarDrag.pointerId === event.pointerId) {
      applyScrollbarDrag(canvasPoint(event));
      return;
    }

    if (drag) {
      if (drag.pointerId !== event.pointerId) return;
      scrollX = drag.scrollX - (event.clientX - drag.startX);
      scrollY = drag.scrollY - (event.clientY - drag.startY);
      render();
      return;
    }

    if (event.pointerType !== 'touch') {
      updateScrollbarHover(canvasPoint(event));
    }
  });

  listen(canvas, 'pointerleave', () => {
    if (scrollbarDrag || hoverAxis === null) return;
    hoverAxis = null;
    scrollbarOverlay.setHover(null);
    canvas.classList.remove('is-scrollbar-hover');
    render();
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

  return {
    render,
    rebuild: rebuildLayout,
    destroy() {
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
