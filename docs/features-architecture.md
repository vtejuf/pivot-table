[English](features-architecture.md) · [简体中文](features-architecture.zh-CN.md)

# Feature architecture design (design note)

- **Status**: Design note. Dual measures, heatmaps, the custom overlay rendering
  example, the custom feature example (cell-marker), row/column subtotals/grand totals
  (including two-axis intersections and multi-measure splitting), floating scrollbars,
  and expand/collapse (compact; compatible with row/column totals and dual measures) are
  implemented. The old core heatmap has been removed. Cross-level single-cell merging
  and collapse in cartesian mode are still unimplemented.
- **Date**: 2026-11-02
- **Scope**: Dual measures, heatmaps, subtotals/grand totals, expand/collapse, and
  future add-on capabilities built on the core.
- **Core principle**: The core algorithms are frozen; add-on features only compose,
  derive, and adapt.

## 1. Goals

Add product-level capabilities to the pivot table without modifying core algorithms:

- subtotals / grand totals
- expand / collapse
- future sorting, merging, export, interaction decorations, and so on

These capabilities should be reusable by `site/`, `examples/`, or future consumers
rather than being hard-wired into the demo page.

## 2. Core boundaries

### 2.1 Frozen content

The algorithms, function signatures, default behavior, and output structures of these
modules stay stable:

- `src/model/aggregate.mjs`
- `src/model/pivot-layout.mjs`
- `src/model/value-key.mjs`
- `src/render/geometry.mjs`
- `src/render/canvas-renderer.mjs`
- `src/render/theme.mjs`

The core entry points `src/model/index.mjs` and `src/render/index.mjs` know nothing
about add-on features.

> Exception: on 2026-10-31, with explicit approval, the core `heatmap` option, theme
> palettes, and related tests were removed, and heatmaps moved entirely into
> `src/features/heatmap.mjs`. The core matrix/geometry and remaining render behavior
> are unchanged, and the freeze rules continue to apply.

### 2.2 Allowed changes

- Add independent feature modules, entry points, tests, and documentation.
- Add controls, state, and feature orchestration in the site layer.
- If existing core capabilities are genuinely insufficient, propose a
  backward-compatible extension first, describe the impact, and wait for confirmation;
  do not change the core by default.
- Never change core default output to make a feature pass.

## 3. Directory plan

Dual measures, heatmaps, the custom overlay rendering example, row/column
subtotals/grand totals, and floating scrollbars are implemented; other directories are
created when the corresponding feature lands:

```
src/
  model/         core: aggregation, matrix layout (frozen)
  render/        core: geometry, Canvas, theme (frozen)
  features/      add-on business capabilities
    dual-measure.mjs  implemented: dual-measure layout
    heatmap.mjs       implemented: heatmap rendering
    cell-marker.mjs   implemented: custom feature example (cellStyle + overlay)
    collapse.mjs      implemented: expand / collapse (compact; works with totals/dual measures)
    overlay.mjs       implemented: custom overlay rendering (corner example)
    scrollbar.mjs     implemented: floating scrollbars (draw + hit test + drag conversion)
    totals.mjs        implemented: row/column subtotals/grand totals (including two-axis intersections)
    index.mjs         optional: unified feature entry point (not created yet)
test/
  features/
    dual-measure.test.mjs  implemented
    heatmap.test.mjs       implemented
    cell-marker.test.mjs   implemented
    collapse.test.mjs      implemented
    overlay.test.mjs       implemented
    scrollbar.test.mjs     implemented
    totals.test.mjs        implemented
  site/
    code-examples.test.mjs implemented
  architecture.test.mjs    implemented: dependency-direction guard
```

File names stay flat for now; when a single feature grows large, split it into
subdirectories such as `features/subtotals/`.

## 3.1 Implemented: dual measures

`src/features/dual-measure.mjs` expands multiple aggregate results into a long table,
treats "measure" as the last column-axis dimension, and hands the result to core
`layoutPivot`.

- Input: `dimensions` + `measures: [{ label, rows, valueField }]`;
- Output: long-table `rows`, `dimensions` with the measure dimension appended, and the
  `value` field name;
