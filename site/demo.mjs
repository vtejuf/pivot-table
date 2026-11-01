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
 *   [data-demo-width]    列宽 range
 *   [data-demo-reset]    重置滚动按钮
 *   [data-demo-zoom]     列宽显示
 *   [data-demo-grid-size] / [data-demo-stats] / [data-demo-matrix] 状态文本
 *
 * 并列度量只负责布局数据：度量作为列轴最末层维度。热力图由 feature 通过
 * cellStyle 提供；双度量时按 measure 分别计算色阶。
 *
 * 后续扩展点（小计/总计、折叠/展开）：
 * - 在 rebuildLayout() 里对聚合行做附加处理，再交给 layoutPivot；
 * - 或扩展 layout 的可见成员集合后再 render。
 * - 新控件继续用 data-demo-* 暴露，并在 createPivotDemo 内绑定。
 */

import { layoutPivot } from '../src/model/index.mjs';
import { renderPivot } from '../src/render/index.mjs';
import {
  createCornerLabels,
  renderWithOverlay,
} from '../src/features/overlay.mjs';
import { combineMeasures } from '../src/features/dual-measure.mjs';
import { createHeatmapStyle } from '../src/features/heatmap.mjs';
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
  const cornerLabels = createCornerLabels();
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
    layout = layoutPivot(cube.rows, {
      dimensions: cube.dimensions,
      value: dual ? cube.value : cube.measure.key,
      mode: modeSelect?.value ?? 'compact',
    });
    heatmapStyle = null;
    if (resetScroll) {
      scrollX = 0;
      scrollY = 0;
    }
    render();
  }

  function getHeatmapCellStyle() {
    if (heatmapInput && !heatmapInput.checked) return undefined;
    if (!heatmapStyle) {
      heatmapStyle = createHeatmapStyle(layout, { measureKey: 'measure' });
    }
    return heatmapStyle.cellStyle;
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

    const { geometry, stats } = overlayInput?.checked
      ? renderWithOverlay(canvas, layout, renderOptions, cornerLabels)
      : renderPivot(canvas, layout, renderOptions);

    lastGeometry = geometry;
    scrollX = geometry.viewport.scrollX;
    scrollY = geometry.viewport.scrollY;
    updateStatus(cellWidth, stats);
  }

  function updateStatus(cellWidth, stats) {
    if (zoomEl) zoomEl.textContent = `${cellWidth}px`;

    if (gridSizeEl) {
      gridSizeEl.innerHTML =
        `<strong>${layout.size.rows} 行 × ${layout.size.cols} 列</strong>` +
        ` · ${layout.mode}` +
        (isDual() ? ' · 并列度量' : '');
    }

    if (statsEl) {
      statsEl.innerHTML =
        `绘制 <strong>${stats.drawnCells}</strong>/${stats.cellsInGrid} 格` +
        ` · 表头 <strong>${stats.headerCells}</strong> 块` +
        ` · 网格线 <strong>${stats.gridLines}</strong> 条`;
    }

    if (matrixEl) {
      matrixEl.textContent = layout.matrix
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

  let drag = null;
  listen(canvas, 'pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
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
    if (!drag || drag.pointerId !== event.pointerId) return;
    scrollX = drag.scrollX - (event.clientX - drag.startX);
    scrollY = drag.scrollY - (event.clientY - drag.startY);
    render();
  });

  const endDrag = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag = null;
    canvas.classList.remove('is-dragging');
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
