[English](rendering.md) · [简体中文](rendering.zh-CN.md)

# Visualization layer: Canvas rendering and performance trade-offs

## Module boundaries

```
src/
  model/                data model: aggregation + matrix layout, canvas-agnostic
    aggregate.mjs
    pivot-layout.mjs
    value-key.mjs
  render/               visualization: coordinate conversion + Canvas drawing, no aggregation
    geometry.mjs        pure geometry, testable in Node
    canvas-renderer.mjs Canvas 2D drawing
    theme.mjs           default theme and color helpers
```

The model layer emits integer grid coordinates; the render layer consumes only the
result of `layoutPivot()`, never reads detail rows, and performs no sum / avg / count.
The two can be used independently: the same layout could be rendered to Canvas, SVG,
or a DOM table.

## Rendering pipeline

```
detail rows
  └─ aggregate()        one record per dimension combination
      └─ layoutPivot()  size / axes.header / cellMap / points
          └─ computePivotGeometry()  screen rectangles, visible range, clip regions
              └─ renderPivot()       background, grid lines, text, frozen headers
```

`renderPivot(canvas, layout, options)` returns:

```js
{
  geometry, // coordinate system and visible range used for this render
  stats: {
    cellsInGrid,   // total cells in the grid
    drawnCells,    // cells actually drawn this render
    drawnValues,   // cells among them that have values
    textDraws,     // number of fillText calls
    headerCells,   // header blocks drawn
    gridLines,     // number of grid lines
    visible,       // { x0, x1, y0, y1 }
  },
}
```

`stats` is the performance observation point: as the total cell count grows,
`drawnCells` should still vary only with viewport size.

## Coordinate system

Content coordinates lay out headers and cells by cell size, with the origin at the
top-left:

```
dataOrigin   = (rowDepth × rowHeaderWidth, colDepth × colHeaderHeight)
contentSize  = dataOrigin + (cols × cellWidth, rows × cellHeight)
```

Screen coordinates = content coordinates − scroll offset. Headers are frozen
independently:

```
data cell     screen = dataOrigin + (x × cellW, y × cellH) − (scrollX, scrollY)
row header    screen = (depth × rowHeaderW, dataOrigin.y + offset × cellH − scrollY)
column header screen = (dataOrigin.x + offset × cellW − scrollX, depth × colHeaderH)
```

Visible cell range:

```
x0 = floor(scrollX / cellW)
x1 = ceil((scrollX + dataViewportWidth) / cellW) − 1
```

`computePivotGeometry()` also clamps the scroll offset to the content range and
returns three clip rectangles: `dataClip / rowHeaderClip / colHeaderClip`. The
renderer does not have to derive these boundaries itself.

## Implemented performance mechanisms

- **Viewport virtualization**: the data area iterates only over the `visible` range
  instead of the whole grid. In tests, a 150 × 150 layout (22,500 cells) draws only 50
  cells in a 480 × 280 data viewport.
- **O(1) cell lookup**: the model's `cellMap` is keyed by `${x},${y}`, so rendering
  never scans `cells` linearly.
- **Batched grid lines**: all visible horizontal and vertical lines are merged into one
  `beginPath()` + `stroke()` instead of per-cell `strokeRect()`.
- **Binary-search header pruning**: header member `offset` values are monotonically
  increasing, so binary search finds the first member inside the viewport and skips
  whole out-of-viewport member subtrees.
- **Layered clipping**: the data area and both headers are clipped separately, so
  scrolling redraws only the visible header members.
- **One DPR transform**: `setupCanvas()` sets the backing-store size and
  `setTransform(dpr, ...)` once, and drawing code always uses CSS pixels. When the size
  does not change, `canvas.width / height` are not reassigned, avoiding buffer
  reallocation on scroll redraws.
- **Style callbacks come from features**: visual encodings such as heatmaps compute
  colors in the feature layer through `cellStyle`; the core only applies background
  and text colors.
- **No text measurement**: text is clipped to its cell by default, with no per-cell
  `measureText()` or automatic wrapping; ellipsis or automatic column widths should be
  precomputed by the caller.

Drawing cost is roughly O(visible cells + visible header cells), largely independent of
the total cell count. Memory cost is the number of cells with data in `cellMap`; empty
grids store no objects.

## Alternative approaches

- **Canvas 2D (current implementation)**
  - Fits: roughly 1,000–100,000 cells, regular grids, scroll/zoom interaction.
  - Pros: few draw calls, fast batched text and rectangles, zero dependencies, direct
    DPR control.
  - Cons: no text selection or accessibility; hit testing and scrollbars must be built.
- **DOM `<table>`**
  - Fits: fewer than about 1,000 cells; copy/paste, screen readers, and in-cell form
    controls.
  - Pros: semantic, accessible, with browser-managed styling and text layout.
  - Cons: many nodes, high layout/reflow cost; merged headers and virtual scrolling are
    complex.
