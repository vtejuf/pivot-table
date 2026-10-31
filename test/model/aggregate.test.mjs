import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from '../../src/model/aggregate.mjs';

const dimensions = [
  { key: 'region', axis: 'row' },
  { key: 'year', axis: 'col' },
];

test('默认 count：按维度组合分组并带保留字段', () => {
  const cube = aggregate(
    [
      { region: 'east', year: 2023 },
      { region: 'east', year: 2023 },
      { region: 'west', year: 2023 },
    ],
    { dimensions },
  );

  assert.equal(cube.rows.length, 2);
  assert.deepEqual(cube.rows[0], {
    region: 'east',
    year: 2023,
    __count: 2,
    __valueCount: 2,
  });
  assert.equal(cube.rows[1].__count, 1);
  assert.deepEqual(cube.measure, { key: '__count', aggregate: 'count' });
  assert.deepEqual(cube.dimensions, dimensions);
});

test('sum / avg / min / max 只统计有限数值', () => {
  const rows = [
    { region: 'east', year: 2023, sales: 10 },
    { region: 'east', year: 2023, sales: 20 },
    { region: 'east', year: 2023, sales: null },
    { region: 'east', year: 2023, sales: Number.NaN },
    { region: 'east', year: 2023, sales: Infinity },
    { region: 'east', year: 2023, sales: '30' },
  ];

  const run = (kind) =>
    aggregate(rows, {
      dimensions,
      measure: { key: 'sales', aggregate: kind },
    }).rows[0];

  const sum = run('sum');
  assert.equal(sum.sales, 30);
  assert.equal(sum.__count, 6);
  assert.equal(sum.__valueCount, 2);

  assert.equal(run('avg').sales, 15);
  assert.equal(run('min').sales, 10);
  assert.equal(run('max').sales, 20);
});

test('没有有效数值时：sum 为 0，avg/min/max 为 null', () => {
  const rows = [{ region: 'east', year: 2023, sales: null }];

  const run = (kind) =>
    aggregate(rows, {
      dimensions,
      measure: { key: 'sales', aggregate: kind },
    }).rows[0];

  assert.equal(run('sum').sales, 0);
  assert.equal(run('avg').sales, null);
  assert.equal(run('min').sales, null);
  assert.equal(run('max').sales, null);
  assert.equal(run('avg').__valueCount, 0);
});

test('非法配置会显式报错', () => {
  assert.throws(() => aggregate([{ a: 1 }]), /dimensions 必填/);
  assert.throws(
    () =>
      aggregate([{ a: 1 }], {
        dimensions: [
          { key: 'a', axis: 'row' },
          { key: 'a', axis: 'col' },
        ],
      }),
    /维度 key 重复/,
  );
  assert.throws(
    () =>
      aggregate([{ a: 1 }], {
        dimensions: [{ key: '__count', axis: 'row' }],
      }),
    /保留字段/,
  );
  assert.throws(
    () =>
      aggregate([{ a: 1, sales: 1 }], {
        dimensions: [{ key: 'a', axis: 'row' }],
        measure: { aggregate: 'sum' },
      }),
    /必须提供非空字符串 measure.key/,
  );
  assert.throws(
    () =>
      aggregate([{ a: 1 }], {
        dimensions: [{ key: 'a', axis: 'row' }],
        measure: { key: 'a', aggregate: 'sum' },
      }),
    /与维度 key 冲突/,
  );
  assert.throws(
    () =>
      aggregate([{ a: 1 }], {
        dimensions: [{ key: 'a', axis: 'row' }],
        measure: { key: 'x', aggregate: 'median' },
      }),
    /不支持的聚合方式/,
  );
});
