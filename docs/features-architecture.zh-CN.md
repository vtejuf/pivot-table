[English](features-architecture.md) · [简体中文](features-architecture.zh-CN.md)

# 附加功能架构设计（设计稿）

- **状态**：设计稿；并列度量、热力图、自定义叠加渲染示例、自定义 feature 示例（cell-marker）、行/列小计/总计（含双轴交叉与多度量分列）、悬浮滚动条、折叠 / 展开（compact，可与行/列汇总、并列度量共存）已实现，核心旧热力图已移除；跨层单格合并、cartesian 的折叠仍未实现。
- **日期**：2026-11-02
- **范围**：并列度量、热力图、小计 / 总计、折叠 / 展开，以及后续基于核心的附加能力。
- **核心原则**：核心算法冻结；附加功能只做组合、派生和适配。

## 1. 目标

在不修改核心算法的前提下，为透视表增加产品级能力：

- 小计 / 总计
- 折叠 / 展开
- 后续的排序、合并、导出、交互装饰等

这些能力应当可以被 `site/`、`examples/` 或未来的其他使用方复用，而不是绑死在演示页面里。

## 2. 核心边界

### 2.1 冻结内容

以下模块的算法、函数签名、默认行为和输出结构保持稳定：

- `src/model/aggregate.mjs`
- `src/model/pivot-layout.mjs`
- `src/model/value-key.mjs`
- `src/render/geometry.mjs`
- `src/render/canvas-renderer.mjs`
- `src/render/theme.mjs`

核心入口 `src/model/index.mjs`、`src/render/index.mjs` 不感知附加功能。

> 例外：2026-10-31 经明确同意，移除核心 `heatmap` 选项、主题色板与相关测试，
> 热力图完全迁入 `src/features/heatmap.mjs`。核心矩阵/几何与其余渲染行为不变，
> 后续继续按冻结规则执行。

### 2.2 允许的变更

- 新增独立的 feature 模块、入口、测试和文档。
- 在站点层增加控件、状态和 feature 编排。
- 如果现有核心能力确实不足，先提出向后兼容的扩展方案，说明影响面并等待确认；默认不直接改核心。
- 不为了让某个 feature 通过而修改核心的默认输出。

## 3. 目录规划

并列度量、热力图、自定义叠加渲染示例、行/列小计/总计和悬浮滚动条已落地；其余目录在对应功能实现时再创建：

```
src/
  model/         核心：聚合、矩阵布局（冻结）
  render/        核心：几何、Canvas、主题（冻结）
  features/      附加业务能力
    dual-measure.mjs  已实现：并列度量布局
    heatmap.mjs       已实现：热力图渲染
    cell-marker.mjs   已实现：自定义 feature 示例（cellStyle + overlay）
    collapse.mjs      已实现：展开 / 折叠（compact，可与汇总/多度量共存）
    overlay.mjs       已实现：自定义叠加渲染（角区示例）
    scrollbar.mjs     已实现：悬浮滚动条（绘制 + 命中测试 + 拖拽换算）
    totals.mjs        已实现：行/列小计/总计（含双轴交叉）
    index.mjs         可选：feature 统一入口（尚未创建）
test/
  features/
    dual-measure.test.mjs  已实现
    heatmap.test.mjs       已实现
    cell-marker.test.mjs   已实现
    collapse.test.mjs      已实现
    overlay.test.mjs       已实现
    scrollbar.test.mjs     已实现
    totals.test.mjs        已实现
  site/
    code-examples.test.mjs 已实现
  architecture.test.mjs    已实现：依赖方向守卫
```

文件名先保持扁平；单个 feature 变大后再拆成 `features/subtotals/` 等子目录。

## 3.1 已实现：并列度量

`src/features/dual-measure.mjs` 把多个 aggregate 结果展开成长表，并把
“度量”作为列轴最末一层维度，再交给核心 `layoutPivot`。