- **SVG**
  - Fits: small-to-medium data, vector printing/export, CSS interaction, and precise
    hit testing.
  - Pros: each cell is a node; events and export are straightforward.
  - Cons: node count and style calculation grow linearly with cells; large tables are
    clearly slower than Canvas.
- **Canvas + offscreen cache**
  - Fits: medium-to-large tables with continuous scrolling. Cache headers, grid lines,
    and zebra stripes in `OffscreenCanvas`, translate the bitmap while scrolling, and
    redraw the text layer on demand.
  - Cost: cache invalidation logic (data/theme/size changes) and memory.
  - This is the most natural next optimization for the current implementation.
- **WebGL / WebGPU**
  - Fits: 100,000 to millions of cells, smooth zoom, animation, minimaps.
  - Typical approach: instanced rectangles for backgrounds and grid lines, text baked
    into atlases or SDF fonts.
  - Cost: text layout, hit testing, accessibility, and implementation complexity all
    rise sharply; usually worth it only when measured Canvas 2D frame rates fall short.
- **Layered aggregation / on-demand drill-down**
  - Not a different renderer but less data: show a summary level first, load the next
    level on click.
  - For "the data itself is huge" scenarios, this is usually more effective than
    changing the render backend.

Rules of thumb (based on visible cells rather than total cells):

- Visible cells < 5,000: Canvas 2D is enough; prioritize interaction and accessibility.
- Total cells around 100,000 with 60fps scrolling: add offscreen or chunked caching.
- Total cells in the millions or continuous zoom: consider WebGL/WebGPU together with
  layered aggregation.
- Copy, screen reader, or print requirements: provide a DOM/SVG version or DOM mirror
  instead of forcing Canvas.

## Custom overlay rendering

Core `renderPivot` does not accept arbitrary decoration callbacks. For badges,
reference lines, selection outlines, and similar overlays, use
`src/features/overlay.mjs`:

```js
import { renderWithOverlay, createCornerLabels } from './src/features/overlay.mjs';

renderWithOverlay(canvas, layout, renderOptions, createCornerLabels());
```

`renderWithOverlay()` calls the core renderer first, then hands the same 2D context
(CSS pixel coordinates, DPR already handled) to `draw(ctx, { layout, geometry, theme,
options })`. Core geometry, draw order, and default output stay unchanged, and overlays
are always on top; the context is restored even if `draw` throws.

`createCornerLabels()` is only a built-in example: it draws row/column dimension names
in the frozen corner area, skips an empty corner, and truncates with an ellipsis when
too narrow. Real applications can write their own `draw`.

For a systematic overview of mount points such as `cellStyle`, `formatValue`,
layout derivation, overlays, and interaction, see
[custom-features.md](custom-features.md); `src/features/cell-marker.mjs` is a complete
custom feature example that uses both `cellStyle` and `renderWithOverlay`.

## Scrollbar feature

`src/features/scrollbar.mjs` overlays floating scrollbars after core drawing, leaving
core geometry, visible ranges, and default draw order unchanged:

```js
import { createScrollbarOverlay, scrollFromThumbPosition } from './src/features/scrollbar.mjs';
import { renderWithOverlay } from './src/features/overlay.mjs';

const scrollbars = createScrollbarOverlay();
renderWithOverlay(canvas, layout, options, scrollbars.draw);

const hit = scrollbars.hitTest(x, y); // { axis, part, bar } | null
const next = scrollFromThumbPosition(hit.bar, y, grabOffset);
```

- Tracks start at `dataOrigin`, avoiding the frozen column/row headers; when both axes
  can scroll, the bottom-right corner is left empty.
- Thumb length is computed from `dataViewport / dataSize` and clamped to a minimum
  grabbable length; when `canScrollX / canScrollY` is false, the whole bar is hidden.
- `hitTest` distinguishes thumb / track; clicking the track uses `thumbLength / 2` as
  `grabOffset`, centering the thumb on the click position.
- `drawScrollbars()` accepts a `{ hover, active, opacity }` state, uses different colors
  for hover / drag, and supports fading through `globalAlpha`.
- `createScrollbarAutoHide({ delay, fadeDuration })` is a pure time state machine: call
  `show()` on scroll / drag, `setPinned(true)` while hovering or dragging the scrollbar,
  and read `opacity(now)` for the current opacity. `site/demo.mjs` drives the fade with
  `setTimeout` + `requestAnimationFrame` and redraws when opacity changes.
- Hidden scrollbars remain hittable for hover wake-up; the Demo treats pointerdown as
  canvas panning when `opacity <= 0.05`, avoiding accidental grabs of an invisible bar.
- Overlay drawing occupies about 13px along the right/bottom viewport edges without
  modifying core `dataClip`, `visible`, or the layout object.

`site/demo.mjs` already integrates it: scrollbars appear after interaction and fade
about 900ms after the last operation; they stay visible while the pointer hovers or
drags a bar; pointer hits on a scrollbar take priority over canvas panning, and the
rest of the canvas still pans; wheel, arrow keys, and scrollbars all ultimately write
back to `scrollX / scrollY`.

## Row/column subtotal and grand-total layout

