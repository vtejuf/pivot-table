# 可视化层：Canvas 渲染与性能取舍

## 模块边界

```
src/
  model/                数据模型：聚合 + 矩阵布局，不关心画布
    aggregate.mjs
    pivot-layout.mjs
    value-key.mjs
  render/               可视化：坐标换算 + Canvas 绘制，不做聚合
    geometry.mjs        纯几何，可在 Node 中测试
    canvas-renderer.mjs Canvas 2D 绘制
    theme.mjs           默认主题与颜色工具
```

模型层输出整数网格坐标；渲染层只消费 `layoutPivot()` 的结果，不读取明细，
也不做任何 sum / avg / count。两者可以独立使用：比如用同一份 layout 渲染
Canvas、SVG 或 DOM 表格。

## 渲染管线

```
明细 rows
  └─ aggregate()        每个维度组合唯一
      └─ layoutPivot()  size / axes.header / cellMap / points
          └─ computePivotGeometry()  屏幕矩形、可见范围、裁剪区域
              └─ renderPivot()       背景、网格线、文本、冻结表头
```

`renderPivot(canvas, layout, options)` 的返回值为：

```js
{
  geometry, // 本次使用的坐标系统与可见范围
  stats: {
    cellsInGrid,   // 网格总格数
    drawnCells,    // 本次实际绘制的格数
    drawnValues,   // 其中有值的格数
    textDraws,     // fillText 次数
    headerCells,   // 绘制的表头块数
    gridLines,     // 网格线数
    visible,       // { x0, x1, y0, y1 }
  },
}
```

`stats` 是性能观测入口：总格数增长时，`drawnCells` 应只随视口大小变化。

## 坐标系统

内容坐标把表头和单元格按格子尺寸铺开，原点在左上角：

```
dataOrigin   = (rowDepth × rowHeaderWidth, colDepth × colHeaderHeight)
contentSize  = dataOrigin + (cols × cellWidth, rows × cellHeight)
```

屏幕坐标 = 内容坐标 − 滚动偏移。表头独立冻结：

```
数据格   screen = dataOrigin + (x × cellW, y × cellH) − (scrollX, scrollY)
行表头   screen = (depth × rowHeaderW, dataOrigin.y + offset × cellH − scrollY)
列表头   screen = (dataOrigin.x + offset × cellW − scrollX, depth × colHeaderH)
```

可见格范围：

```
x0 = floor(scrollX / cellW)
x1 = ceil((scrollX + 数据视口宽) / cellW) − 1
```

`computePivotGeometry()` 还会把滚动偏移 clamp 到内容范围，并给出
`dataClip / rowHeaderClip / colHeaderClip` 三个裁剪矩形。渲染器不需要自己
推导这些边界。

## 已实现的性能机制

- **视口虚拟化**：数据区只遍历 `visible` 范围，而不是整个网格。测试中
  150 × 150（22 500 格）的布局在 480 × 280 的数据视口下只绘制 50 格。
- **O(1) 单元格查找**：模型输出的 `cellMap` 以 `${x},${y}` 为键，渲染时
  不再线性扫描 `cells`。
- **批量网格线**：所有可见横竖线合并到一次 `beginPath()` + `stroke()`，
  不逐格 `strokeRect()`。
- **表头二分剪枝**：表头成员的 `offset` 单调递增，用二分找到视口内第一个
  成员，跳过整段视口外成员及其子树。
- **分层裁剪**：数据区与两块表头分别裁剪，滚动时表头只重绘可见成员。
- **一次 DPR 变换**：`setupCanvas()` 只设置一次 backing store 尺寸和
  `setTransform(dpr, ...)`，绘制代码始终使用 CSS 像素。尺寸不变时不会重复
  给 `canvas.width / height` 赋值，避免滚动重绘时重新分配缓冲区。
- **样式回调由 feature 提供**：热力图等视觉编码通过 `cellStyle` 在 feature
  层计算颜色，核心只负责应用背景色和文字颜色；
- **不测量文本**：默认按格子裁剪文本，不做逐格 `measureText()` 或自动
  换行；需要省略号或自动列宽时应由上层预先计算。

绘制成本大致为 O(可见格数 + 可见表头数)，与总格数基本无关。内存成本是
`cellMap` 中“有数据的格”数量；空网格不存对象。

## 可选方案对比