- 输入：`dimensions` + `measures: [{ label, rows, valueField }]`；
- 输出：长表 `rows`、追加 measure 维度的 `dimensions`、`value` 字段名；
- 核心矩阵、表头、`cellMap` 与渲染器均未修改；
- 并列度量本身只处理布局；热力图由独立 feature 按 measure 分别计算；
- 核心旧热力图已移除，热力图逻辑全部在 `src/features/heatmap.mjs`；
- 架构守卫测试确保 `src/model` / `src/render` 不反向依赖 `features`。

## 3.2 已实现：热力图 feature

`src/features/heatmap.mjs` 通过核心已有的 `cellStyle` 回调渲染，不修改核心
renderer 的绘制路径。

- 单度量布局：所有数值共用一个 min/max；
- 并列度量布局：按 `measure` 维度分别计算 min/max 和色阶，互不干扰；
- 空值 / 非数值单元格返回 `undefined`，交回核心默认样式；
- Demo 通过 `cellStyle` 使用 feature；核心 renderer 不再包含热力图选项；
- 核心只保留 `cellStyle` / `formatValue` 这类通用扩展点。

## 3.3 已实现：自定义叠加渲染（示例）

`src/features/overlay.mjs` 在核心 `renderPivot` 结束后，把同一个 2D context
交给调用方的 `draw` 回调，用于角标、参考线、图标、选中框等装饰。

- `renderWithOverlay(target, layout, options, draw)`：通用入口，先核心、后自定义；
- `createCornerLabels(options)`：内置示例，在冻结角区画行/列维度名；
- 核心几何、绘制顺序和默认输出不变，overlay 始终位于最上层；
- `draw` 使用与核心相同的 CSS 像素坐标系，DPR 变换已由核心处理；
- 角区为空（纯行 / 纯列透视）时示例直接跳过，过窄时省略号截断；
- feature 只读取 `layout` / `geometry`，不修改核心对象；
- Demo 通过 `[data-demo-overlay]` 开关接入，关闭时仍走核心 `renderPivot`。

## 3.4 已实现：行 / 列小计与总计（含双轴交叉）

`src/features/totals.mjs` 分两步，核心 `aggregate` / `layoutPivot` /
`renderPivot` 均不修改：

- `rollupTotals(cube, config)`：读取核心聚合结果，按 `rows` / `cols` 配置
  统一上卷，输出独立的行 × 列汇总立方体；不生成布局行，不修改 cube。
- `rollupMultiTotals(measures, config)`：对每个度量分别上卷，把度量 label
  追加到列路径，列小计/总计按 measure 分列，不把不同度量相加。
- `withTotals(layout, rolled, options)`：路线 B，在基础布局上同时插入行/列
  小计与总计，重建两块表头、`cells`、`cellMap`、`size`；`matrix` 置 `null`。
- 行/列都走父块内小计：父 `size` 覆盖汇总行/列，子层显示“小计”；总计行的
  深层用空占位 children 链填满。
- 支持行小计 × 列小计、行小计 × 列总计、行总计 × 列小计和右下角全局总计。
- 内置 `sum / count / avg / min / max` 上卷规则；`avg` 用 `__valueCount`
  加权；可传纯函数 `reduce(records, context)` 覆盖。
- 开关在 site 层翻译成配置；全关时 `skipped: true`，布局层原样返回。
- 多度量时，列小计/总计按 measure 分列；行汇总行覆盖所有度量列。
- 折叠联动：折叠父级跳过小计，总计保留；详见 3.7。
- 真正的跨层单格合并、表头样式后续。
- 行轴兼容入口 `rollupRowTotals()` / `withRowTotals()` 仍保留。
- 设计与边界见 `docs/totals.zh-CN.md`。

## 3.5 已实现：悬浮滚动条

`src/features/scrollbar.mjs` 在核心绘制后叠加滚动条，不修改核心几何与布局：

- `computeScrollbarGeometry(geometry, options)`：根据核心 `viewport /
  dataOrigin / dataSize / dataViewport` 计算两条轨道和 thumb；
- `hitTestScrollbars(bars, x, y)`：区分 thumb / track，轨道外返回 `null`；
- `scrollFromThumbPosition(bar, pointer, grabOffset)`：把指针位置换算回滚动偏移；
- `drawScrollbars(ctx, geometry, options, state)`：绘制轨道和 thumb，支持
  hover / active 颜色和 `opacity` 淡出；
