# pivot-table

**在线主页：<https://vtejuf.github.io/pivot-table/>**

把一组 JSON 记录布局成透视表二维网格，并渲染到 Canvas。代码按两个模块组织：

1. **数据模型**：明细记录 → 聚合 → 矩阵变换 → 二维网格向量。
2. **可视化**：二维网格模型 → Canvas 2D 像素坐标与绘制。

布局层不做任何 sum / avg / count，聚合层也不关心行列和矩阵；渲染层只消费
布局结果，不做聚合。

[GitHub Pages 主页](https://vtejuf.github.io/pivot-table/) 包含算法说明、可交互 Demo
和性能方案，左侧菜单、右侧内容。

## 目录结构

```
index.html            GitHub Pages 主页（左侧菜单 + 算法 + Demo）
.nojekyll             跳过 Jekyll，按静态文件原样发布
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
  features/
    dual-measure.mjs   并列度量：度量作为最末列维度（附加功能）
    heatmap.mjs        热力图：通过 cellStyle 渲染，按 measure 分组色阶
site/
  main.mjs             主页导航与 Demo 初始化
  demo.mjs             主页 / 示例共用的 Demo 控制器
  styles.css           主页样式
test/
  model/               聚合与布局测试
  render/              几何、绘制、主题测试
  features/
    dual-measure.test.mjs  并列度量测试
    heatmap.test.mjs       热力图测试
  architecture.test.mjs    核心不反向依赖 features
examples/
  demo.mjs             终端输出布局结果
  canvas.html          独立 Canvas 示例（复用 site/demo.mjs）
  sample-data.mjs      示例数据（浏览器与 Node 共享）
bench/
  config.mjs           基准维度配置（8 × 8 × 6 × 4 = 1536 组合）
  generate.mjs         确定性数据生成与分片合并
  transform.mjs        单个规模的变换基准
  run.mjs              多规模运行器（独立进程、3 次中位数）
  verify.mjs           校验分片聚合与单次结果一致
  results.json         最新实测结果（主页基准表格读取）
  depth-step.mjs       单个行/列深度组合的变换基准
  depth-run.mjs        维度深度扫描运行器
  depth-results.json   深度实验结果（主页读取）
docs/
  matrix-transform.md  矩阵推导与 cartesian/compact 差异
  rendering.md         Canvas 渲染管线与性能方案
  features-architecture.md  附加功能架构与边界
```

## 快速开始

```bash
# Node：模型示例与测试
node examples/demo.mjs
node --test test/model/*.test.mjs test/render/*.test.mjs \
  test/features/*.test.mjs test/architecture.test.mjs

# 基准测试（写 bench/results.json）
node bench/run.mjs
node bench/verify.mjs
node bench/depth-run.mjs
```

主页和浏览器示例需要通过 HTTP 打开（ES module 不能走 `file://`）：

```bash
python3 -m http.server 8000
# 主页：http://localhost:8000/
# 独立示例：http://localhost:8000/examples/canvas.html
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
import { createHeatmapStyle } from './src/features/heatmap.mjs';

const heatmap = createHeatmapStyle(result);

const { geometry, stats } = renderPivot(canvas, result, {
  viewport: { width: 960, height: 560, scrollX: 0, scrollY: 0 },
  cellSize: { width: 104, height: 28 },
  headerSize: { row: 88, col: 28 },
  cellStyle: heatmap.cellStyle,
  formatValue: (value) => value.toLocaleString('zh-CN'),
});
// geometry.visible: { x0, x1, y0, y1 }
// stats.drawnCells: 本次实际绘制的格数（只含视口内）
```

渲染能力：

- 多层行 / 列表头，滚动时冻结在视口边缘；
- 视口虚拟化，只遍历并绘制可见单元格，网格线批量描边；
- **并列度量**：feature 层把度量作为列轴最末维度，Demo 工具栏可开关；
- **热力图 feature**：通过 `cellStyle` 渲染；单度量共用一个范围，双度量按
  `measure` 分别计算 min/max 和色阶，互不干扰；
- 核心渲染器只保留 `cellStyle` / `formatValue` 接缝，不再包含热力图逻辑；
- `formatValue`、`cellStyle` 自定义文本和单元格样式；
- 传入 canvas 时按 DPR 设置物理像素，也可直接传 2D context；
- 返回 `geometry` 与 `stats`，便于命中测试和性能观测。

坐标换算与渲染解耦：`computePivotGeometry()` 只做纯几何计算，可单独用于
SVG、DOM 或自定义渲染器。完整的管线说明、性能机制和 Canvas / SVG / DOM /
WebGL 的取舍见 [docs/rendering.md](docs/rendering.md)。

## 基准测试

本地实测原始明细经过 `aggregate()` + `layoutPivot()` 的耗时与峰值内存：

- 维度固定：8 region × 8 city × 6 year × 4 product = 1536 个组合。
- 1 万 / 10 万 / 100 万：单次 `aggregate()`，完整数组驻留内存。
- 1000 万：按百万级峰值线性外推，单次聚合预计需要约 2 GB 以上，超过本机
  可用内存，改用每片 20 万条的分片聚合；分片合并逻辑由 `bench/verify.mjs`
  校验与单次结果一致。
- 每个规模独立 Node 进程，重复 3 次取**变换耗时中位数**；峰值内存为
  `process.resourceUsage().maxRSS`。变换耗时 = 聚合 + 合并 + 布局，不含夹具生成。

本次环境：Node v24.22.2，2 vCPU Intel Xeon Gold 6271C，1.8 GiB 内存
（运行前可用约 0.9 GiB），Linux x64。

结果（变换耗时 / 峰值内存）：

- 1 万：38.2 ms / 62.9 MB
- 10 万：104.8 ms / 82.0 MB
- 100 万：848.6 ms / 249.2 MB
- 1000 万（分片）：8.00 s / 184.1 MB

聚合是主要成本，百万级约 827 ms；布局固定 1536 个组合，耗时约 13–22 ms，
基本不随原始明细数增长。1000 万级单次聚合按百万级内存线性外推会超过 2 GB，
本机未运行。

完整数据与每次样本见 `bench/results.json`，主页的“基准测试”区会读取并展示。
复现：

```bash
node bench/run.mjs
node bench/verify.mjs
```

### 维度深度实验（100 万条）

固定 100 万条明细，输入对象固定包含 20 个维度字段，每次只激活
`rowDepth + colDepth` 个维度；每层 2 个成员，因此行网格 = 2^行深、
列网格 = 2^列深。顺序是先增加行深度 1..10（列深 0），再固定行深 10、
增加列深度 1..10。

- 每个组合独立 Node 进程，堆上限 768 MB；每步只运行一次，用于观察趋势。
- 停止条件看**矩阵变换（layoutPivot）**耗时是否超过 3 秒，聚合耗时单独记录；
  内存不足也会停止。
- 行阶段 1..10：矩阵变换 1.9–25.9 ms，峰值 320–431 MB；聚合 0.57–1.92 s，
  行深度主要增加的是聚合成本。
- 列阶段（行深 10）1..7：矩阵变换 75 ms / 108 ms / 175 ms / 271 ms /
  437 ms / 1.18 s / 2.74 s；峰值内存 453–745 MB。
- 列深 8：768 MB 堆 OOM，实验以内存受限停止；3 秒矩阵变换阈值未测到。

```bash
node bench/depth-run.mjs
# 内存更大的机器可放宽堆上限继续：
node bench/depth-run.mjs --heap 1024
```

完整结果见 `bench/depth-results.json`，主页的“深度实验”区会读取并展示。

## 主页与 GitHub Pages

根目录的 `index.html` 是纯静态主页，不需要构建：

- 左侧菜单：概览、数据流、矩阵算法、Demo、性能方案、快速开始；
- 右侧内容包含算法推导、可交互 Canvas Demo 和方案对比；
- Demo 控制器在 `site/demo.mjs`，主页与 `examples/canvas.html` 共用；
- 控件通过 `data-demo-*` 属性接入，页面上预留了“小计 / 总计”“折叠 / 展开”
  扩展位。后续可在 `rebuildLayout()` 前处理聚合行，或扩展布局的可见成员集合。

部署到 GitHub Pages：

1. 打开仓库 **Settings → Pages → Build and deployment**。
2. Source 选择 **Deploy from a branch**，分支选择 `dev`，目录选择 `/ (root)`。
3. 保存后访问 `https://<user>.github.io/pivot-table/`，本项目为
   `https://vtejuf.github.io/pivot-table/`。

`.nojekyll` 让 Pages 跳过 Jekyll，直接按静态文件发布 `src/`、`site/` 等目录。
发布分支是 `dev`：主页改动提交并推送到 `dev` 后即更新线上站点。
`main` 不参与发布，由维护者手动合并。

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
