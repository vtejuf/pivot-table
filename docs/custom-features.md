# 自定义 feature 指南

- **状态**：已实现 `cell-marker` 示例；本文覆盖当前所有扩展挂载点。
- **原则**：核心算法冻结；feature 只读取核心输出，核心不反向依赖 feature。

依赖方向：

```
site / examples / bench
          ↓
       features
          ↓
    model / render
```

## 0. 先选挂载点

先判断你要改变什么，再决定挂在哪里：

- 想改变进入布局的数据：**数据派生**（aggregate 之后）。
- 想改变网格、表头或单元格结构：**布局派生**（layoutPivot 之后）。
- 想改单元格颜色、文本或主题：**渲染配置**（`cellStyle` / `formatValue` / `theme`）。
- 想在核心绘制后加装饰：**渲染后叠加**（`renderWithOverlay`）。
- 想处理点击、滚动、下钻：**交互层**，写回 `scrollX / scrollY` 或重新聚合。

不要为了一个 feature 修改 `src/model` 或 `src/render`。如果现有挂载点确实不够，先提出向后兼容的扩展方案，再改核心。

<a id="data"></a>
## 1. 数据派生（aggregate 之后）

输入是 `cube`（`aggregate()` 的返回值），输出仍然是能交给 `layoutPivot()` 的行和维度配置。

### 并列度量

```js
import { combineMeasures } from './src/features/dual-measure.mjs';
import { layoutPivot } from './src/model/index.mjs';

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
});
```

`combineMeasures()` 把多个 aggregate 结果展开成长表，并把 `measure` 作为列轴最末层维度。它不修改输入 cube。

### 汇总上卷

```js
import { rollupTotals } from './src/features/totals.mjs';

const rolled = rollupTotals(cube, {
  rows: { subtotals: ['region'], grandTotal: true },
  cols: { subtotals: ['year'], grandTotal: true },
});
```

`rollupTotals()` 只读 `cube`，输出独立的汇总表，不生成布局行。下一步交给 `withTotals()`。

### 自己写数据派生

- 输入：`cube.rows`、`cube.dimensions`、`cube.measure`；
- 输出：新的 `rows` / `dimensions` / `value` 字段名；
- 不要原地修改 `cube.rows` 或 `cube.dimensions`；
- 同一维度组合必须唯一，否则 `layoutPivot()` 会报错。

参考：`src/features/dual-measure.mjs`、`src/features/totals.mjs`、[totals.md](totals.md)。

<a id="layout"></a>
## 2. 布局派生（layoutPivot 之后）

输入是核心 `layout`，输出是一个**新的展示布局**，结构需要满足渲染器契约：

- `size: { rows, cols }`
- `axes.row.header` / `axes.col.header`
- `cells: [{ x, y, value, members, ... }]`
- `cellMap: Map<"x,y", cell>`
- `matrix` 可以是 `null`，渲染器不依赖它。

```js
import { rollupTotals, withTotals } from './src/features/totals.mjs';

const base = layoutPivot(cube.rows, { dimensions, value: 'sales' });
const rolled = rollupTotals(cube, {
  rows: { subtotals: ['region'], grandTotal: true },
});
const display = withTotals(base, rolled);

renderPivot(canvas, display, { viewport });
```

注意：

- 不要原地修改 `base.cells`、`base.axes`、`base.cellMap`；
- 插入行/列后要重建 `size`、表头、`cellMap`；
- 汇总格可以带 `cell.kind = 'subtotal' | 'total'`，供 `cellStyle` 区分；
- 布局派生后的对象仍然交给同一个 `renderPivot()`。

参考：`src/features/totals.mjs`、[totals.md](totals.md)。

<a id="collapse"></a>
## 2.1 展开 / 折叠

折叠先在数据层重新上卷，再交给核心 `layoutPivot()`；它不是原地修改 layout：

```js
import { layoutPivot } from './src/model/index.mjs';
import { collapseCube, collapseKey } from './src/features/collapse.mjs';

const collapsed = new Set([collapseKey('row', 'region', '华东')]);
const next = collapseCube(cube, collapsed);
const layout = layoutPivot(next.rows, {
  dimensions: next.dimensions,
  value: 'sales',
  mode: 'compact',
});
```

- 首版只支持 compact 单度量；可与行/列汇总同时使用；cartesian、并列度量暂不叠加；
- 被折叠父成员的子维度显示为 `（全部）`，表示该父级的汇总；
- 父表头命中用 `hitTestHeader()`，指示器用 `drawCollapseIndicators()`；
- 折叠键用 `collapseKey(axis, dimension, value)` 生成，存进 Set 即可切换。

参考：`src/features/collapse.mjs`、`test/features/collapse.test.mjs`。

<a id="render-config"></a>
## 3. 渲染配置：cellStyle / formatValue / theme

这些选项直接传给 `renderPivot()` 或 `renderWithOverlay()`，不需要派生布局。

### cellStyle

```js
renderPivot(canvas, layout, {
  viewport,
  cellStyle: (cell, context) => {
    if (cell?.value > 100) {
      return { background: '#fef3c7', text: '#92400e' };
    }
    return undefined;
  },
});
```

- `cell` 可能是 `null`（空格子），先判空；
- 返回值只包含 `background` / `text`，其余样式由核心主题决定；
- 逐可见格调用，保持轻量，不要在里面做重计算；
- 需要跨格计算（如色阶 min/max）时，先创建一次样式函数，再在回调里查表。

