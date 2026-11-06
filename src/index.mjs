/**
 * npm 包根入口：导出聚合、布局和 Canvas 渲染 API。
 *
 * 附加功能仍通过子路径使用，例如：
 *   import { createHeatmapStyle } from '@vtejuf/pivot-table/features/heatmap';
 */

export * from './model/index.mjs';
export * from './render/index.mjs';
