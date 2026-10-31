import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from '../../src/model/aggregate.mjs';
import { layoutPivot } from '../../src/model/pivot-layout.mjs';

const rows = [
  { region: 'east', city: 'hangzhou', year: 2023, sales: 10 },
  { region: 'east', city: 'hangzhou', year: 2024, sales: 20 },
  { region: 'east', city: 'shanghai', year: 2023, sales: 30 },
  { region: 'west', city: 'chengdu', year: 2023, sales: 40 },
];

const dimensions = [
  { key: 'region', axis: 'row' },
  { key: 'city', axis: 'row', parent: 'region' },
  { key: 'year', axis: 'col', order: 'asc' },
];

const measure = { key: 'sales', aggregate: 'sum' };

function layout(data = rows, options = {}) {
  const cube = aggregate(data, { dimensions, measure });
  return layoutPivot(cube.rows, { dimensions, value: 'sales', ...options });
}

function cellAt(result, members) {
  return result.cells.find((cell) =>
    Object.entries(members).every(([key, value]) => cell.members[key] === value),
  );
}

test('cartesian：混合进制坐标与固定矩阵', () => {
  const result = layout();

  assert.deepEqual(result.size, { rows: 6, cols: 2 });
  assert.equal(result.mode, 'cartesian');
  assert.equal(result.value, 'sales');

  const hangzhou2023 = cellAt(result, {
    region: 'east',
    city: 'hangzhou',
    year: 2023,
  });
  const hangzhou2024 = cellAt(result, {
    region: 'east',
    city: 'hangzhou',
    year: 2024,
  });
  const shanghai2023 = cellAt(result, {
    region: 'east',
    city: 'shanghai',
    year: 2023,
  });
  const chengdu2023 = cellAt(result, {
    region: 'west',
    city: 'chengdu',
    year: 2023,
  });

  assert.deepEqual([hangzhou2023.x, hangzhou2023.y], [0, 0]);
  assert.deepEqual([hangzhou2024.x, hangzhou2024.y], [1, 0]);
  assert.deepEqual([shanghai2023.x, shanghai2023.y], [0, 1]);
  assert.deepEqual([chengdu2023.x, chengdu2023.y], [0, 5]);
  assert.equal(chengdu2023.value, 40);

  // 列顺序 = [region, city, year, 常数项]
  assert.deepEqual(result.matrix, [
    [0, 0, 1, 0],
    [3, 1, 0, 0],
  ]);
  assert.deepEqual(result.dimensionVectors, {
    region: [0, 3],
    city: [0, 1],
    year: [1, 0],
  });
});

test('cartesian：每条记录的坐标都等于矩阵乘索引向量', () => {
  const result = layout();

  for (const point of result.points) {
    const vector = result.dimensions.map((dim) => point.indexes[dim.key] ?? 0);
    vector.push(1);

    const x = result.matrix[0].reduce((sum, c, i) => sum + c * vector[i], 0);
    const y = result.matrix[1].reduce((sum, c, i) => sum + c * vector[i], 0);

    assert.equal(x, point.x, `x mismatch for ${JSON.stringify(point.members)}`);
    assert.equal(y, point.y, `y mismatch for ${JSON.stringify(point.members)}`);
  }
});

test('cartesian：父子 span 呈整数倍关系', () => {
  const result = layout();
  const regionSpan = result.dimensionVectors.region[1];
  const citySpan = result.dimensionVectors.city[1];

  assert.equal(regionSpan, 3);
  assert.equal(citySpan, 1);
  assert.equal(regionSpan, 3 * citySpan); // n_city = 3
});

test('compact：父成员块大小随实际子成员数变化', () => {
  const result = layout(rows, { mode: 'compact' });

  assert.deepEqual(result.size, { rows: 3, cols: 2 });
  assert.equal(result.matrix, null);

  assert.equal(
    cellAt(result, { region: 'east', city: 'hangzhou', year: 2023 }).y,
    0,
  );
  assert.equal(
    cellAt(result, { region: 'east', city: 'shanghai', year: 2023 }).y,
    1,
  );
  assert.equal(
    cellAt(result, { region: 'west', city: 'chengdu', year: 2023 }).y,
    2,
  );
});