- Core matrix, headers, `cellMap`, and the renderer are unchanged;
- Dual measures handle layout only; heatmaps are computed per measure by a separate
  feature;
- The old core heatmap has been removed, and all heatmap logic lives in
  `src/features/heatmap.mjs`;
- Architecture guard tests ensure `src/model` / `src/render` never depend on
  `features`.

## 3.2 Implemented: heatmap feature

`src/features/heatmap.mjs` renders through the core's existing `cellStyle` callback and
does not modify the core renderer's drawing path.

- Single-measure layout: all values share one min/max;
- Dual-measure layout: min/max and color scales are computed separately per `measure`
  dimension without interference;
- Empty / non-numeric cells return `undefined`, falling back to core default styling;
- The Demo uses the feature through `cellStyle`; the core renderer no longer contains a
  heatmap option;
- The core keeps only general extension points such as `cellStyle` / `formatValue`.

## 3.3 Implemented: custom overlay rendering (example)

`src/features/overlay.mjs` hands the same 2D context to the caller's `draw` callback
after core `renderPivot` finishes, for badges, reference lines, icons, selection
outlines, and similar decorations.

- `renderWithOverlay(target, layout, options, draw)`: general entry point; core first,
  custom drawing after;
- `createCornerLabels(options)`: built-in example that draws row/column dimension names
  in the frozen corner area;
- Core geometry, draw order, and default output are unchanged, and overlays always sit
  on top;
- `draw` uses the same CSS pixel coordinate system as the core; the DPR transform is
  already handled by the core;
- The example skips an empty corner (pure row / pure column pivot) and truncates with an
  ellipsis when too narrow;
- The feature only reads `layout` / `geometry` and never mutates core objects;
- The Demo wires it through the `[data-demo-overlay]` switch; when off, core
  `renderPivot` is used directly.

## 3.4 Implemented: row/column subtotals and grand totals (with two-axis intersections)

`src/features/totals.mjs` works in two steps, and core `aggregate` / `layoutPivot` /
`renderPivot` are unchanged:

- `rollupTotals(cube, config)`: reads the core aggregation result, rolls up uniformly
  according to `rows` / `cols`, and outputs an independent row × column rollup cube; it
  generates no layout rows and does not modify the cube.
- `rollupMultiTotals(measures, config)`: rolls up each measure separately, appends the
  measure label to the column path, splits column subtotals/totals by measure, and never
  adds different measures together.
- `withTotals(layout, rolled, options)`: route B, inserting row/column subtotals and
  grand totals into the base layout at once and rebuilding both header blocks, `cells`,
  `cellMap`, and `size`; sets `matrix` to `null`.
- Rows and columns both use in-parent-block subtotals: the parent `size` covers the
  subtotal rows/columns, child levels show the subtotal label (Chinese `小计` by
  default), and deeper levels of grand-total
  rows are filled with empty placeholder child chains.
- Supports row subtotal × column subtotal, row subtotal × column total, row total ×
  column subtotal, and the global total at the bottom right.
- Built-in rollup rules: `sum / count / avg / min / max`; `avg` is weighted by
  `__valueCount`; a pure `reduce(records, context)` function can override them.
- Switches are translated into configuration at the site layer; when all are off,
  `skipped: true` and the layout layer returns the input unchanged.
- With multiple measures, column subtotals/totals are split by measure, and row total
  rows cover all measure columns.
- Collapse integration: collapsed parents skip subtotals while grand totals are
  preserved; see 3.7.
- True cross-level single-cell merging and header styling remain future work.
- The row-axis compatibility entry points `rollupRowTotals()` / `withRowTotals()` are
  still available.
- See `docs/totals.md` for the design and boundaries.

## 3.5 Implemented: floating scrollbars

`src/features/scrollbar.mjs` overlays scrollbars after core drawing without modifying
core geometry or layout:

- `computeScrollbarGeometry(geometry, options)`: computes both tracks and thumbs from
  the core `viewport / dataOrigin / dataSize / dataViewport`;
