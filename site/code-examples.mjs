/**
 * 主页「按功能查看示例」的代码片段。
 *
 * 每个片段都是独立的最小调用，共享同一组 rows / dimensions / cube / layout；
 * 完整交互与状态编排见 site/demo.mjs 和 examples/canvas.html。
 */

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
    note: 'rollupTotals 读取 cube，withTotals 派生展示布局；渲染器无感知。',
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
    note: '基于 aggregate 结果重新上卷；首版只支持 compact 单度量，cartesian、并列度量、行/列汇总暂不叠加。',
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

// pointerdown: hitTestHeader(layout, geometry, point)
// renderWithOverlay: drawCollapseIndicators(ctx, { layout, geometry, collapsed })`,
  },
];
