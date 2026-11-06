# pivot-table

[English](README.md) · [简体中文](README.zh-CN.md)

**在线主页：<https://vtejuf.github.io/pivot-table/>**　|　**English site: <https://vtejuf.github.io/pivot-table/index.en.html>**

把一组 JSON 明细聚合成透视表：聚合层保证每个维度组合唯一，矩阵变换把维度序号映射成二维整数坐标，Canvas 只绘制视口内的单元格。零运行时依赖，纯 ES Modules。

> **详细内容在主页**：算法推导、数据流、可交互 Demo、渲染性能、基准测试和维度深度实验都在[在线主页](https://vtejuf.github.io/pivot-table/)上。README 只保留概览和上手入口。

## 特性

- **两段式模型**：`aggregate` 负责分组与度量，`layoutPivot` 负责行列与矩阵；渲染层只消费布局结果。
- **矩阵布局**：维度层级编码成混合进制向量，一次仿射变换得到 `[x, y]`；支持 cartesian / compact 两种模式。
- **视口虚拟化**：只遍历并绘制可见单元格，表头冻结，网格线批量描边。
- **按需扩展**：热力图、并列度量、行/列小计与总计、展开/折叠、滚动条、自定义叠加都通过 `cellStyle`、overlay 等挂载点接入。
- **零依赖**：Node 与浏览器共用同一套 ES Modules，没有构建步骤。

## 快速开始

### npm

```bash
npm install @vtejuf/pivot-table
```

包是 ESM-only。核心 API 从包根入口导入，可选 feature 从 `@vtejuf/pivot-table/features/*` 导入。

### Node（仓库内）

```bash
node examples/demo.mjs
node --test test/model/*.test.mjs test/render/*.test.mjs \
  test/features/*.test.mjs test/site/*.test.mjs test/package.test.mjs \
  test/architecture.test.mjs
```

### 最小调用

```js
import { aggregate, layoutPivot, renderPivot } from '@vtejuf/pivot-table';

const dimensions = [
  { key: 'region', axis: 'row' },
  { key: 'city', axis: 'row', parent: 'region' },
  { key: 'year', axis: 'col' },
];

const cube = aggregate(rows, {
  dimensions,
  measure: { key: 'sales', aggregate: 'sum' },
});

const layout = layoutPivot(cube.rows, { dimensions, value: 'sales' });

renderPivot(canvas, layout, {
  viewport: { width: 960, height: 540 },
  cellSize: { width: 104, height: 28 },
});
```

`dimensions` 的完整规则、聚合函数、布局模式、渲染选项和 feature 写法，见主页的[数据流](https://vtejuf.github.io/pivot-table/#pipeline)与[快速开始](https://vtejuf.github.io/pivot-table/#quickstart)。feature 模块通过 `@vtejuf/pivot-table/features/heatmap`、`.../totals` 等子路径导入。

### 主页与示例

ES module 不能走 `file://`，需要 HTTP：

```bash
python3 -m http.server 8000
# 中文主页：http://localhost:8000/
# English: http://localhost:8000/index.en.html
# 独立 Canvas 示例：http://localhost:8000/examples/canvas.html
```

## 文档地图

主页按顺序覆盖：

- [概览](https://vtejuf.github.io/pivot-table/#overview)
- [数据流与扩展挂载点](https://vtejuf.github.io/pivot-table/#pipeline)
- [矩阵算法](https://vtejuf.github.io/pivot-table/#algorithm)
- [可视化 Demo](https://vtejuf.github.io/pivot-table/#demo)
- [渲染性能](https://vtejuf.github.io/pivot-table/#performance)
- [基准测试](https://vtejuf.github.io/pivot-table/#benchmark)
- [维度深度实验](https://vtejuf.github.io/pivot-table/#depth)
- [快速开始](https://vtejuf.github.io/pivot-table/#quickstart)

仓库内的设计文档（英文版为默认，中文版使用 `.zh-CN.md` 后缀）：

- [矩阵推导与 cartesian / compact 差异](docs/matrix-transform.zh-CN.md)
- [Canvas 渲染管线与性能方案](docs/rendering.zh-CN.md)
- [附加功能架构与边界](docs/features-architecture.zh-CN.md)
- [自定义 feature 挂载点](docs/custom-features.zh-CN.md)
- [行/列小计/总计规则](docs/totals.zh-CN.md)

## 目录结构

```
src/index.mjs     包根入口（model + render）
src/model/       聚合、矩阵布局、维度键
src/render/      几何、Canvas 绘制、主题
src/features/    并列度量、热力图、小计/总计、折叠、滚动条等
site/            主页脚本、Demo 控制器、示例代码
examples/        Node 示例与独立 Canvas 页面
test/            模型、渲染、feature、站点与架构测试
bench/           基准与深度实验脚本、结果 JSON
docs/            设计文档
```

## 开发

```bash
# 全量测试
node --test test/model/*.test.mjs test/render/*.test.mjs \
  test/features/*.test.mjs test/site/*.test.mjs test/architecture.test.mjs

# 基准（写入 bench/results.json）
node bench/run.mjs
node bench/verify.mjs

# 维度深度实验（写入 bench/depth-results.json）
node bench/depth-run.mjs
```

架构约束：`src/model` 与 `src/render` 不反向依赖 `src/features`；`test/architecture.test.mjs` 会守住这条边界。

## 部署

根目录的 `index.html` / `index.en.html` 是纯静态页面，不需要构建。GitHub Pages 从 `dev` 分支根目录发布；`main` 由维护者手动合并。`.nojekyll` 让 Pages 跳过 Jekyll，直接发布 `src/`、`site/` 等目录。

线上地址：

- 中文：<https://vtejuf.github.io/pivot-table/>
- English: <https://vtejuf.github.io/pivot-table/index.en.html>

## 当前假设

- 每个轴只支持一条层级链：一个根维度，每个维度最多一个子维度。
- `dimensions` 必填，每个维度显式给出 `axis`；父子关系用 `parent` 显式给出。
- `aggregate` 的 `dimensions` 只负责分组；`layoutPivot` 的 `dimensions` 还负责行列和层级。
- 渲染器不自动计算列宽或换行，列宽、行高由 `cellSize` 指定。

## License

MIT