test('布局层不做聚合：重复维度组合直接报错', () => {
  const duplicated = [
    ...rows,
    { region: 'east', city: 'hangzhou', year: 2023, sales: 5 },
  ];

  assert.throws(
    () => layoutPivot(duplicated, { dimensions, value: 'sales' }),
    /布局层不做聚合/,
  );

  // 聚合后同一组合只剩一行，布局正常
  const cube = aggregate(duplicated, { dimensions, measure });
  const result = layoutPivot(cube.rows, { dimensions, value: 'sales' });
  assert.equal(
    cellAt(result, { region: 'east', city: 'hangzhou', year: 2023 }).value,
    15,
  );
});

test('表头成员带绝对偏移和跨格数', () => {
  const result = layout();
  const header = result.axes.row.header;

  assert.equal(header.key, 'region');

  const east = header.members.find((member) => member.value === 'east');
  const west = header.members.find((member) => member.value === 'west');
  assert.equal(east.offset, 0);
  assert.equal(east.size, 3);
  assert.equal(west.offset, 3);
  assert.equal(west.size, 3);

  const shanghai = east.children.members.find((member) => member.value === 'shanghai');
  assert.equal(shanghai.offset, 1);
  assert.equal(shanghai.size, 1);
});

test('compact 表头只展开实际组合', () => {
  const result = layout(rows, { mode: 'compact' });
  const header = result.axes.row.header;

  const east = header.members.find((member) => member.value === 'east');
  const west = header.members.find((member) => member.value === 'west');
  assert.equal(east.size, 2);
  assert.equal(west.offset, 2);
  assert.equal(west.size, 1);
  assert.deepEqual(
    west.children.members.map((member) => member.value),
    ['chengdu'],
  );
});

test('dimensions / axis / value 必须显式提供', () => {
  assert.throws(() => layoutPivot([{ a: 1 }]), /dimensions 必填/);
  assert.throws(
    () => layoutPivot([{ a: 1 }], { dimensions: [{ key: 'a' }] }),
    /显式指定 axis/,
  );
  assert.throws(
    () =>
      layoutPivot([{ a: 1 }], {
        dimensions: [{ key: 'a', axis: 'row' }],
      }),
    /value 必填/,
  );
});

test('单条 {a,b,c}：显式配置后三个属性形成行链', () => {
  const dims = [
    { key: 'a', axis: 'row' },
    { key: 'b', axis: 'row', parent: 'a' },
    { key: 'c', axis: 'row', parent: 'b' },
  ];
  const cube = aggregate([{ a: 1, b: 2, c: 3 }], { dimensions: dims });
  const result = layoutPivot(cube.rows, {
    dimensions: cube.dimensions,
    value: cube.measure.key,
  });

  assert.deepEqual(result.axes.row.chain, ['a', 'b', 'c']);
  assert.deepEqual(result.size, { rows: 1, cols: 1 });
  assert.equal(result.cells[0].value, 1); // count 聚合
});

test('非法层级配置会报错', () => {
  assert.throws(
    () =>
      layoutPivot(rows, {
        dimensions: [
          { key: 'region', axis: 'row' },
          { key: 'city', axis: 'col', parent: 'region' },
        ],
        value: 'sales',
      }),
    /同一轴/,
  );

  assert.throws(
    () =>
      layoutPivot(rows, {
        dimensions: [
          { key: 'region', axis: 'row' },
          { key: 'city', axis: 'row' },
        ],
        value: 'sales',
      }),
    /恰好有一个根/,
  );

  assert.throws(
    () =>
      layoutPivot(rows, {
        dimensions: [
          { key: 'region', axis: 'row' },
          { key: 'city', axis: 'row', parent: 'region' },
          { key: 'district', axis: 'row', parent: 'region' },
        ],
        value: 'sales',
      }),
    /多个子维度/,
  );

  assert.throws(
    () =>
      layoutPivot(rows, {
        dimensions: [
          { key: 'a', axis: 'row', parent: 'b' },
          { key: 'b', axis: 'row', parent: 'a' },
        ],
        value: 'sales',
      }),
    /环/,
  );
});

test('每个单元格带二维向量，并提供坐标哈希索引', () => {
  const result = layout();

  for (const cell of result.cells) {
    assert.deepEqual(cell.vector, [cell.x, cell.y]);
    assert.equal(result.cellMap.get(`${cell.x},${cell.y}`), cell);
  }
  assert.equal(result.cellMap.size, result.cells.length);

  assert.equal(result.points.length, rows.length);
  for (const point of result.points) {
    assert.deepEqual(point.vector, [point.x, point.y]);
  }
});
