/**
 * 校验分片聚合与单次 aggregate 的结果一致。
 * 分片只用于内存受限场景；这里用 20 万条明细逐组对比。
 *
 * 运行：node bench/verify.mjs
 */

import assert from 'node:assert/strict';
import { aggregate } from '../src/model/aggregate.mjs';
import { layoutPivot } from '../src/model/pivot-layout.mjs';
import { dimensions, measure } from './config.mjs';
import { createChunk, mergePartialRows } from './generate.mjs';

const ROWS = 200_000;
const CHUNK_SIZE = 50_000;

const singleCube = aggregate(createChunk(0, ROWS), { dimensions, measure });

const groups = new Map();
for (let offset = 0; offset < ROWS; offset += CHUNK_SIZE) {
  const count = Math.min(CHUNK_SIZE, ROWS - offset);
  const partial = aggregate(createChunk(offset, count), {
    dimensions,
    measure,
  });
  mergePartialRows(groups, partial.rows);
}
const chunkedRows = [...groups.values()];

const rowKey = (row) => `${row.region}|${row.city}|${row.year}|${row.product}`;
const singleRows = new Map(singleCube.rows.map((row) => [rowKey(row), row]));

assert.equal(chunkedRows.length, singleCube.rows.length);
for (const row of chunkedRows) {
  const expected = singleRows.get(rowKey(row));
  assert.ok(expected, `缺少分组 ${rowKey(row)}`);
  assert.equal(row.sales, expected.sales, `sales 不一致: ${rowKey(row)}`);
  assert.equal(row.__count, expected.__count, `__count 不一致: ${rowKey(row)}`);
  assert.equal(
    row.__valueCount,
    expected.__valueCount,
    `__valueCount 不一致: ${rowKey(row)}`,
  );
}

const singleLayout = layoutPivot(singleCube.rows, {
  dimensions,
  value: measure.key,
});
const chunkedLayout = layoutPivot(chunkedRows, {
  dimensions,
  value: measure.key,
});

assert.deepEqual(chunkedLayout.size, singleLayout.size);
assert.deepEqual(chunkedLayout.matrix, singleLayout.matrix);

const cellKey = (cell) => `${cell.x},${cell.y}`;
const singleCells = new Map(
  singleLayout.cells.map((cell) => [cellKey(cell), cell]),
);
for (const cell of chunkedLayout.cells) {
  const expected = singleCells.get(cellKey(cell));
  assert.ok(expected, `缺少单元格 (${cellKey(cell)})`);
  assert.equal(cell.value, expected.value, `单元格值不一致: ${cellKey(cell)}`);
  assert.deepEqual(cell.members, expected.members);
}

console.log(
  `PASS: ${ROWS.toLocaleString('en-US')} 条明细，分片聚合（${CHUNK_SIZE.toLocaleString('en-US')}/片）与单次结果一致`,
);
console.log(
  `聚合行数 ${singleCube.rows.length}，网格 ${singleLayout.size.rows}×${singleLayout.size.cols}`,
);