示例：`src/features/heatmap.mjs`、`src/features/cell-marker.mjs`。

### formatValue

```js
renderPivot(canvas, layout, {
  formatValue: (value, cell) =>
    typeof value === 'number' ? value.toLocaleString('zh-CN') : String(value),
});
```

返回 `null` / `undefined` / 空字符串时跳过文本绘制。适合单位、百分比、货币等纯文本格式化。

### theme / 尺寸 / overscan

- `theme`：覆盖默认颜色和字体；
- `cellSize` / `headerSize`：格子与表头尺寸；
- `overscan`：可见范围向两侧多取格子，适合预渲染或自定义绘制。

核心渲染器只保留这些通用接缝，不包含热力图等业务逻辑。

<a id="overlay"></a>
## 4. 渲染后叠加：renderWithOverlay

`renderWithOverlay(target, layout, options, draw)` 先调用核心 `renderPivot()`，再把同一个 2D context 交给 `draw`：

```js
import { renderWithOverlay } from './src/features/overlay.mjs';

renderWithOverlay(canvas, layout, { viewport }, (ctx, { geometry, theme }) => {
  ctx.save();
  try {
    ctx.fillStyle = '#6366f1';
    ctx.fillRect(geometry.corner.width - 8, 0, 8, 8);
  } finally {
    ctx.restore();
  }
});
```

约定：

- 坐标是 CSS 像素，DPR 变换已由核心设置；
- `draw(ctx, { layout, geometry, theme, options })` 可以读取布局和几何；
- 自己 `save()` / `restore()`，不要污染下一次绘制；
- 画数据格装饰时，用 `geometry.dataClip` 裁剪，避免画到冻结表头；
- `draw` 抛错时 `renderWithOverlay` 会恢复 context。

内置示例：`src/features/overlay.mjs`（角区标签）、`src/features/scrollbar.mjs`（滚动条）。

<a id="interaction"></a>
## 5. 交互与命中测试

核心不绑定事件；交互属于 site / feature 层。

### 单元格命中

```js
const x = Math.floor(
  (event.offsetX - geometry.dataOrigin.x + scrollX) / geometry.cellSize.width,
);
const y = Math.floor(
  (event.offsetY - geometry.dataOrigin.y + scrollY) / geometry.cellSize.height,
);
const cell = layout.cellMap.get(`${x},${y}`);
```

### 滚动与拖拽

- 滚轮、拖拽、键盘最终都写回 `scrollX / scrollY`；
- 下一次 `computePivotGeometry()` / `renderPivot()` 只重绘可见部分；
- 滚动条 feature 额外提供 `hitTest()` 和 `scrollFromThumbPosition()`。

### 下钻

用 `cell.members` 过滤明细，重新 `aggregate()` + `layoutPivot()`，再渲染。不要直接修改当前 `layout`。

完整交互示例：`site/demo.mjs`、`examples/canvas.html`。

<a id="cell-marker"></a>
## 6. 完整示例：cell-marker

`src/features/cell-marker.mjs` 是一个最小自定义 feature：按谓词标记高值格子。

```js
import { renderWithOverlay } from './src/features/overlay.mjs';
import { createCellMarker } from './src/features/cell-marker.mjs';

const marker = createCellMarker(layout, {
  test: (cell) => typeof cell.value === 'number' && cell.value >= 300,
});

renderWithOverlay(canvas, layout, {
  viewport,
  cellStyle: marker.cellStyle,
}, marker.draw);
```

它同时挂两个点：

- `cellStyle`：命中谓词的格子使用自定义背景和文字色；
- `draw`：在命中格子右上角画一个小标记，只遍历 `geometry.visible`，并用 `dataClip` 裁剪。

实现约束：

- 只读 `layout.cells` / `layout.cellMap` / `geometry`；
- 不修改核心对象；
- 不新增核心 API；
- `draw` 返回实际标记数量，便于测试和统计。

测试：`test/features/cell-marker.test.mjs`。Demo 中的“高值标记”开关使用当前布局的 80 分位作为阈值。

<a id="architecture"></a>
## 7. 依赖规则与测试

- `features` 可以 import `model` / `render`；
- `src/model` 和 `src/render` **禁止** import `features`；
- `site` 只做 UI 绑定和 feature 编排；
- 不原地修改核心的 `cells`、`axes`、`cellMap`；
- 不为了某个 feature 修改核心默认输出。

架构守卫测试会扫描 `src/model` / `src/render` 的 import，发现反向依赖即失败。

测试建议：

- feature 独立测试放在 `test/features/`；
- 渲染类逻辑用记录调用的 fake 2D context；
- 覆盖空布局、无命中、可见范围裁剪和参数校验；
- 运行全量测试：

```bash
node --test test/model/*.test.mjs test/render/*.test.mjs \
  test/features/*.test.mjs test/site/*.test.mjs test/architecture.test.mjs
```

## 8. 检查清单

- [ ] feature 只读核心输出，没有原地修改 `layout` / `cube`。
- [ ] 通过 `cellStyle`、`formatValue`、`theme`、`renderWithOverlay` 或布局派生接入。
- [ ] 没有在 `src/model` / `src/render` 里 import feature。
- [ ] 有独立的 feature 测试，覆盖空数据与裁剪。
- [ ] 大表上的绘制成本仍然和可见格数相关，或有明确说明。
- [ ] 更新 README、相关 docs 和示例入口。