- `hitTestScrollbars(bars, x, y)`: distinguishes thumb / track and returns `null`
  outside the track;
- `scrollFromThumbPosition(bar, pointer, grabOffset)`: converts a pointer position back
  into a scroll offset;
- `drawScrollbars(ctx, geometry, options, state)`: draws tracks and thumbs, supports
  hover / active colors and `opacity` fading;
- `createScrollbarOverlay(options)`: wraps this as an overlay draw function and caches
  the latest geometry for site-layer hit testing;
- `createScrollbarAutoHide({ delay, fadeDuration })`: a pure time state machine exposing
  `show()` / `setPinned()` / `opacity()` / `isActive()`, with no DOM dependency;
- Tracks start at the data-area origin, avoiding frozen headers; the bottom-right corner
  is left empty when both axes can scroll; scrollbars hide automatically when content
  fits within one viewport;
- Enabled by default in the Demo; they appear after scrolling / dragging, fade about
  900ms after the last operation, and stay visible while hovering or dragging a
  scrollbar; hidden bars remain hittable for hover wake-up, but pointerdown only drags
  them when opacity is greater than 0.05;
- In the Demo, pointer hits on scrollbars take priority; otherwise canvas panning
  continues.

## 3.6 Implemented: custom feature example (cell-marker)

`src/features/cell-marker.mjs` is the smallest complete example of writing a custom
feature:

- `createCellMarker(layout, { test, ... })` returns `cellStyle` and `draw`;
- `cellStyle` returns background / text colors for cells matching the predicate;
- `draw` adds a top-right marker after `renderWithOverlay`, iterating only over
  `geometry.visible` and clipping with `dataClip`;
- The Demo wires it through the "High-value markers" switch, using the 80th percentile
  of the current layout's values as the threshold;
- The "Custom feature" card under `#quickstart` links to documentation for data
  derivation, layout derivation, render configuration, overlay, and interaction mount
  points;
- See [custom-features.md](custom-features.md) for the complete guide.

## 3.7 Implemented: expand / collapse (compact; works with totals and dual measures)

`src/features/collapse.mjs` derives collapsed data after aggregate; core layout and
rendering are unchanged:

- `collapseCube(cube, collapsed)`: finds the first collapsed parent member by
  `collapseKey(axis, dimension, value)`, replaces its child dimension with `（全部）`,
  and re-rolls up per measure; avg is weighted by `__valueCount`;
- `hitTestHeader(layout, geometry, point, { canCollapse })`: hits row / column parent
  headers and returns `axis / dimension / value / key`;
- `drawCollapseIndicators(ctx, { layout, geometry, collapsed, canCollapse })`: draws
  + / − to the right of parent headers; with multiple measures it masks `measure` and
  its direct parent dimension;
- Turning on "Collapse mode" in the Demo lets parent-header clicks toggle collapse;
  turning it off clears state and restores the full layout;
- It currently supports compact mode only; it can be combined with row/column totals and
  dual measures, with collapsed parents skipping subtotals while grand totals are
  preserved; with multiple measures, collapse each measure's cube separately before
  `combineMeasures`; `measure` and its direct parent dimension do not take part in
  collapse and are filtered with `canCollapse`; cartesian mode is not stacked yet;
