/**
 * 主页「按功能查看示例」的代码片段。
 *
 * 每个片段都是独立的最小调用，共享同一组 rows / dimensions / cube / layout；
 * 完整交互与状态编排见 site/demo.mjs 和 examples/canvas.html。
 */

import { normalizeLang } from './i18n.mjs';

export const codeExamples = [
  {
    id: 'core',
    label: '核心渲染',
    file: 'app.mjs',
    note: 'rows / dimensions 由业务提供；每个维度需要显式 axis，层级维度再加 parent。完整示例见 examples/canvas.html。',
    code: `import { aggregate, layoutPivot } from './src/model/index.mjs';
import { renderPivot } from './src/render/index.mjs';

const cube = aggregate(rows, {
  dimensions,
  measure: { key: 'sales', aggregate: 'sum' },
});

const layout = layoutPivot(cube.rows, {
  dimensions,
  value: 'sales',
});

renderPivot(canvas, layout, {
  viewport: { width: 960, height: 540 },
  cellSize: { width: 104, height: 28 },
});`,
  },
  {
    id: 'dual',
    label: '并列度量',
    file: 'dual-measure.mjs',
    note: '两个 aggregate 结果分别作为度量；value 指向合成后的值字段。',
    code: `import { layoutPivot } from './src/model/index.mjs';
import { combineMeasures } from './src/features/dual-measure.mjs';

const dual = combineMeasures({
  dimensions,
  measures: [
    { label: '销售额', rows: salesCube.rows, valueField: salesCube.measure.key },
    { label: '订单数', rows: countCube.rows, valueField: countCube.measure.key },
  ],
});

const layout = layoutPivot(dual.rows, {
  dimensions: dual.dimensions,
  value: dual.value,
});`,
  },
  {
    id: 'heatmap',
    label: '数值色阶',
    file: 'heatmap.mjs',
    note: '并列度量时按 measure 自动分组；空值交回核心默认样式。',
    code: `import { renderPivot } from './src/render/index.mjs';
import { createHeatmapStyle } from './src/features/heatmap.mjs';

const heatmap = createHeatmapStyle(layout);

renderPivot(canvas, layout, {
  viewport,
  cellStyle: heatmap.cellStyle,
});`,
  },
  {
    id: 'totals',
    label: '行/列汇总',
    file: 'totals.mjs',
    note: 'rollupTotals 读取 cube，withTotals 派生展示布局；折叠父级可用 shouldIncludeSubtotal 跳过小计。',
    code: `import { layoutPivot } from './src/model/index.mjs';
import { renderPivot } from './src/render/index.mjs';
import { rollupTotals, withTotals } from './src/features/totals.mjs';

const rolled = rollupTotals(cube, {
  rows: { subtotals: ['region'], grandTotal: true },
  cols: { subtotals: ['year'], grandTotal: true },
});

const base = layoutPivot(cube.rows, {
  dimensions,
  value: 'sales',
});
// 折叠场景：withTotals(base, rolled, { shouldIncludeSubtotal })
const display = withTotals(base, rolled);

renderPivot(canvas, display, { viewport });`,
  },
  {
    id: 'overlay',
    label: '角区标签',
    file: 'overlay.mjs',
    note: 'draw 回调也可以替换成选中框、参考线等自定义装饰。',
    code: `import { createCornerLabels, renderWithOverlay } from './src/features/overlay.mjs';

const cornerLabels = createCornerLabels();

renderWithOverlay(canvas, layout, { viewport }, cornerLabels);`,
  },
  {
    id: 'scrollbar',
    label: '滚动条',
    file: 'scrollbar.mjs',
    note: '自动隐藏由 createScrollbarAutoHide 驱动；完整指针与计时器逻辑见 site/demo.mjs。',
    code: `import { renderWithOverlay } from './src/features/overlay.mjs';
import {
  createScrollbarAutoHide,
  createScrollbarOverlay,
  scrollFromThumbPosition,
} from './src/features/scrollbar.mjs';

const scrollbars = createScrollbarOverlay();
const autoHide = createScrollbarAutoHide();

renderWithOverlay(canvas, layout, { viewport }, scrollbars.draw);

// 滚动 / 拖动时 autoHide.show()，悬停时 autoHide.setPinned(true)
// 淡出阶段用 scrollbars.setOpacity(autoHide.opacity()) 重绘
const hit = scrollbars.hitTest(x, y);
if (hit) {
  const next = scrollFromThumbPosition(hit.bar, y, grabOffset);
}`,
  },
  {
    id: 'marker',
    label: '自定义标记',
    file: 'cell-marker.mjs',
    note: 'test 谓词决定标记哪些格子；cellStyle 改底色，draw 画右上角标记。',
    code: `import { renderWithOverlay } from './src/features/overlay.mjs';
import { createCellMarker } from './src/features/cell-marker.mjs';

const marker = createCellMarker(layout, {
  test: (cell) => typeof cell.value === 'number' && cell.value >= 300,
});

renderWithOverlay(canvas, layout, {
  viewport,
  cellStyle: marker.cellStyle,
}, marker.draw);`,
  },
  {
    id: 'collapse',
    label: '展开/折叠',
    file: 'collapse.mjs',
    note: '基于 aggregate 结果重新上卷；可与行/列汇总、并列度量同时使用；cartesian 暂不叠加。',
    code: `import { layoutPivot } from './src/model/index.mjs';
import {
  collapseCube,
  collapseKey,
  drawCollapseIndicators,
  hitTestHeader,
} from './src/features/collapse.mjs';

const collapsed = new Set([collapseKey('row', 'region', '华东')]);
const next = collapseCube(cube, collapsed);
const layout = layoutPivot(next.rows, {
  dimensions: next.dimensions,
  value: 'sales',
  mode: 'compact',
});

// 并列度量：分别 collapseCube(salesCube) / collapseCube(countCube)，再 combineMeasures
// 汇总：withTotals(base, rolled, { shouldIncludeSubtotal })
// 多度量父维度：hitTestHeader(..., { canCollapse }) 屏蔽
// pointerdown: hitTestHeader(layout, geometry, point)
// renderWithOverlay: drawCollapseIndicators(ctx, { layout, geometry, collapsed })`,
  },
];

