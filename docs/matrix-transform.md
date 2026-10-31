# 多维数据到平面坐标的矩阵变换

本文描述 `layoutPivot()` 如何把“每个维度组合唯一”的多维数据编码成二维整数网格坐标。聚合（`aggregate()`）不在本文范围内：布局层不做 `sum / avg / count`，只做成员索引、矩阵变换和坐标计算。

## 1. 输入与输出

输入：

- `rows`：聚合后的记录数组，每个维度组合只出现一次。
- `dimensions`：`{ key, axis: 'row' | 'col', parent?, order?, compare? }[]`。
- `value`：度量字段名，布局层只从这个字段取单元格值。
- `mode`：`cartesian`（默认）或 `compact`。
- `duplicate`：重复记录策略，默认 `'error'`。

输出：

- `size`：`{ rows, cols }`，网格尺寸。
- `matrix`：`2 × (D + 1)` 仿射矩阵，仅 cartesian 模式有值。
- `dimensionVectors`：每个维度对应的一列，便于渲染层逐维使用。
- `cells`：实际存在的单元格，`{ x, y, value, members, record }`。
- `points`：每条聚合记录的坐标、成员、索引和逐属性变换。
- `axes.row` / `axes.col`：递归表头，成员带绝对 `offset` 和 `size`。

## 2. 符号

- `D`：维度数。
- `d`：维度下标，按 `dimensions` 输入顺序从 0 开始。
- `n_d`：维度 `d` 的成员数。
- `i_d`：记录在维度 `d` 上的成员序号，从 0 开始。
- `span_d`：维度 `d` 每前进一个成员，在所属轴上跨过的格数。
- `v`：增广向量 `[i_1, i_2, ..., i_D, 1]^T`。
- `M`：`2 × (D + 1)` 矩阵。
- `(x, y)`：列坐标和行坐标；`x` 向右，`y` 向下。

坐标约定：`x` 对应列轴，`y` 对应行轴。某个轴没有维度时，该轴长度为 1。

## 3. 成员索引

布局层先对每个维度收集所有出现过的取值，用 `valueKey()` 生成稳定键，再排序：

1. 显式 `compare(a, b)` 优先。
2. `order: 'asc' | 'desc'` 按数值、日期或字符串比较。
3. 默认 `first-seen`，按首次出现顺序。

排序后的位置就是成员序号 `i_d`。`valueKey()` 必须在聚合层和布局层使用同一套规则，否则同一个取值可能被当成两个成员。

同一维度组合出现重复记录时，默认直接报错，并提示先调用 `aggregate()`。布局层不会隐式聚合，也不会在重复时随便覆盖。

## 4. 层级与跨度

每个轴只支持一条层级链：一个根维度，每个维度最多一个子维度。父子维度必须在同一轴。

叶子维度没有子维度，每个成员占 1 格：

```
span_leaf = 1
```

父维度的跨度等于其所有后代成员数的乘积：

```
span_d = Π (n_c)   c 为 d 的后代
```

等价递推：

```
span_parent = n_child × span_child
```

直觉：父级每变一个成员，跨过整个子块；子级在父级划出的块内细定位。因此父维度的一列永远是子维度一列的整数倍。

> 这里的 `n_child` 是子维度的成员总数。cartesian 模式下每个父块都补齐相同的子成员，所以 `span` 与具体父成员无关。

## 5. 增广向量与矩阵

记录变成增广向量：

```
v = [i_1, i_2, ..., i_D, 1]^T
[x, y]^T = M · v
```

`M` 有 `D + 1` 列：

- 第 `d` 列：`span_d × u_d`，其中 `u_d` 是该维度所在轴的单位向量。
  - 行轴：`u_d = (0, 1)^T`，列向量为 `(0, span_d)`。
  - 列轴：`u_d = (1, 0)^T`，列向量为 `(span_d, 0)`。
- 最后一列：平移 `(x0, y0)^T`。当前实现所有坐标从 0 开始，所以 `x0 = y0 = 0`。

展开后：

```
x = Σ_{d ∈ 列轴} span_d · i_d + x0
y = Σ_{d ∈ 行轴} span_d · i_d + y0
```

因为每个维度只影响一个轴，`M` 的每一列（除最后一列）只有一个非零元。矩阵列顺序与 `dimensions` 输入顺序一致，记录向量的第 `d` 个分量必须使用同一个 `i_d`。

## 6. 示例

配置：

```js
const dimensions = [
  { key: 'region', axis: 'row' },
  { key: 'city', axis: 'row', parent: 'region' },
  { key: 'year', axis: 'col', order: 'asc' },
];
```

`city` 有 3 个成员，`year` 有 2 个成员。跨度：

```
span_city   = 1
span_region = n_city × span_city = 3
span_year   = 1
```

矩阵：

```
        [region] [city] [year] [1]
x  =  [   0       0      1     0 ] · v
y  =  [   3       1      0     0 ] · v
```

验证：

- `east / hangzhou / 2023`：`v = [0, 0, 0, 1]^T`，坐标 `(0, 0)`。
- `east / hangzhou / 2024`：`v = [0, 0, 1, 1]^T`，坐标 `(1, 0)`。
- `east / shanghai / 2023`：`v = [0, 1, 0, 1]^T`，坐标 `(0, 1)`。
- `west / chengdu / 2023`：`v = [1, 0, 0, 1]^T`，坐标 `(0, 5)`。