`src/features/totals.mjs` derives a display layout outside the core layout:
`rollupTotals()` / `rollupMultiTotals()` first roll up uniformly by row/column
dimensions, and `withTotals()` then inserts subtotals/grand totals, rebuilds both
header blocks, and fills intersection cells and `cellMap`. With multiple measures,
column totals are split by measure. Subtotals attach to the parent block's child level,
the parent label covers the subtotal rows/columns (child levels show the subtotal label,
Chinese `小计` by default), and deeper levels of grand totals are
filled with placeholder chains. The display layout's `matrix` is `null`, and the
renderer still consumes it as an ordinary layout; rolled-up cells carry
`cell.kind = 'subtotal' | 'total'`, which `cellStyle` can use to distinguish them.
See [totals.md](totals.md) for the design and boundaries.

## Expand / collapse feature

`src/features/collapse.mjs` re-rolls up after `aggregate()` according to the collapse
state, then hands the result to core `layoutPivot()`; core layout and the renderer stay
unchanged:

- `collapseKey(axis, dimension, value)`: a stable collapse key;
- `collapseCube(cube, collapsed)`: replaces the child dimensions of collapsed parent
  members with `（全部）` and re-rolls up per measure (weighted by `__valueCount` for
  avg);
- `hitTestHeader(layout, geometry, point, { canCollapse })`: hits row / column parent
  headers; `canCollapse` can mask dimensions without collapse semantics;
- `drawCollapseIndicators(ctx, { layout, geometry, collapsed, canCollapse })`: draws
  + / − indicators to the right of parent headers; with multiple measures it masks
  `measure` and its direct parent dimension;
- It currently supports compact mode only, and can be combined with row/column totals
  and multi-measure layouts. Collapsed parents skip subtotals while grand totals are
  preserved. With multiple measures, collapse each measure's cube separately before
  `combineMeasures`; `measure` and its direct parent dimension do not take part in
  collapse and are filtered with `canCollapse`. Cartesian mode is not yet supported:
  it pads every parent with the global set of child members;
- The Demo exposes it through the "Collapse mode" switch, which clears state and
  restores the full layout when turned off;
- See [custom-features.md](custom-features.md#collapse) for the complete mount-point
  documentation.

## Interaction extensions

Hit testing can reuse the model directly:

```js
const x = Math.floor((event.offsetX - geometry.dataOrigin.x + scrollX) / cellWidth);
const y = Math.floor((event.offsetY - geometry.dataOrigin.y + scrollY) / cellHeight);
const cell = layout.cellMap.get(`${x},${y}`);
```

- Header hits: walk `layout.axes[row|col].header` together with
  `geometry.rowHeaderRect / colHeaderRect`.
- Drill-down: filter detail rows with `cell.members`, then re-run `aggregate()` +
  `layoutPivot()`.
- Export: layout and geometry are pure data, so the same code can redraw a
  high-resolution image on an offscreen canvas.

## Accessibility and text

Canvas content is invisible to assistive technology. Production use should also provide
a semantic table (possibly visually hidden) or an `aria-label` summary, and maintain
keyboard focus and an active cell. The current renderer only clips text; numeric color
scales and contrast-aware text colors come from the heatmap feature, and the core is
unaware of color encoding.

## Current limitations

- Each axis supports exactly one hierarchy chain; headers are a regular nested
  structure.
- The core has no built-in scrollbars; `src/features/scrollbar.mjs` overlays them after
  core drawing, and the example updates `scrollX / scrollY` from scrollbars, the wheel,
  and dragging.
- There is no automatic column-width fitting; column width is set uniformly by
  `cellSize.width`.
- `cellStyle` / `formatValue` are synchronous per-cell callbacks; keep them lightweight
  on large tables.
- Compact mode has no global fixed matrix, but rendering depends only on header
  `offset / size`, so both layouts share the same renderer.
- Collapse supports compact mode only; cartesian's global member padding conflicts with
  collapse semantics.

## Verification

```bash
node --test test/model/*.test.mjs test/render/*.test.mjs \
  test/features/*.test.mjs test/site/*.test.mjs test/architecture.test.mjs
```

Render tests use a call-recording fake 2D context and cover:

- draw counts for data cells, headers, and grid lines;
- `drawnCells` and text after viewport clipping;
- a 150 × 150 grid drawing only visible cells;
- custom `formatValue` / `cellStyle`;
- DPR-based physical sizing when a canvas is passed.

Heatmap colors, light/dark text, and per-measure ranges are covered by
`test/features/heatmap.test.mjs`. Scrollbar geometry, thumb mapping, hit testing,
hover / active drawing, opacity, and the auto-hide state machine are covered by
`test/features/scrollbar.test.mjs`. Predicate matching, visible-range clipping, and
styling for the custom feature example are covered by
`test/features/cell-marker.test.mjs`; collapse data rollup, header hits, and indicators
are covered by `test/features/collapse.test.mjs`. See
[custom-features.md](custom-features.md) for mount-point documentation.