- Tests live in `test/features/collapse.test.mjs`; see
  [custom-features.md](custom-features.md#collapse) for the complete mount-point guide.

## 4. Dependency rules

```
site / examples / bench
          ↓
       features
          ↓
    model / render        (core)
```

- `features` may import the core.
- `model` and `render` must not import `features`.
- `site` only handles UI binding and feature orchestration; it does not own reusable
  business algorithms.
- `features/index.mjs` only exports feature APIs and does not change core entry points.
- Optionally add `test/architecture.test.mjs` to statically scan imports in
  `src/model` and `src/render` and fail on reverse dependencies. Boundaries are kept by
  tests, not by verbal agreement.

## 5. How features plug in

### 5.1 Subtotals / grand totals

Preferred approach:

1. The feature layer reads core aggregation and layout results, consuming them read-only.
2. Build a feature-owned "display layout": insert total rows/columns into the base
   layout, and recompute headers, `size`, `cells`, `cellMap`, and other display
   structures.
3. Core layout objects are not mutated; core `layoutPivot` does not grow total logic.
4. The render layer receives only layout objects produced by the feature that satisfy
   the existing contract.

Alternative approach:

- Wrap the aggregated data and call core `layoutPivot` again.
- Only use it when it introduces no core changes and headers and coordinates are
  strictly correct; otherwise return to display-layout derivation.

Before implementing this feature, design and verify separately:

- the `offset / size` relationship between total rows/columns and original rows/columns;
- total placement under grouped parent-child hierarchies;
- hit testing and render decoration for total cells;
- boundaries such as empty data, a single member, and compact layouts.

Both row and column axes are implemented this way (see 3.4): `rollupTotals()` only reads
the cube to roll up, `withTotals()` only reads the layout to derive the display layout,
and rollup rules can be configured as pure functions.

### 5.2 Expand / collapse

- The feature layer maintains the set of collapsed paths and UI state.
- Collapsed visible data is obtained by filtering or rolling up; the feature may call
  core `layoutPivot` again to produce a new complete layout.
- The core always lays out the data it is given and knows nothing about "collapse".
- Expanding restores filtered members and re-runs layout.
- Collapse icons, hit areas, and state changes belong to the feature / render decoration
  layer and never enter the core renderer.

### 5.3 Render decoration

Prefer reusing existing core extension points:

- `formatValue`: total values, empty values, special text;
- `cellStyle`: total backgrounds, emphasized text, zebra-stripe overrides;
- Core `geometry`: computing positions for icons, separators, and hit areas.

If these are insufficient:

- The feature provides its own Canvas decoration function, overlaid after core
  `renderPivot`;
- Or the feature wraps a render coordinator, while core renderer default behavior stays
  unchanged.

Never change `renderPivot`'s default draw order or core geometry algorithms to
accommodate a feature.

### 5.4 Site integration

- `site/demo.mjs` connects feature state, controls, and rendering.
- When the page gains a switch, only add the control and its state binding.
- Both core and features can be tested independently of the site.

## 6. Testing strategy

- Core tests stay as they are; features must not require changes to core assertions.
- Each feature has independent tests under `test/features/`.
- Feature tests cover:
  - data/layout derivation results;
  - coordinates, headers, and cells after combining with the core layout;
  - collapse/expand state toggling;
  - render callbacks and decoration calls.
- Run core and feature tests together on every change.
- Optional architecture guard tests:
  - core directories must not contain reverse imports of `features/`;
  - feature entry points must not modify core exports.

## 7. Naming and evolution

- The name `features` expresses pivot-table product capabilities, not a third-party
  plugin mechanism.
- If third-party registration, lifecycles, or dynamic loading are needed later,
  introduce a separate `extensions/` or `plugins/`; do not build the framework now.
- Shared utilities inside features go under `features/internal/` and do not flow back
  into the core.
- Core API version changes and feature iteration stay decoupled.

## 8. Non-goals

Still excluded:

- true cross-level single-cell merging;
- modifying core matrix / geometry algorithms or default rendering behavior;
- introducing a plugin registry, event bus, or new runtime dependencies.

Subtotals / grand totals and expand / collapse have landed in later iterations; see
3.4 / 3.7.

## 9. Future landing order

1. Basic subtotals / grand totals and expand / collapse are implemented, with controls
   and state wired into `site/`.
2. Extend collapse: cartesian mode.
3. True cross-level single-cell merging.
4. Continue filling in documentation, example entry points, and architecture guard
   tests.

## 10. Review checklist

- [ ] No diff in core directories.
- [ ] `src/model` and `src/render` do not import `features`.
- [ ] Without feature arguments, core default behavior matches the present behavior.
- [ ] Features are implemented by composing core output, not by copying core matrix
      algorithms.
- [ ] Features do not mutate core `cells`, `axes`, or `cellMap` in place.
- [ ] Core tests and feature tests pass together.
- [ ] The site layer only handles UI binding and owns no business algorithms.