`region` 每变一级跨 3 行，`city` 每变一级跨 1 行。整棵树等价于混合进制解码：`region` 是高位，`city` 是低位，行坐标就是 `region × 3 + city`。

## 7. cartesian 模式

- 每个父成员下补齐该子维度的全部成员，即使某些组合在数据中没有出现。
- 每个父块大小相同，因此存在全局固定矩阵 `M`。
- `span_d` 与具体父成员无关，矩阵列之间严格成比例。
- `cells` 只包含实际出现的记录；`size` 包含补齐后的完整网格。渲染层用 `size` 和 `cells` 判断空单元格。
- 成员序号 `i_d` 是全局成员序。由于每个父块补齐相同的子成员，`i_d × span_d` 正好等于该维度在父块内偏移的累加，所以可以直接用矩阵乘索引向量。

## 8. compact 模式

- 只排列数据中实际出现的成员组合，父成员块大小可变。
- 不存在全局固定矩阵，`matrix` 为 `null`。
- 每条记录的 `points[].transforms` 给出逐属性的平移：

```js
{
  key: 'city',
  axis: 'row',
  memberOffset: 1,      // 该成员在父块内的相对偏移
  vector: [0, 1],       // 行轴为 (0, offset)，列轴为 (offset, 0)
}
```

- 记录的坐标等于所有 `transforms[].vector` 之和，根块从 0 开始。
- 可以把 compact 看作“逐记录的分段平移变换”：每条记录有自己的平移量，而不是共享一个 `M`。
- `axes.*.header` 仍给出每个成员的绝对 `offset` 和 `size`，但不同父块下的子成员 `offset` 不再满足统一比例。

## 9. 表头与矩阵的关系

`axes.row.header` 和 `axes.col.header` 是递归结构：

```js
{
  key: 'region',
  axis: 'row',
  members: [
    { value: 'east', index: 0, offset: 0, size: 3, children: {...} },
    { value: 'west', index: 1, offset: 3, size: 3, children: {...} },
  ],
}
```

- `offset`：成员沿该轴的绝对起始格，从 0 开始。
- `size`：成员跨过的格数。
- 子成员的 `offset` 以父块起点为基准再累加，因此可以直接用于 `rowspan` / `colspan` 渲染。
- `matrix` 描述“记录 → 坐标”，`header` 描述“成员 → 区间”。两者必须使用同一套 `span`，否则表头和单元格会错位。

## 10. 复杂度

设 `m` 为聚合后的记录数，`D` 为维度数，`C` 为实际单元格数。

- 成员收集：每个维度扫描一遍聚合数据，约 `O(m × D)`。
- 层级树构建：每层处理自己的记录子集，约 `O(m × D)`；cartesian 模式补齐空成员会增加节点数，但不增加记录数。
- 记录定位与单元格生成：约 `O(m × D)`。
- 空间：聚合结果、层级树、`cells`、`points` 和表头节点，约 `O(m × D + C)`。
- 矩阵本身只占 `O(D)`。

compact 模式省掉补齐的空单元格，但 `points` 和 `transforms` 仍按记录数增长。真正的性能瓶颈通常来自明细数据量 `N`；先聚合把 `N` 压成 `m` 后，布局阶段只处理聚合结果，这是推荐的两阶段流程。

## 11. 约束与边界

- 每个轴恰好一条链：单根、每个父最多一个子维度。多根、多叉、环、跨轴父子都会显式报错。
- `dimensions` 必填；每个维度必须显式指定 `axis: 'row' | 'col'`。父子关系用 `parent` 显式给出，根维度省略 `parent`。
- `value` 必填；布局层只读取该字段，不做聚合。
- 重复维度组合默认报错；也可显式指定 `duplicate: 'first' | 'last'`，但推荐先调用 `aggregate()`。
- 输出是整数网格坐标与二维向量；像素换算交给渲染层的 `computePivotGeometry()`，`result.toPixel({ width, height })` 保留为简单的等距换算辅助。
- 当前平移为 0。若未来支持自定义原点，只需修改 `M` 的最后一列，不影响 `span` 结构。

## 12. 实现映射

- `src/model/aggregate.mjs`：聚合层，把明细压成每个维度组合唯一的数据。
- `src/model/pivot-layout.mjs`：
  - `normalizeDimensions` / `buildChain`：维度校验与单链检查。
  - `collectMembers`：成员收集、稳定键和排序。
  - `buildLevel`：递归构建层级树，计算每个成员的 `size` 和 `offset`。
  - `locate`：记录 → 层级路径与绝对坐标。
  - `layoutPivot` 内部的 `spans` Map 与 `matrix` 构造：全局矩阵。
  - `axisResult` / `headerOf`：递归表头。
  - `toPixel`：网格坐标到像素坐标的简单辅助函数。
- `src/render/geometry.mjs`：屏幕矩形、可见范围、冻结表头与裁剪区域。
- `src/render/canvas-renderer.mjs`：Canvas 2D 绘制，只遍历视口内单元格。
