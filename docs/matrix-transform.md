[English](matrix-transform.md) · [简体中文](matrix-transform.zh-CN.md)

# Matrix transform: multidimensional data to plane coordinates

This document describes how `layoutPivot()` encodes multidimensional data — with one
record per dimension combination — into two-dimensional integer grid coordinates.
Aggregation (`aggregate()`) is out of scope here: the layout layer performs no
`sum / avg / count`, only member indexing, matrix transformation, and coordinate
computation.

## 1. Input and output

Input:

- `rows`: the aggregated record array, with each dimension combination appearing once.
- `dimensions`: `{ key, axis: 'row' | 'col', parent?, order?, compare? }[]`.
- `value`: the measure field name; the layout layer reads cell values only from this field.
- `mode`: `cartesian` (default) or `compact`.
- `duplicate`: duplicate-record policy, defaulting to `'error'`.

Output:

- `size`: `{ rows, cols }`, the grid dimensions.
- `matrix`: the `2 × (D + 1)` affine matrix; only populated in cartesian mode.
- `dimensionVectors`: one column per dimension, so the render layer can use each dimension directly.
- `cells`: the cells that actually exist, `{ x, y, value, members, record }`.
- `points`: each aggregated record's coordinates, members, indices, and per-attribute transforms.
- `axes.row` / `axes.col`: recursive headers whose members carry absolute `offset` and `size`.

## 2. Notation

- `D`: the number of dimensions.
- `d`: the dimension index, starting at 0 in `dimensions` input order.
- `n_d`: the number of members in dimension `d`.
- `i_d`: the member index of a record on dimension `d`, starting at 0.
- `span_d`: how many cells dimension `d` advances on its axis for each member step.
- `v`: the augmented vector `[i_1, i_2, ..., i_D, 1]^T`.
- `M`: the `2 × (D + 1)` matrix.
- `(x, y)`: column and row coordinates; `x` grows to the right, `y` grows downward.

Coordinate convention: `x` maps to the column axis, `y` maps to the row axis. An axis
with no dimensions has length 1.

## 3. Member indexing

The layout layer first collects every value that appears for each dimension, generates
a stable key with `valueKey()`, and then sorts the members:

1. An explicit `compare(a, b)` takes priority.
2. `order: 'asc' | 'desc'` compares numbers, dates, or strings.
3. The default is `first-seen`, in order of first appearance.

The sorted position becomes the member index `i_d`. `valueKey()` must use the same
rules in the aggregation layer and the layout layer; otherwise the same value may be
treated as two distinct members.

When the same dimension combination appears more than once, the default behavior is
to throw and point the caller to `aggregate()`. The layout layer never aggregates
implicitly, and it never silently overwrites duplicates.

## 4. Hierarchy and span

Each axis supports exactly one hierarchy chain: one root dimension, with at most one
child per dimension. Parent and child dimensions must be on the same axis.

A leaf dimension has no children, so each member occupies one cell:

```
span_leaf = 1
```

A parent dimension's span is the product of all descendant member counts:

```
span_d = Π (n_c)   c is a descendant of d
```

Equivalently, recursively:

```
span_parent = n_child × span_child
```

Intuition: each parent member step crosses an entire child block; the child is then
positioned within the block carved out by its parent. A parent column is therefore
always an integer multiple of a child column.

> Here `n_child` is the total member count of the child dimension. In cartesian mode
> every parent block is padded with the same child members, so `span` does not depend
> on a specific parent member.

## 5. Augmented vector and matrix

A record becomes an augmented vector:

```
v = [i_1, i_2, ..., i_D, 1]^T
[x, y]^T = M · v
```

`M` has `D + 1` columns:

- Column `d`: `span_d × u_d`, where `u_d` is the unit vector of the dimension's axis.
  - Row axis: `u_d = (0, 1)^T`, so the column vector is `(0, span_d)`.
  - Column axis: `u_d = (1, 0)^T`, so the column vector is `(span_d, 0)`.
- The last column: the translation `(x0, y0)^T`. The current implementation starts all
  coordinates at 0, so `x0 = y0 = 0`.

Expanded:

```
x = Σ_{d ∈ column axis} span_d · i_d + x0
y = Σ_{d ∈ row axis} span_d · i_d + y0
```

Because each dimension affects only one axis, every column of `M` except the last has
exactly one nonzero entry. Matrix columns follow the `dimensions` input order, and the
`d`-th component of the record vector must use the same `i_d`.

## 6. Example

Configuration:

```js
const dimensions = [
  { key: 'region', axis: 'row' },
  { key: 'city', axis: 'row', parent: 'region' },
  { key: 'year', axis: 'col', order: 'asc' },
];
```

`city` has 3 members and `year` has 2 members. Spans:

```
span_city   = 1
span_region = n_city × span_city = 3
span_year   = 1
```

Matrix:

```
        [region] [city] [year] [1]
x  =  [   0       0      1     0 ] · v
y  =  [   3       1      0     0 ] · v
```

Verify:

- `east / hangzhou / 2023`: `v = [0, 0, 0, 1]^T`, coordinates `(0, 0)`.
- `east / hangzhou / 2024`: `v = [0, 0, 1, 1]^T`, coordinates `(1, 0)`.
- `east / shanghai / 2023`: `v = [0, 1, 0, 1]^T`, coordinates `(0, 1)`.
- `west / chengdu / 2023`: `v = [1, 0, 0, 1]^T`, coordinates `(0, 5)`.

Each `region` step crosses 3 rows, and each `city` step crosses 1 row. The whole tree
is equivalent to mixed-radix decoding: `region` is the high-order digit, `city` is
the low-order digit, and the row coordinate is `region × 3 + city`.

## 7. Cartesian mode

- Every parent member is padded with all members of its child dimension, even when some
  combinations never appear in the data.
- Every parent block has the same size, so a single global matrix `M` exists.
- `span_d` does not depend on a specific parent member, and matrix columns stay strictly
  proportional.
- `cells` contains only records that actually appear; `size` describes the full padded
  grid. The render layer uses `size` and `cells` to identify empty cells.
- The member index `i_d` is a global member index. Since every parent block is padded
  with the same child members, `i_d × span_d` equals the accumulated offset of that
  dimension within the parent block, so the index vector can be multiplied directly.

## 8. Compact mode

- Only member combinations that actually appear in the data are laid out, so parent
  blocks can have different sizes.
- No global fixed matrix exists, and `matrix` is `null`.
- Each record's `points[].transforms` provides its per-attribute translation:

```js
{
  key: 'city',
  axis: 'row',
  memberOffset: 1,      // relative offset of the member within its parent block
  vector: [0, 1],       // (0, offset) on the row axis, (offset, 0) on the column axis
}
```

- A record's coordinates are the sum of all `transforms[].vector` entries, starting
  from 0 at the root block.
- Compact mode can be seen as a per-record piecewise translation: each record carries
  its own translation instead of sharing one `M`.
- `axes.*.header` still provides each member's absolute `offset` and `size`, but child
  members under different parent blocks no longer follow a uniform ratio.

## 9. Relationship between headers and the matrix

`axes.row.header` and `axes.col.header` are recursive structures:

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

- `offset`: the member's absolute starting cell along the axis, starting at 0.
- `size`: the number of cells the member spans.
- A child member's `offset` is accumulated relative to its parent block's start, so it
  can be used directly for `rowspan` / `colspan` rendering.
- `matrix` describes "record → coordinates"; `header` describes "member → interval".
  Both must use the same `span` values, or headers and cells will be misaligned.

## 10. Complexity

Let `m` be the number of aggregated records, `D` the number of dimensions, and `C` the
number of actual cells.

- Member collection: one scan of the aggregated data per dimension, about `O(m × D)`.
- Hierarchy tree construction: each level processes its own record subset, about
  `O(m × D)`; cartesian padding adds nodes but not records.
- Record location and cell generation: about `O(m × D)`.
- Space: aggregated results, hierarchy trees, `cells`, `points`, and header nodes, about
  `O(m × D + C)`.
- The matrix itself occupies only `O(D)`.

Compact mode avoids padded empty cells, but `points` and `transforms` still grow with
the record count. The real bottleneck is usually the detail row count `N`; aggregating
first reduces `N` to `m`, so the layout stage only processes aggregated results. This
is the recommended two-stage pipeline.

## 11. Constraints and boundaries

- Exactly one chain per axis: a single root, with at most one child dimension per
  parent. Multiple roots, multiple children, cycles, and cross-axis parent-child
  relationships all throw explicit errors.
- `dimensions` is required; every dimension must specify `axis: 'row' | 'col'`.
  Parent-child relationships are declared with `parent`; root dimensions omit it.
- `value` is required; the layout layer reads only that field and never aggregates.
- Duplicate dimension combinations throw by default; `duplicate: 'first' | 'last'` can
  be set explicitly, but calling `aggregate()` first is recommended.
- Output consists of integer grid coordinates and 2D vectors. Pixel conversion belongs
  to the render layer's `computePivotGeometry()`; `result.toPixel({ width, height })`
  remains as a simple equidistant conversion helper.
- The current translation is 0. Supporting a custom origin in the future requires
  changing only the last column of `M`, with no impact on the `span` structure.

## 12. Implementation map

- `src/model/aggregate.mjs`: the aggregation layer, which reduces detail rows to one
  record per dimension combination.
- `src/model/pivot-layout.mjs`:
  - `normalizeDimensions` / `buildChain`: dimension validation and single-chain checks.
  - `collectMembers`: member collection, stable keys, and sorting.
  - `buildLevel`: recursive hierarchy-tree construction, computing each member's `size`
    and `offset`.
  - `locate`: record → hierarchy path and absolute coordinates.
  - The `spans` Map and `matrix` construction inside `layoutPivot`: the global matrix.
  - `axisResult` / `headerOf`: recursive headers.
  - `toPixel`: a simple helper from grid coordinates to pixel coordinates.
- `src/render/geometry.mjs`: screen rectangles, visible ranges, frozen headers, and clip
  regions.
- `src/render/canvas-renderer.mjs`: Canvas 2D drawing, iterating only over cells inside
  the viewport.
