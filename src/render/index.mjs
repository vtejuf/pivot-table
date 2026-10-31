/**
 * 可视化模块入口。
 *
 * geometry 负责坐标换算，renderer 负责绘制，theme 负责样式。
 * 三层都可以单独使用：自定义渲染器可只消费 geometry，测试可只测几何。
 */

export { computePivotGeometry, rectsIntersect } from './geometry.mjs';
export { renderPivot, setupCanvas } from './canvas-renderer.mjs';
export {
  DEFAULT_THEME,
  parseHex,
  mixHex,
  readableTextColor,
} from './theme.mjs';