/** 英文站点的同一组示例；id / file / import 路径与中文版保持一致。 */
export const codeExamplesEn = [
  {
    id: 'core',
    label: 'Core rendering',
    file: 'app.mjs',
    note: 'rows / dimensions come from your data; every dimension needs an explicit axis, and hierarchical dimensions add parent. Full example: examples/canvas.html.',
    code: `import { aggregate, layoutPivot } from './src/model/index.mjs';
import { renderPivot } from './src/render/index.mjs';

const cube = aggregate(rows, {
  dimensions,
  measure: { key: 'sales', aggregate: 'sum' },
});

const layout = layoutPivot(cube.rows, {
  dimensions,
  value: 'sales',
});

renderPivot(canvas, layout, {
  viewport: { width: 960, height: 540 },
  cellSize: { width: 104, height: 28 },
});`,
  },
  {
    id: 'dual',
    label: 'Dual measures',
    file: 'dual-measure.mjs',
    note: 'Each aggregate result becomes a measure; value points to the combined value field.',
    code: `import { layoutPivot } from './src/model/index.mjs';
import { combineMeasures } from './src/features/dual-measure.mjs';

const dual = combineMeasures({
  dimensions,
  measures: [
    { label: 'Sales', rows: salesCube.rows, valueField: salesCube.measure.key },
    { label: 'Orders', rows: countCube.rows, valueField: countCube.measure.key },
  ],
});

const layout = layoutPivot(dual.rows, {
  dimensions: dual.dimensions,
  value: dual.value,
});`,
  },
  {
    id: 'heatmap',
    label: 'Heatmap',
    file: 'heatmap.mjs',
    note: 'With dual measures, scales are grouped by measure automatically; empty values fall back to the core default style.',
    code: `import { renderPivot } from './src/render/index.mjs';
import { createHeatmapStyle } from './src/features/heatmap.mjs';

const heatmap = createHeatmapStyle(layout);

renderPivot(canvas, layout, {
  viewport,
  cellStyle: heatmap.cellStyle,
});`,
  },
  {
    id: 'totals',
    label: 'Row/column totals',
    file: 'totals.mjs',
    note: 'rollupTotals reads the cube; withTotals derives a display layout. Use shouldIncludeSubtotal to skip subtotals under collapsed parents.',
    code: `import { layoutPivot } from './src/model/index.mjs';
import { renderPivot } from './src/render/index.mjs';
import { rollupTotals, withTotals } from './src/features/totals.mjs';

const rolled = rollupTotals(cube, {
  rows: { subtotals: ['region'], grandTotal: true },
  cols: { subtotals: ['year'], grandTotal: true },
});

const base = layoutPivot(cube.rows, {
  dimensions,
  value: 'sales',
});
// Collapsed case: withTotals(base, rolled, { shouldIncludeSubtotal })
const display = withTotals(base, rolled);

renderPivot(canvas, display, { viewport });`,
  },
  {
    id: 'overlay',
    label: 'Corner labels',
    file: 'overlay.mjs',
    note: 'The draw callback can also render selection boxes, guides, and other custom decorations.',
    code: `import { createCornerLabels, renderWithOverlay } from './src/features/overlay.mjs';

const cornerLabels = createCornerLabels();

renderWithOverlay(canvas, layout, { viewport }, cornerLabels);`,
  },
  {
    id: 'scrollbar',
    label: 'Scrollbars',
    file: 'scrollbar.mjs',
    note: 'Auto-hide is driven by createScrollbarAutoHide; see site/demo.mjs for the full pointer and timer wiring.',
    code: `import { renderWithOverlay } from './src/features/overlay.mjs';
import {
  createScrollbarAutoHide,
  createScrollbarOverlay,
  scrollFromThumbPosition,
} from './src/features/scrollbar.mjs';

const scrollbars = createScrollbarOverlay();
const autoHide = createScrollbarAutoHide();

renderWithOverlay(canvas, layout, { viewport }, scrollbars.draw);

// Call autoHide.show() on scroll/drag and autoHide.setPinned(true) on hover.
// During fade-out, repaint with scrollbars.setOpacity(autoHide.opacity()).
const hit = scrollbars.hitTest(x, y);
if (hit) {
  const next = scrollFromThumbPosition(hit.bar, y, grabOffset);
}`,
  },
  {
    id: 'marker',
    label: 'Custom markers',
    file: 'cell-marker.mjs',
    note: 'The test predicate chooses which cells to mark; cellStyle changes the background and draw paints the corner badge.',
    code: `import { renderWithOverlay } from './src/features/overlay.mjs';
import { createCellMarker } from './src/features/cell-marker.mjs';

const marker = createCellMarker(layout, {
  test: (cell) => typeof cell.value === 'number' && cell.value >= 300,
});

renderWithOverlay(canvas, layout, {
  viewport,
  cellStyle: marker.cellStyle,
}, marker.draw);`,
  },
  {
    id: 'collapse',
    label: 'Expand / collapse',
    file: 'collapse.mjs',
    note: 'Rolls up from the aggregate result; works with row/column totals and dual measures; not available with cartesian yet.',
    code: `import { layoutPivot } from './src/model/index.mjs';
import {
  collapseCube,
  collapseKey,
  drawCollapseIndicators,
  hitTestHeader,
} from './src/features/collapse.mjs';

const collapsed = new Set([collapseKey('row', 'region', 'East China')]);
const next = collapseCube(cube, collapsed);
const layout = layoutPivot(next.rows, {
  dimensions: next.dimensions,
  value: 'sales',
  mode: 'compact',
});

// Dual measures: collapseCube(salesCube) / collapseCube(countCube), then combineMeasures
// Totals: withTotals(base, rolled, { shouldIncludeSubtotal })
// Multi-measure parent: hitTestHeader(..., { canCollapse }) blocks it
// pointerdown: hitTestHeader(layout, geometry, point)
// renderWithOverlay: drawCollapseIndicators(ctx, { layout, geometry, collapsed })`,
  },
];

export function getCodeExamples(lang) {
  return normalizeLang(lang) === 'en' ? codeExamplesEn : codeExamples;
}
