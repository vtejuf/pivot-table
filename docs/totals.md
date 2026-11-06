[English](totals.md) · [简体中文](totals.zh-CN.md)

# Row/column subtotals and grand totals (design note)

- **Status**: Row/column subtotals, row/column grand totals, two-axis intersections,
  and multi-measure splitting are implemented. Collapse integration (single and
  multiple measures) is implemented as well: collapsed parents skip subtotals while
  grand totals are preserved. True cross-level single-cell merging and header styling
  remain future work.
- **Date**: 2026-11-02
- **Principle**: The core `aggregate` / `layoutPivot` / `renderPivot` are frozen; this
  follows route B (display-layout derivation), separating aggregation from layout
  insertion.

## 1. Data flow

```
detail rows
  └─ aggregate()                 core: finest-grained cube
      ├─ rollupTotals()          feature: single-measure rollup
      │   (or rollupMultiTotals() for multi-measure columns)
      └─ layoutPivot()           core: base layout
          └─ withTotals()        feature: insert row/column totals and fill intersections
              └─ renderPivot()
```

`rollupTotals()` reads only the cube, never the layout; `rollupMultiTotals()` calls
`rollupTotals()` per measure and then appends the measure label to the column path;
`withTotals()` reads only the layout and the rollup result, and performs no further
aggregation. The row-axis compatibility entry points `rollupRowTotals()` /
`withRowTotals()` are still available and handle only the row axis internally.

## 2. Configuration

```js
const config = {
  rows: {
    subtotals: ['region'], // row subtotals only for region; leaf dimensions are ignored
    grandTotal: true,      // one "Grand total" row at the end
  },
  cols: {
    subtotals: ['year'],   // column subtotals only for year; leaf dimensions are ignored
    grandTotal: true,      // one "Grand total" column at the end
  },
};
```

- Every key in `subtotals` must belong to the corresponding axis's hierarchy chain,
  otherwise an error is thrown.
- Leaf dimensions are ignored silently, so no duplicate "self subtotal" is generated.
- Row/column subtotals and grand totals are fixed at the end in this first version.
- The four Demo switches only translate DOM state into the configuration above; the
  feature never reads the DOM.
- When everything is disabled, `rollupTotals()` returns `skipped: true` immediately
  without scanning the cube, and `withTotals()` returns the input layout unchanged.

Multi-measure entry point:

```js
const rolled = rollupMultiTotals(
  [
    { label: 'Sales', cube: salesCube },
    { label: 'Orders', cube: countCube },
  ],
  {
    rows: { subtotals: ['region'], grandTotal: true },
    cols: { subtotals: ['year'], grandTotal: true },
    measureKey: dualCube.measureKey, // 'measure'
    valueKey: dualCube.value,        // 'value'
  },
);
```

Column subtotals/totals are split by measure. Default labels are Chinese
(`'{value} 小计'` and `'总计'`); pass `labels` to
`withTotals(layout, rolled, { labels: { subtotal: '{value} subtotal', total: 'Grand total' } })`
to localize them. Different measures are never added together. A row total row covers
all measure columns.

## 3. Rollup

Each dimension-value sequence generates three kinds of paths:

- `base`: the full row/column combination;
- `subtotal`: the prefix from the row/column chain root to the configured dimension;
- `total`: the empty path.

Each detail row is accumulated into every row path × column path combination it
belongs to; `base × base` is already provided by the base layout's `cells` and does not
enter the rollup table. Output:

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

Keys use a stable encoding of dimension values:

```js
pathKey(values) === JSON.stringify(values.map(valueKey))
```

`valueKey` is shared with core aggregation/layout, avoiding collisions such as `'1'`
versus `1` or `null`.

Built-in reducers match core `aggregate` semantics:

- `sum`: adds finite numbers; returns 0 when no valid values exist.
- `count`: adds counts.
- `avg`: `sum(value × __valueCount) / sum(__valueCount)`; averaging the averages is not
  correct.
- `min` / `max`: skip null / non-numeric values and then merge; return null when no
  valid values exist.

A custom reducer is a pure function:

```js
const reduce = (records, context) => ({
  value,
  __count,      // optional; defaults to the sum over child records
  __valueCount, // optional; defaults to the sum over child records
});
```

`context` contains:

```js
{
  measure: { key, aggregate },
  dimension: 'region' | null,     // row subtotal dimension; null for the empty path/total
  colDimension: 'year' | null,    // column subtotal dimension
  path: [{ key, value }],         // row grouping path
  columns: [{ key, value }],      // column grouping path
  rowKind: 'base' | 'subtotal' | 'total',
  colKind: 'base' | 'subtotal' | 'total',
}
```

