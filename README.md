# pivot-table-model

把一组 JSON 记录布局成透视表二维网格的模型。模型分成两个独立业务：

1. **聚合**：明细记录 → 每个维度组合唯一的多维数据。
2. **布局**：多维数据 → 二维坐标（矩阵变换）。

布局层不做任何 sum / avg / count，聚合层也不关心行列和矩阵。

## 快速开始

```bash
node examples/demo.mjs
node --test test/*.test.mjs
```

```js
import { aggregate } from './src/aggregate.mjs';
import { layoutPivot } from './src/pivot-layout.mjs';

const dimensions = [
  { key: 'region', axis: 'row' },
  { key: 'city', axis: 'row', parent: 'region' },
  { key: 'year', axis: 'col', order: 'asc' },
];

// 阶段一：聚合
const cube = aggregate(rows, {
  dimensions,
  measure: { key: 'sales', aggregate: 'sum' },
});
// cube.rows: [{ region, city, year, sales, __count, __valueCount }, ...]
// 每个维度组合只有一行

// 阶段二：布局
const result = layoutPivot(cube.rows, {
  dimensions,
  value: 'sales',
});
// result.cells: [{ x, y, value, members, record }]
// result.matrix: 2 x (D+1) 仿射矩阵
// result.axes.row.header: 可递归渲染 rowspan/colspan 的表头
```

`dimensions` 是必填的，`axis` 和 `parent` 都显式给出；核心不做自动推断，
也不自动分配行/列。实际运行时这组配置通常由外部变量或元数据提供。

## 阶段一：聚合

`aggregate(rows, { dimensions, measure })` 按 `dimensions[].key` 分组，
输出“每个维度组合一行”的数据。支持的聚合方式：

```
count / sum / avg / min / max
```

`measure` 省略时等价于 `{ aggregate: 'count' }`，输出字段名 `__count`。
每条输出记录额外带两个保留字段：

- `__count`：该组的明细条数。
- `__valueCount`：参与度量的有限数值条数，供 avg 上卷使用。

聚合不读取 `axis` / `parent`，只关心分组字段。

## 阶段二：布局

`layoutPivot(rows, { dimensions, value })` 把聚合记录的维度取值编码成
成员序号 `i_d`，记录变成增广向量：

```
v = [i_1, i_2, ..., i_D, 1]^T
[x, y]^T = M · v
```

`M` 的第 d 列是 `span_d` 乘以该维度所在轴的单位向量，最后一列是平移。
层级链上：

```
span_parent = n_child × span_child
span_d      = Π (n_c)   c 为 d 的后代
```

所以父维度的一列永远是子维度一列的整数倍：父级粗定位，子级在父级划出的
块内细定位。整棵树等价于一个混合进制数的解码。

例：`region > city`，`city` 有 3 个成员，`year` 在列轴：

```
        [region] [city] [year] [1]
x  =  [   0       0      1     0 ] · v
y  =  [   3       1      0     0 ] · v
```

`region` 每变一级跨 3 行，`city` 每变一级跨 1 行。

`value` 必填，布局层只从记录里取这个字段作为单元格值。同一维度组合出现
重复记录时默认报错，提示先调用 `aggregate()`；不会在布局层偷偷聚合。

完整的符号定义、矩阵推导和 cartesian/compact 差异见
[docs/matrix-transform.md](docs/matrix-transform.md)。

## 两种布局

- **cartesian**（默认）：每个父成员下补齐该子维度的全部成员，形成规则网格。
  `span` 与父成员无关，整个布局是一个固定矩阵，矩阵列之间严格成比例。
- **compact**：只排列数据中实际出现的成员组合，父成员块大小可变。此时没有
  全局固定矩阵，但每条记录的 `points[].transforms` 仍给出每个属性的一次
  平移变换，累加即得坐标。

相同数据下，compact 往往更紧凑，但表头是不规则的；cartesian 表头规整，
代价是空单元格。

## 当前假设

- 每个轴只支持一条层级链：一个根维度，每个维度最多一个子维度。
  多根、多叉（一个父多个并列子维度）会显式报错。
- `dimensions` 必填；每个维度必须显式指定 `axis: 'row' | 'col'`。
  父子关系用 `parent` 显式给出，根维度省略 `parent`。
- `aggregate` 的 `dimensions` 只用于分组；`layoutPivot` 的 `dimensions`
  还负责行列和层级。
- 输出的是整数网格坐标；像素换算交给 `result.toPixel({ width, height })`
  或渲染层。
