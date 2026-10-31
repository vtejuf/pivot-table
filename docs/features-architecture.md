# 附加功能架构设计（设计稿）

- **状态**：设计稿；并列度量、热力图 feature 已实现，核心旧热力图已移除；小计 / 总计、折叠 / 展开仍未实现。
- **日期**：2026-10-31
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

第一个 feature（并列度量）和热力图 feature 已落地；其余目录在对应功能实现时再创建：

```
src/
  model/         核心：聚合、矩阵布局（冻结）
  render/        核心：几何、Canvas、主题（冻结）
  features/      附加业务能力
    dual-measure.mjs  已实现：并列度量布局
    heatmap.mjs       已实现：热力图渲染
    index.mjs         可选：feature 统一入口（尚未创建）
    subtotals.mjs     规划中
    collapse.mjs      规划中
test/
  features/
    dual-measure.test.mjs  已实现
    heatmap.test.mjs       已实现
    subtotals.test.mjs     规划中
    collapse.test.mjs      规划中
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

本次设计不包含：

- 预先创建无实现内容的目录；
- 实现小计 / 总计；
- 实现折叠 / 展开；
- 修改核心矩阵/几何算法或默认渲染行为（已完成的 heatmap 迁出除外）；
- 引入插件注册器、事件总线或新的运行时依赖。

## 9. 未来落地顺序

1. 为小计 / 总计写独立设计，明确展示布局的派生规则。
2. 实现并测试小计 / 总计 feature。
3. 为折叠 / 展开写独立设计，明确状态、过滤/上卷和重新布局策略。
4. 实现并测试折叠 / 展开 feature。
5. 在 `site/` 接入控件与状态，复用共享 demo 控制器。
6. 补充文档和架构守卫测试。

## 10. 评审清单

- [ ] 核心目录没有 diff。
- [ ] `src/model`、`src/render` 没有 import `features`。
- [ ] 不传 feature 参数时，核心默认行为与现在一致。
- [ ] feature 通过组合核心输出实现，不复制核心矩阵算法。
- [ ] feature 不原地修改核心的 `cells`、`axes`、`cellMap`。
- [ ] 核心测试与 feature 测试同时通过。
- [ ] 站点层只做 UI 绑定，不承载业务算法。
