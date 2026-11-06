# pivot-table

[English](README.md) · [简体中文](README.zh-CN.md)

**Live site: <https://vtejuf.github.io/pivot-table/index.en.html>**　|　**中文主页: <https://vtejuf.github.io/pivot-table/>**

Aggregate JSON detail rows into a pivot table: the aggregation layer keeps one row per dimension combination, a matrix transform maps member indices to 2D integer coordinates, and Canvas draws only the cells inside the viewport. Zero runtime dependencies, pure ES Modules.

> **Deep dives live on the site**: the matrix derivation, data flow, interactive demo, rendering performance, benchmarks, and depth sweep are all on the [live site](https://vtejuf.github.io/pivot-table/index.en.html). This README stays focused on the overview and getting started.

## Highlights

- **Two-stage model**: `aggregate` handles grouping and measures; `layoutPivot` handles axes and the matrix. The renderer consumes only the layout result.
- **Matrix layout**: dimension hierarchies become mixed-radix vectors, and one affine transform yields `[x, y]`; supports both cartesian and compact modes.
- **Viewport virtualization**: iterate and draw only visible cells, keep headers frozen, and stroke grid lines in one batch.
- **Extensible by design**: heatmaps, dual measures, row/column subtotals and grand totals, expand/collapse, scrollbars, and custom overlays all attach through `cellStyle`, overlays, and other mount points.
- **Zero dependencies**: Node and the browser share the same ES Modules, with no build step.

## Quick start

### npm

```bash
npm install @vtejuf/pivot-table
```

The package is ESM-only. Import the core API from the package root, and optional features from `@vtejuf/pivot-table/features/*`.

### Node (repository)

```bash
node examples/demo.mjs
node --test test/model/*.test.mjs test/render/*.test.mjs \
  test/features/*.test.mjs test/site/*.test.mjs test/package.test.mjs \
  test/architecture.test.mjs
```

### Minimal call

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

For the full `dimensions` rules, aggregate functions, layout modes, render options, and feature authoring, see [Data flow](https://vtejuf.github.io/pivot-table/index.en.html#pipeline) and [Quickstart](https://vtejuf.github.io/pivot-table/index.en.html#quickstart) on the live site. Feature modules are available at `@vtejuf/pivot-table/features/heatmap`, `.../totals`, and so on.

### Site and examples

ES modules do not work over `file://`; serve the repository over HTTP:

```bash
python3 -m http.server 8000
# English site: http://localhost:8000/index.en.html
# 中文主页: http://localhost:8000/
# Standalone Canvas example: http://localhost:8000/examples/canvas.html
```

## Documentation map

The live site covers, in order:

- [Overview](https://vtejuf.github.io/pivot-table/index.en.html#overview)
- [Data flow and extension mounts](https://vtejuf.github.io/pivot-table/index.en.html#pipeline)
- [Matrix algorithm](https://vtejuf.github.io/pivot-table/index.en.html#algorithm)
- [Live demo](https://vtejuf.github.io/pivot-table/index.en.html#demo)
- [Rendering performance](https://vtejuf.github.io/pivot-table/index.en.html#performance)
- [Benchmarks](https://vtejuf.github.io/pivot-table/index.en.html#benchmark)
- [Depth sweep](https://vtejuf.github.io/pivot-table/index.en.html#depth)
- [Quickstart](https://vtejuf.github.io/pivot-table/index.en.html#quickstart)

Design docs in the repository (currently in Chinese):

- [Matrix derivation and cartesian / compact](docs/matrix-transform.md)
- [Canvas rendering pipeline and performance](docs/rendering.md)
- [Feature architecture and boundaries](docs/features-architecture.md)
- [Custom feature mount points](docs/custom-features.md)
- [Row/column subtotal and grand-total rules](docs/totals.md)

## Project layout

```
src/index.mjs     Package root entry (model + render)
src/model/       Aggregation, matrix layout, dimension keys
src/render/      Geometry, Canvas drawing, theme
src/features/    Dual measures, heatmap, totals, collapse, scrollbars, ...
site/            Site scripts, demo controller, code examples
examples/        Node example and standalone Canvas page
test/            Model, render, feature, site, and architecture tests
bench/           Benchmark and depth-sweep scripts, result JSON
docs/            Design documents
```

## Development

```bash
# Full test suite
node --test test/model/*.test.mjs test/render/*.test.mjs \
  test/features/*.test.mjs test/site/*.test.mjs test/architecture.test.mjs

# Benchmarks (writes bench/results.json)
node bench/run.mjs
node bench/verify.mjs

# Depth sweep (writes bench/depth-results.json)
node bench/depth-run.mjs
```

Architecture rule: `src/model` and `src/render` never import `src/features`; `test/architecture.test.mjs` enforces the boundary.

## Deployment

The root `index.html` / `index.en.html` files are static and require no build. GitHub Pages publishes from the root of the `dev` branch; `main` is merged manually by the maintainer. `.nojekyll` tells Pages to skip Jekyll and publish `src/`, `site/`, and the other directories as-is.

Live URLs:

- English: <https://vtejuf.github.io/pivot-table/index.en.html>
- 中文: <https://vtejuf.github.io/pivot-table/>

## Current assumptions

- Each axis supports one hierarchy chain: a single root and at most one child per dimension.
- `dimensions` is required, and every dimension explicitly declares `axis`; parent/child relationships are declared with `parent`.
- `aggregate` uses `dimensions` only for grouping; `layoutPivot` also uses them for axes and hierarchy.
- The renderer does not compute column widths or wrap text; `cellSize` controls column width and row height.

## License

MIT