`records` are the finest-grained aggregated records, not raw detail rows. Rules that
cannot be rolled up from aggregated values alone, such as median or distinct count, are
out of scope; they belong in the aggregation stage.

For multiple measures, `rollupMultiTotals()` rolls up each measure from its own cube,
so `avg` still has access to that measure's `__valueCount`. Do not roll up the long
table produced by `combineMeasures`, since that path loses `__count` /
`__valueCount`.

## 4. Layout derivation

- Rows and columns use in-parent-block subtotals: the parent member's `size` grows by
  the subtotal rows/columns, and the parent label covers them; child levels show
  the subtotal label (Chinese `小计` by default).
- Grand totals live at the root level; deeper levels are filled with empty placeholder
  child chains so the canvas background never shows through.
- Original cells' `x / y` shift by the number of insertions; rolled-up cells use the
  new slot coordinates.
- With multiple measures, each measure variant of a column subtotal is an independent
  slot, and the parent column block's `size` grows by the number of measures; the same
  applies to column grand totals.
- Rolled-up cells fall into three categories:
  - base row × column subtotal/total;
  - row subtotal/total × base column;
  - row subtotal/total × column subtotal/total (intersection cells).
- Rolled-up cells carry `cell.kind = 'subtotal' | 'total'`, `rowKind / colKind`,
  `rowGroup / colGroup`, and the actually matched `members`; collapsed child dimension
  values are never fabricated.
- The row/column `matrix` is set to `null`; `points` is emptied; `toPixel()` is
  reimplemented against the new cells.
- The input layout is never mutated.

Header invariants: within one axis and level, the sum of member `size` values equals the
parent member's `size`, and the root sum equals that axis's `size.rows / size.cols`;
subtotal/grand-total rows and columns have header cells at every level. A parent label
covering subtotal rows/columns is a rowspan/colspan-style cover, not a true cross-level
single-cell merge; a single label spanning multiple header levels still requires core
`depthSpan` or an overlay extension.

## 5. Boundaries

- Empty data: no totals are inserted; `withTotals()` returns the input unchanged.
- Only a row axis or only a column axis: the other axis degenerates to a single
  row/column; a pure column pivot can still receive column totals.
- Empty column axis / empty row axis: the corresponding axis's grand total is skipped
  without error.
- Subtotals configured on a leaf dimension are ignored silently.
- Both `compact` and `cartesian` are supported; the display layout no longer depends on
  a fixed matrix.
- Multiple measures go through `rollupMultiTotals()`; column totals are split by
  measure and never mixed. Use the original per-measure cubes, not the long table from
  `combineMeasures`, for rolling up.
- Collapse integration: `withTotals()`'s `shouldIncludeSubtotal` lets collapsed parents
  skip subtotals while keeping grand totals; rollup uses the collapsed cube so
  intersection cells between collapsed placeholder rows/columns have values.
  With multiple measures, each measure's cube is collapsed and rolled up separately,
  then combined.
  True single-cell cross-level merging and header styling are still unimplemented; see
  [custom-features.md](custom-features.md#collapse) for the collapse implementation.

## 6. Tests

- Rollup: row/column subtotals, grand totals, two-axis intersection values,
  multi-measure splitting by measure, ignored leaf dimensions, all-disabled short
  circuit, custom reducer `colDimension` / `rowKind` / `colKind`, weighted avg,
  min/max, and input records remaining unmodified.
- Layout: row/column slot order, parent block size including totals, three-level row
  axis placeholder chains, nested multi-level subtotals, multi-measure column slots
  expanded per measure, size invariants across both headers, intersection cells, pure
  column pivot, `cellMap`, `size`, `matrix = null`, and `toPixel()`.
- Rendering: subtotal and grand-total text appears under a fake context, and the
  number of drawn cells increases.
- Site: runtime verification of the Demo's four total-switch combinations, collapse
  integration (skipping collapsed-parent subtotals), and status text.

## 7. Future work

1. Optional true cross-level header merging (core `depthSpan` or overlay).
2. Header styling (overlay or a core `headerCellStyle` extension).
3. Collapse integration (single/multiple measures) is implemented: collapsed parents
   skip subtotals, grand totals are preserved, and rollup uses the collapsed cube; the
   remaining work is collapse in cartesian mode.
