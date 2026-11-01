# 行小计 / 行总计（设计稿）

- **状态**：行轴 P1 已实现；列轴小计、双轴交叉、多度量、折叠联动后续。
- **日期**：2026-11-01
- **原则**：核心 `aggregate` / `layoutPivot` / `renderPivot` 冻结；采用路线 B
  （展示布局派生）；聚合运算和布局插入分离。

## 1. 数据流

```
明细 rows
  └─ aggregate()                 核心：最细粒度 cube
      └─ rollupRowTotals()       feature：按配置上卷，输出独立汇总表
          └─ layoutPivot()       核心：基础布局
              └─ withRowTotals()  feature：插入行、重建表头、填充汇总值
                  └─ renderPivot()
```

`rollupRowTotals()` 只读 cube，不读 layout；`withRowTotals()` 只读 layout 和
上卷结果，不再做任何聚合。两者可以独立测试，也可以被其他渲染器复用。

## 2. 配置

```js
const config = {
  rows: {
    subtotals: ['region'], // 只对 region 生成小计；叶子维度自动忽略
    grandTotal: true,      // 行末尾一行“总计”
  },
};
```

- `subtotals` 里的 key 必须属于行轴层级链，否则报错。
- 叶子维度（链的最后一个）静默忽略，不生成重复的“自身小计”。
- 首期只支持行轴，小计/总计位置固定为末尾。
- Demo 的开关只是把 DOM 状态翻译成上面的配置；feature 不读取 DOM。
- 全部关闭时 `rollupRowTotals()` 直接返回 `skipped: true`，不遍历 cube；
  `withRowTotals()` 原样返回输入 layout。

## 3. 上卷

小计粒度 = 行链根到配置维度，列轴维度完整保留；总计粒度 = 去掉所有行维度，
列轴维度完整保留。

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
  dimension: 'region' | null, // null 表示总计
  path: [{ key, value }],     // 行分组路径
  columns: [{ key, value }],  // 当前列组合
}
```

`records` 是最细粒度的聚合记录，不是原始明细。中位数、去重计数这类不能只靠
聚合值上卷的规则，不在 P1 范围；需要明细的规则应在聚合阶段解决。

上卷结果：

```js
{
  subtotals: Map<rowPathKey, Map<colPathKey, { value, __count, __valueCount }>>,
  grand: Map<colPathKey, { value, __count, __valueCount }> | null,
  dimensions: ['region'], // 实际生效的小计维度
  ignored: [],            // 被忽略的叶子维度
  rowChain: ['region', 'city'],
  colChain: ['year'],
  measure: { key: 'sales', aggregate: 'sum' },
  grandTotal: true,
  skipped: false,
}
```

## 4. 布局派生

- 每个配置维度的每个 member 块末尾插入一个 `size = 1` 的小计槽；行轴末尾插入
  总计槽。
- 小计 member 挂到父 member 的子层末尾：父 member 的 `size` 增加小计行，父标签
  纵向覆盖小计行；子层显示“小计”。数据坐标不变，只改表头树。
- 总计 member 在根层；如果还有更深层，补空占位 children 链，填满表头背景和边框。
- 原始 cells 的 `y` 按插入数量平移；小计/总计 cells 使用槽位的新坐标。
- 汇总格带 `cell.kind = 'subtotal' | 'total'`、`cell.rowGroup` 和实际匹配的
  `members`；不伪造被折叠子维度的值。
- 列轴完全不变：`size.cols`、列坐标、列表头都保持原样。
- `matrix` 置 `null`；`points` 置空；`toPixel()` 按新 cells 重新实现。
- 输入 layout 不被修改。

表头不变量：同一层 members 的 `size` 之和等于父 member 的 `size`，根层之和等于
`size.rows`；小计/总计行在每一层都有表头单元格。父级标签覆盖小计行属于
rowspan 式覆盖，不是真正的单格跨层合并；需要单个标签横跨多个表头层时，仍需
核心 `depthSpan` 或 overlay 扩展。

## 5. 边界

- 空数据：不插入小计/总计，`withRowTotals()` 原样返回。
- 无行轴（纯列透视）：行小计/总计无意义，跳过。
- 列轴为空：所有汇总格落在唯一的 `x = 0` 列。
- `compact` / `cartesian` 都支持；展示布局不再依赖固定矩阵。
- 多度量 P1 不支持：`combineMeasures` 当前不保留 `__count` / `__valueCount`，
  `avg` 上卷会失真。后续在 merge 前按 measure 分别上卷，或在长表中保留这两个
  字段。
- 双轴交叉小计、列小计、表头样式、折叠联动均未实现。

## 6. 测试

- 上卷：小计/总计值、叶子维度忽略、全关短路、自定义 reducer、avg 加权、
  min/max、输入记录不被修改。
- 布局：槽位顺序、表头 `offset / size`、父块 size 包含小计行、三层行轴的
  占位链、多层小计嵌套时的 size 连续性、表头 size 不变量、`cellMap`、
  `size.rows`、原始 cells 映射、`matrix = null`、`toPixel()`。
- 渲染：fake context 下出现“east 小计”“总计”文本，绘制格数增加。
- 站点：DOM 桩确认开关开启/关闭时汇总行出现/消失。

## 7. 后续

1. 列轴小计与双轴交叉格。
2. 多度量按 measure 分块上卷。
3. 可选的真正跨层表头合并（核心 `depthSpan` 或 overlay），用于把“小计/总计”
   做成单个横跨多层表头的合并格。
4. 表头样式（overlay 或核心 `headerCellStyle` 扩展）。
5. 折叠/展开联动：折叠组只显示父行，展开后显示子行 + 小计；汇总始终从基础
   cells 计算，不重复计入折叠产生的汇总行。