- **Canvas 2D（当前实现）**
  - 适合：约 1 000–100 000 格，规则网格，滚动/缩放交互。
  - 优点：绘制调用少，文本和矩形批量绘制快，零依赖，DPR 控制直接。
  - 缺点：没有文本选择和可访问性，需要自建命中测试和滚动条。
- **DOM `<table>`**
  - 适合：小于约 1 000 格；需要复制粘贴、屏幕阅读器、单元格内表单控件。
  - 优点：语义化、可访问、样式和文本布局由浏览器处理。
  - 缺点：节点多、布局与回流成本高；合并表头和虚拟滚动实现复杂。
- **SVG**
  - 适合：中小数据量、需要矢量打印/导出、CSS 交互和精确命中测试。
  - 优点：每个单元格是节点，事件和导出直观。
  - 缺点：节点数和样式计算随格数线性增长，大表明显慢于 Canvas。
- **Canvas + 离屏缓存**
  - 适合：连续滚动的中大表。把表头、网格线、斑马纹缓存到
    `OffscreenCanvas`，滚动时只平移位图，文本层按需重绘。
  - 代价：缓存失效逻辑（数据/主题/尺寸变化）、内存占用。
  - 这是当前实现最自然的下一步优化。
- **WebGL / WebGPU**
  - 适合：十万到百万格、平滑缩放、动画、minimap。
  - 典型做法：实例化矩形绘制背景与网格，文本预烘焙到图集或用 SDF 字体。
  - 代价：文本排版、点击命中、可访问性和实现复杂度都显著上升；通常只有在
    Canvas 2D 的实测帧率不足时才值得。
- **分层聚合 / 按需下钻**
  - 不换渲染技术，而是减少要显示的数据：先显示汇总层，点击后加载下一层。
  - 对“数据本身很大”的场景，通常比换渲染后端更有效。

经验阈值（以可见格而非总格数为准）：

- 可见格 < 5 000：Canvas 2D 足够，优先把交互和可访问性做好。
- 总格 10 万级、滚动要求 60fps：加离屏缓存或分块缓存。
- 总格百万级或需要连续缩放：考虑 WebGL/WebGPU，并配合分层聚合。
- 需要复制、读屏、打印：提供 DOM/SVG 版本或 DOM 镜像，而不是强行用 Canvas。

## 自定义叠加渲染

核心 `renderPivot` 不提供任意装饰回调；需要角标、参考线、选中框等叠加层时，
用 `src/features/overlay.mjs`：

```js
import { renderWithOverlay, createCornerLabels } from './src/features/overlay.mjs';

renderWithOverlay(canvas, layout, renderOptions, createCornerLabels());
```

`renderWithOverlay()` 先调用核心绘制，再把同一个 2D context（CSS 像素坐标，
DPR 已处理）交给 `draw(ctx, { layout, geometry, theme, options })`。核心几何、
绘制顺序和默认输出不变，overlay 永远在最上层；`draw` 抛错也会恢复 context。

`createCornerLabels()` 只是内置示例：在冻结角区画行/列维度名，角区为空时跳过，
过窄时省略号截断。实际业务可以直接写自己的 `draw`。

## 滚动条 feature

`src/features/scrollbar.mjs` 在核心绘制后叠加悬浮滚动条，核心几何、可见范围
和默认绘制顺序都不变：

```js
import { createScrollbarOverlay, scrollFromThumbPosition } from './src/features/scrollbar.mjs';
import { renderWithOverlay } from './src/features/overlay.mjs';

const scrollbars = createScrollbarOverlay();
renderWithOverlay(canvas, layout, options, scrollbars.draw);

const hit = scrollbars.hitTest(x, y); // { axis, part, bar } | null
const next = scrollFromThumbPosition(hit.bar, y, grabOffset);
```

- 轨道从 `dataOrigin` 开始，避开冻结的列表头 / 行表头；两个方向都可滚动时，
  右下角留出交叉空隙；
- thumb 长度按 `dataViewport / dataSize` 计算，并限制最小可抓取长度；
  `canScrollX / canScrollY` 为 false 时整条滚动条自动隐藏；
- `hitTest` 区分 thumb / track；点击轨道时用 `thumbLength / 2` 作为
  `grabOffset`，thumb 中心会跳到点击位置；