- `createScrollbarOverlay(options)`：封装成 overlay 的 draw 函数，并缓存最近一次
  几何供站点层命中测试；
- `createScrollbarAutoHide({ delay, fadeDuration })`：纯时间状态机，提供
  `show()` / `setPinned()` / `opacity()` / `isActive()`，不依赖 DOM；
- 轨道从数据区起点开始，避开冻结表头；两个方向都可滚动时右下角留空；内容
  不足一个视口时自动隐藏；
- Demo 默认启用；滚动 / 拖动后显示，停止操作约 900ms 后淡出，悬停或拖动
  滚动条时保持显示；自动隐藏后仍可命中用于悬停唤醒，但 pointerdown 仅在
  透明度大于 0.05 时拖动滚动条；
- Demo 中指针命中滚动条时优先拖动滚动条，否则继续拖拽平移。

## 3.6 已实现：自定义 feature 示例（cell-marker）

`src/features/cell-marker.mjs` 是编写自定义 feature 的最小完整示例：

- `createCellMarker(layout, { test, ... })` 返回 `cellStyle` 与 `draw`；
- `cellStyle` 给命中谓词的格子返回背景 / 文字色；
- `draw` 在 `renderWithOverlay` 后绘制右上角标记，只遍历 `geometry.visible`，
  并用 `dataClip` 裁剪；
- Demo 用“高值标记”开关接入，阈值取当前布局数值的 80 分位；
- 页面 `#quickstart` 的“自定义 feature”卡片提供数据派生、布局派生、
  渲染配置、overlay 和交互等挂载点的文档入口；
- 完整说明见 [custom-features.zh-CN.md](custom-features.zh-CN.md)。

## 3.7 已实现：展开 / 折叠（compact，可与汇总/多度量共存）

`src/features/collapse.mjs` 在 aggregate 之后派生折叠数据，核心布局 / 渲染不改：

- `collapseCube(cube, collapsed)`：按 `collapseKey(axis, dimension, value)` 找到第一个被折叠的父成员，把其子维度替换为 `（全部）`，并按度量重新上卷；avg 用 `__valueCount` 加权；
- `hitTestHeader(layout, geometry, point, { canCollapse })`：命中行 / 列父表头，
  返回 `axis / dimension / value / key`；
- `drawCollapseIndicators(ctx, { layout, geometry, collapsed, canCollapse })`：
  在父表头右侧画 + / −；多度量下屏蔽 `measure` 及其直接父维度；
- Demo“折叠模式”开启后点击父表头切换，关闭时清除状态并恢复完整布局；
- 当前只支持 compact；可与行/列汇总、并列度量同时使用，折叠父级跳过小计、总计保留；
  多度量时对每个 measure 的 cube 分别折叠，再 combineMeasures；
  measure 及其直接父维度不参与折叠，用 `canCollapse` 过滤；cartesian 暂不叠加；
