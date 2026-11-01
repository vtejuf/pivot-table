# 行 / 列小计与总计（设计稿）

- **状态**：行/列小计、行/列总计与双轴交叉已实现；多度量汇总、真正的跨层
  单格合并、折叠联动后续。
- **日期**：2026-11-01
- **原则**：核心 `aggregate` / `layoutPivot` / `renderPivot` 冻结；采用路线 B
  （展示布局派生）；聚合运算和布局插入分离。

## 1. 数据流

```
明细 rows
  └─ aggregate()                 核心：最细粒度 cube
      └─ rollupTotals()          feature：按 rows / cols 统一上卷
          └─ layoutPivot()       核心：基础布局
              └─ withTotals()     feature：插入行/列汇总并填充交叉格
                  └─ renderPivot()
```

`rollupTotals()` 只读 cube，不读 layout；`withTotals()` 只读 layout 和上卷
结果，不再做任何聚合。行轴兼容入口 `rollupRowTotals()` / `withRowTotals()`
仍保留，内部只处理行轴。

## 2. 配置

```js
const config = {
  rows: {
    subtotals: ['region'], // 只对 region 生成行小计；叶子维度自动忽略
    grandTotal: true,      // 行末尾一行“总计”
  },
  cols: {
    subtotals: ['year'],   // 只对 year 生成列小计；叶子维度自动忽略
    grandTotal: true,      // 列末尾一列“总计”
  },
};
```

- `subtotals` 里的 key 必须属于对应轴的层级链，否则报错。
- 叶子维度静默忽略，不生成重复的“自身小计”。
- 首期行/列小计与总计位置固定为末尾。
- Demo 的四个开关只是把 DOM 状态翻译成上面的配置；feature 不读取 DOM。
- 全部关闭时 `rollupTotals()` 直接返回 `skipped: true`，不遍历 cube；
  `withTotals()` 原样返回输入 layout。

## 3. 上卷

每个维度值序列生成三类路径：

- `base`：完整行/列组合；
- `subtotal`：行/列链根到配置维度的前缀；
- `total`：空路径。

每条明细同时累加到它所属的每个行路径 × 列路径组合；`base × base` 已经由
基础布局的 `cells` 提供，不进入汇总表。输出：

```js
{
  cells: Map<rowPathKey, Map<colPathKey, { value, __count, __valueCount }>>,
  row: {
    chain, dimensions, ignored, grandTotal,
    paths: Map<rowPathKey, { kind, values, path, dimension }>,
  },
  col: { ... },
  measure: { key, aggregate },
  skipped: false,
}
```

键使用维度值的稳定编码：

```js
pathKey(values) === JSON.stringify(values.map(valueKey))
```

`valueKey` 与核心聚合/布局共用，避免 `'1'` 与 `1`、`null` 等取值混淆。

内置 reducer 与核心 `aggregate` 语义一致：

- `sum`：有限数值相加；无有效值返回 0。
- `count`：计数相加。
- `avg`：`sum(value × __valueCount) / sum(__valueCount)`，不能简单平均平均值。
- `min` / `max`：跳过 null / 非数值后合并；无有效值返回 null。

自定义 reducer 是纯函数：

```js
const reduce = (records, context) => ({
  value,
  __count,      // 可选，缺省按子记录求和
  __valueCount, // 可选，缺省按子记录求和
});
```

`context` 包含：

```js
{
  measure: { key, aggregate },
  dimension: 'region' | null,     // 行小计维度；空路径/总计为 null
  colDimension: 'year' | null,    // 列小计维度
  path: [{ key, value }],         // 行分组路径
  columns: [{ key, value }],      // 列分组路径
  rowKind: 'base' | 'subtotal' | 'total',
  colKind: 'base' | 'subtotal' | 'total',
}
```

`records` 是最细粒度的聚合记录，不是原始明细。中位数、去重计数这类不能只靠
聚合值上卷的规则，不在当前范围；需要明细的规则应在聚合阶段解决。

## 4. 布局派生

- 行/列都使用父块内小计：父 member 的 `size` 增加汇总行/列，父标签覆盖它；
  子层显示“小计”。
- 总计在根层；更深层用空占位 children 链填满，避免露出画布背景。
- 原始 cells 的 `x / y` 按插入数量平移；汇总 cells 使用槽位的新坐标。
- 汇总格分三类：
  - 基础行 × 列小计/总计；
  - 行小计/总计 × 基础列；
  - 行小计/总计 × 列小计/总计（交叉格）。
- 汇总格带 `cell.kind = 'subtotal' | 'total'`、`rowKind / colKind`、
  `rowGroup / colGroup` 和实际匹配的 `members`；不伪造被折叠子维度的值。
- 行/列 `matrix` 置 `null`；`points` 置空；`toPixel()` 按新 cells 重新实现。
- 输入 layout 不被修改。

表头不变量：每个轴同一层 members 的 `size` 之和等于父 member 的 `size`，
根层之和等于该轴 `size.rows / size.cols`；汇总行/列在每一层都有表头单元格。
父级标签覆盖汇总行/列属于 rowspan/colspan 式覆盖，不是真正的单格跨层合并；
需要单个标签横跨多个表头层时，仍需核心 `depthSpan` 或 overlay 扩展。

## 5. 边界

- 空数据：不插入任何汇总，`withTotals()` 原样返回。
- 只有行轴或只有列轴：另一轴退化为单行/单列；纯列透视也能插入列汇总。
- 列轴为空 / 行轴为空：对应轴的总计跳过，不报错。
- 对叶子维度配置小计：静默忽略。
- `compact` / `cartesian` 都支持；展示布局不再依赖固定矩阵。
- 多度量当前不支持：`combineMeasures` 不保留 `__count` / `__valueCount`，
  `avg` 上卷会失真；后续在 combine 前按 measure 分别上卷，或保留这两个字段。
- 真正的单格跨层合并、表头样式、折叠联动均未实现。

## 6. 测试

- 上卷：行/列小计、总计、双轴交叉值、叶子维度忽略、全关短路、自定义
  reducer 的 `colDimension` / `rowKind` / `colKind`、avg 加权、min/max、
  输入记录不被修改。
- 布局：行/列槽位顺序、父块 size 包含汇总、三层行轴占位链、多层小计嵌套、
  两块表头的 size 不变量、交叉格、纯列透视、`cellMap`、`size`、
  `matrix = null`、`toPixel()`。
- 渲染：fake context 下出现行/列“小计”“总计”文本，绘制格数增加。
- 站点：DOM 桩确认四个开关组合、双度量禁用和状态文案。

## 7. 后续

1. 多度量按 measure 分块上卷（保留 `__count` / `__valueCount`）。
2. 可选的真正跨层表头合并（核心 `depthSpan` 或 overlay）。
3. 表头样式（overlay 或核心 `headerCellStyle` 扩展）。
4. 折叠/展开联动：折叠组只显示父行，展开后显示子行 + 小计；汇总始终从基础
   cells 计算，不重复计入折叠产生的汇总行。