- `drawScrollbars()` 接受 `{ hover, active, opacity }` 状态，用不同颜色表达
  悬停 / 拖动，并通过 `globalAlpha` 支持淡出；
- `createScrollbarAutoHide({ delay, fadeDuration })` 是纯时间状态机：滚动 /
  拖动时 `show()`，悬停或拖动滚动条时 `setPinned(true)`，用 `opacity(now)`
  取当前透明度；`site/demo.mjs` 用 `setTimeout` + `requestAnimationFrame`
  驱动淡出并在透明度变化时重绘；
- 自动隐藏后滚动条仍可命中，用于悬停唤醒；Demo 在 `opacity <= 0.05` 时把
  pointerdown 当作画布平移，避免误触不可见的滚动条；
- 覆盖式绘制会占用视口右缘 / 下缘约 13px，不修改核心 `dataClip`、`visible`
  或布局对象。

`site/demo.mjs` 已经接入：交互后显示滚动条，停止操作约 900ms 后淡出；指针
悬停或拖动滚动条时保持显示；指针命中滚动条时优先拖动滚动条，其余区域继续
拖拽平移；滚轮、方向键和滚动条最终都写回 `scrollX / scrollY`。

## 行 / 列小计与总计布局

`src/features/totals.mjs` 在核心布局之外派生展示布局：`rollupTotals()` /
`rollupMultiTotals()` 先按行/列维度统一上卷，`withTotals()` 再插入小计/总计、
重建两块表头、填充交叉格和 `cellMap`。多度量时列汇总按 measure 分列。小计挂到父块子层，父标签覆盖汇总行/列；总计的深层用
占位链填满。展示布局的 `matrix` 为 `null`，渲染器仍按普通 layout 消费；
汇总格带 `cell.kind = 'subtotal' | 'total'`，`cellStyle` 可据此区分。
设计与边界见 [totals.md](totals.md)。

## 交互扩展

命中测试可以直接复用模型：

```js
const x = Math.floor((event.offsetX - geometry.dataOrigin.x + scrollX) / cellWidth);
const y = Math.floor((event.offsetY - geometry.dataOrigin.y + scrollY) / cellHeight);
const cell = layout.cellMap.get(`${x},${y}`);
```

- 表头命中：遍历 `layout.axes[row|col].header`，结合
  `geometry.rowHeaderRect / colHeaderRect` 判断。
- 下钻：用 `cell.members` 过滤明细，重新 `aggregate()` + `layoutPivot()`。
- 导出：布局与几何都是纯数据，可在离屏 canvas 上按同样代码重绘高分辨率图。

## 可访问性与文本

Canvas 内容对辅助技术不可见。生产环境建议同时提供语义化表格（可以视觉
隐藏）或 `aria-label` 摘要，并维护键盘焦点与 active cell。当前渲染器只做
文本裁剪；数值色阶及对比文字颜色由热力图 feature 提供，核心不感知颜色
编码。

## 当前限制

- 每个轴只支持一条层级链，表头是规则的嵌套结构。
- 核心不内置滚动条；由 `src/features/scrollbar.mjs` 在核心绘制后叠加，
  示例使用滚动条、滚轮和拖拽更新 `scrollX / scrollY`。
- 没有列宽自适应，列宽由 `cellSize.width` 统一指定。
- `cellStyle` / `formatValue` 是同步回调，逐格调用；大表上应保持轻量。
- compact 模式没有全局固定矩阵，但渲染只依赖表头的 `offset / size`，
  因此两种布局共用同一个渲染器。

## 验证

```bash
node --test test/model/*.test.mjs test/render/*.test.mjs \
  test/features/*.test.mjs test/site/*.test.mjs test/architecture.test.mjs
```

渲染测试使用一个记录调用的 fake 2D context，覆盖：

- 数据格、表头、网格线的绘制数量；
- 视口裁剪后的 `drawnCells` 与文本；
- 150 × 150 大网格只绘制可见格；
- 自定义 `formatValue` / `cellStyle`；
- 传 canvas 时按 DPR 设置物理尺寸。

热力图颜色、浅色/深色文字和双度量分范围由 `test/features/heatmap.test.mjs`
覆盖。滚动条几何、thumb 映射、命中测试、hover / active 绘制、透明度和自动隐藏
状态机由 `test/features/scrollbar.test.mjs` 覆盖。