- 测试见 `test/features/collapse.test.mjs`；完整挂载点说明见
  [custom-features.zh-CN.md](custom-features.zh-CN.md#collapse)。

## 4. 依赖规则

```
site / examples / bench
          ↓
       features
          ↓
    model / render        （核心）
```

- `features` 可以 import 核心。
- `model` 与 `render` 禁止 import `features`。
- `site` 只负责 UI 绑定和 feature 编排，不承载可复用的业务算法。
- `features/index.mjs` 只导出 feature API，不改变核心入口。
- 可选地增加 `test/architecture.test.mjs`，静态扫描 `src/model` 与 `src/render` 的 import，发现反向依赖即失败。边界用测试机制守住，不靠口头约定。

## 5. 功能接入方式

### 5.1 小计 / 总计

首选方式：

1. feature 层读取核心的聚合结果与布局结果，只读消费。
2. 构造 feature 自己的“展示布局”：在基础布局上插入汇总行/列，重新计算表头、`size`、`cells`、`cellMap` 等展示结构。
3. 核心布局对象不被修改；核心 `layoutPivot` 不增加汇总逻辑。
4. 渲染层只接收 feature 产出的、符合既有契约的布局对象。

备选方式：

- 包装聚合数据后重新调用一次核心 `layoutPivot`。
- 只有在不引入核心改动、且表头与坐标严格正确时采用；否则回到展示布局派生。

实现该功能前，需要单独设计并验证：

- 汇总行/列与原始行列的 `offset / size` 关系；
- 分组父子层级下的汇总位置；
- 汇总单元格的命中测试和渲染装饰；
- 空数据、单成员、compact 布局等边界。

行轴/列轴都已按这个方式落地（见 3.4）：`rollupTotals()` 只读 cube 上卷，
`withTotals()` 只读 layout 派生展示布局；上卷规则可配置为纯函数。

### 5.2 折叠 / 展开

- feature 层维护折叠路径集合和 UI 状态。
- 折叠后的可见数据通过过滤或上卷得到；feature 可以重新调用核心 `layoutPivot` 生成新的完整布局。
- 核心始终按传入数据生成布局，不感知“折叠”概念。
- 展开时恢复被过滤的成员，再重新布局。
- 折叠图标、命中区域和状态变化属于 feature / 渲染装饰层，不进入核心 renderer。

### 5.3 渲染装饰

优先复用核心已有的扩展点：

- `formatValue`：汇总值、空值、特殊文本；
- `cellStyle`：汇总底色、突出文字、斑马纹覆盖；
- 核心 `geometry`：计算图标、分隔线、命中区域的位置。

如果这些不够：

- feature 提供自己的 Canvas 装饰绘制函数，在核心 `renderPivot` 之后叠加；
- 或由 feature 包一层渲染协调器，但核心 renderer 的默认行为保持不变。

不修改 `renderPivot` 的默认绘制顺序和核心几何算法来迁就某个 feature。

### 5.4 站点接入

- `site/demo.mjs` 负责把 feature 状态、控件和渲染串起来。
- 页面新增开关时，只增加控件与状态绑定。
- 核心与 feature 都可以在没有站点的情况下独立测试。

## 6. 测试策略

- 核心测试保持原样，feature 不能要求修改核心断言。
- 每个 feature 在 `test/features/` 下独立测试。
- feature 测试覆盖：
  - 数据/布局派生结果；
  - 与核心布局组合后的坐标、表头和单元格；
  - 折叠/展开状态切换；
  - 渲染回调与装饰调用。
- 每次改动同时运行核心测试和 feature 测试。
- 可选架构守卫测试：
  - core 目录不得出现 `features/` 反向 import；
  - feature 入口不得修改核心导出。

## 7. 命名与演进

- 当前使用 `features`：表达透视表产品特性，不是第三方插件机制。
- 如果未来需要第三方注册、生命周期、动态加载，再引入独立的 `extensions/` 或 `plugins/`，不要现在预造框架。
- feature 内部的通用工具放在 `features/internal/`，不要回流到核心。
- 核心 API 的版本变化和 feature 的迭代解耦。

## 8. 非目标

当前仍不包含：

- 真正的跨层单格合并；
- 修改核心矩阵 / 几何算法或默认渲染行为；
- 引入插件注册器、事件总线或新的运行时依赖。

小计 / 总计、折叠 / 展开已在后续迭代落地，见 3.4 / 3.7。

## 9. 未来落地顺序

1. 小计 / 总计、折叠 / 展开基础版已实现，并在 `site/` 接入控件与状态。
2. 扩展折叠：cartesian。
3. 真正的跨层单格合并。
4. 继续补充文档、示例入口和架构守卫测试。

## 10. 评审清单

- [ ] 核心目录没有 diff。
- [ ] `src/model`、`src/render` 没有 import `features`。
- [ ] 不传 feature 参数时，核心默认行为与现在一致。
- [ ] feature 通过组合核心输出实现，不复制核心矩阵算法。
- [ ] feature 不原地修改核心的 `cells`、`axes`、`cellMap`。
- [ ] 核心测试与 feature 测试同时通过。
- [ ] 站点层只做 UI 绑定，不承载业务算法。
