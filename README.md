# pivot-table

把一组 JSON 记录布局成透视表二维网格，并渲染到 Canvas。代码按两个模块组织：

1. **数据模型**：明细记录 → 聚合 → 矩阵变换 → 二维网格向量。
2. **可视化**：二维网格模型 → Canvas 2D 像素坐标与绘制。

布局层不做任何 sum / avg / count，聚合层也不关心行列和矩阵；渲染层只消费
布局结果，不做聚合。

## 目录结构

```
src/
  model/
    index.mjs          模型入口：aggregate / layoutPivot
    aggregate.mjs      业务一：明细 -> 每个维度组合唯一
    pivot-layout.mjs   业务二：多维数据 -> 二维坐标 + 矩阵
    value-key.mjs      维度取值的稳定键
  render/
    index.mjs          可视化入口：renderPivot / computePivotGeometry
    geometry.mjs       纯几何：视口、屏幕矩形、冻结表头
    canvas-renderer.mjs Canvas 2D 绘制
    theme.mjs          默认主题与颜色工具
test/
  model/               聚合与布局测试
  render/              几何、绘制、主题测试
examples/
  demo.mjs             终端输出布局结果
  canvas.html          浏览器可视化示例
  sample-data.mjs      示例数据（浏览器与 Node 共享）
docs/
  matrix-transform.md  矩阵推导与 cartesian/compact 差异
  rendering.md         Canvas 渲染管线与性能方案
```

## 快速开始

```bash
node examples/demo.mjs
node --test test/model/*.test.mjs test/render/*.test.mjs
```

浏览器示例需要通过 HTTP 打开（ES module 不能走 `file://`）：

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000/examples/canvas.html
```

## 数据模型

```js
import { aggregate, layoutPivot } from './src/model/index.mjs';

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
// result.size: { rows, cols }
// result.matrix: 2 x (D+1) 仿射矩阵
// result.cells: [{ key, x, y, vector: [x, y], value, members, record }]
// result.cellMap: Map<"x,y", cell>
// result.axes.row.header: 可递归渲染 rowspan / colspan 的表头
```

`dimensions` 是必填的，`axis` 和 `parent` 都显式给出；核心不做自动推断，
也不自动分配行/列。实际运行时这组配置通常由外部变量或元数据提供。

### 阶段一：聚合

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

### 阶段二：布局

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

### 两种布局

- **cartesian**（默认）：每个父成员下补齐该子维度的全部成员，形成规则网格。
  `span` 与父成员无关，整个布局是一个固定矩阵，矩阵列之间严格成比例。
- **compact**：只排列数据中实际出现的成员组合，父成员块大小可变。此时没有
  全局固定矩阵，但每条记录的 `points[].transforms` 仍给出每个属性的一次
  平移变换，累加即得坐标。

相同数据下，compact 往往更紧凑，但表头是不规则的；cartesian 表头规整，
代价是空单元格。

## 可视化

```js
import { renderPivot } from './src/render/index.mjs';

const { geometry, stats } = renderPivot(canvas, result, {
  viewport: { width: 960, height: 560, scrollX: 0, scrollY: 0 },
  cellSize: { width: 104, height: 28 },
  headerSize: { row: 88, col: 28 },
  heatmap: true,
  formatValue: (value) => value.toLocaleString('zh-CN'),
});
// geometry.visible: { x0, x1, y0, y1 }
// stats.drawnCells: 本次实际绘制的格数（只含视口内）
```

渲染能力：

- 多层行 / 列表头，滚动时冻结在视口边缘；
- 视口虚拟化，只遍历并绘制可见单元格，网格线批量描边；
- 数值色阶（热力图）与自动对比文字颜色；
- `formatValue`、`cellStyle` 自定义文本和单元格样式；
- 传入 canvas 时按 DPR 设置物理像素，也可直接传 2D context；
- 返回 `geometry` 与 `stats`，便于命中测试和性能观测。

坐标换算与渲染解耦：`computePivotGeometry()` 只做纯几何计算，可单独用于
SVG、DOM 或自定义渲染器。完整的管线说明、性能机制和 Canvas / SVG / DOM /
WebGL 的取舍见 [docs/rendering.md](docs/rendering.md)。

## 当前假设

- 每个轴只支持一条层级链：一个根维度，每个维度最多一个子维度。
  多根、多叉（一个父多个并列子维度）会显式报错。
- `dimensions` 必填；每个维度必须显式指定 `axis: 'row' | 'col'`。
  父子关系用 `parent` 显式给出，根维度省略 `parent`。
- `aggregate` 的 `dimensions` 只用于分组；`layoutPivot` 的 `dimensions`
  还负责行列和层级。
- 模型输出整数网格坐标与二维向量；像素换算由渲染层的
  `computePivotGeometry()` 完成。`result.toPixel()` 仍保留为简单的等距换算辅助。
- 渲染器不自动计算列宽，也不做文本换行；列宽、行高由 `cellSize` 指定。
