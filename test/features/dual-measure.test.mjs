import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, layoutPivot } from '../../src/model/index.mjs';
import { combineMeasures } from '../../src/features/dual-measure.mjs';

const dimensions = [
  { key: 'region', axis: 'row' },
  { key: 'year', axis: 'col', order: 'asc' },
  { key: 'product', axis: 'col', parent: 'year' },
];

const detail = [
  { region: 'east', year: 2023, product: 'phone', sales: 10 },
  { region: 'east', year: 2023, product: 'phone', sales: 20 },
  { region: 'east', year: 2023, product: 'laptop', sales: 30 },
  { region: 'west', year: 2024, product: 'phone', sales: 40 },
];

const salesCube = aggregate(detail, {
  dimensions,
  measure: { key: 'sales', aggregate: 'sum' },
});
const countCube = aggregate(detail, { dimensions });

function measureInputs() {
  return [
    {
      label: '销售额',
      rows: salesCube.rows,
      valueField: salesCube.measure.key,
    },
    {
      label: '订单数',
      rows: countCube.rows,
      valueField: countCube.measure.key,
    },
  ];
}

function cellAt(layout, members) {
  return layout.cells.find((cell) =>
    Object.entries(members).every(
      ([key, value]) => cell.members[key] === value,
    ),
  );
}

function headerMember(node, value) {
  return node.members.find((member) => member.value === value);
}

test('把度量追加为列轴最末层维度，并保持核心布局不变', () => {
  const dual = combineMeasures({ dimensions, measures: measureInputs() });

  assert.equal(dual.rows.length, salesCube.rows.length + countCube.rows.length);
  assert.deepEqual(
    dual.dimensions.map((dimension) => dimension.key),
    ['region', 'year', 'product', 'measure'],
  );
  assert.equal(dual.dimensions.at(-1).axis, 'col');
  assert.equal(dual.dimensions.at(-1).parent, 'product');
  assert.equal(dual.value, 'value');

  // 输入不被修改
  assert.equal(salesCube.rows.length, 3);
  assert.equal(countCube.rows.length, 3);
  assert.equal(dimensions.length, 3);
  assert.notEqual(dual.dimensions, dimensions);

  const layout = layoutPivot(dual.rows, {
    dimensions: dual.dimensions,
    value: dual.value,
  });

  assert.deepEqual(layout.size, { rows: 2, cols: 8 });
  assert.deepEqual(
    layout.dimensions.map((dimension) => dimension.key),
    ['region', 'year', 'product', 'measure'],
  );

  assert.equal(
    cellAt(layout, {
      region: 'east',
      year: 2023,
      product: 'phone',
      measure: '销售额',
    }).value,
    30,
  );
  assert.equal(
    cellAt(layout, {
      region: 'east',
      year: 2023,
      product: 'phone',
      measure: '订单数',
    }).value,
    2,
  );
  assert.equal(
    cellAt(layout, {
      region: 'west',
      year: 2024,
      product: 'phone',
      measure: '销售额',
    }).value,
    40,
  );
  assert.equal(
    cellAt(layout, {
      region: 'west',
      year: 2024,
      product: 'phone',
      measure: '订单数',
    }).value,
    1,
  );
});

test('度量列使用 first-seen 顺序，表头新增 measure 层', () => {
  const dual = combineMeasures({ dimensions, measures: measureInputs() });
  const layout = layoutPivot(dual.rows, {
    dimensions: dual.dimensions,
    value: dual.value,
  });

  const colHeader = layout.axes.col.header;
  assert.equal(colHeader.key, 'year');
  const year = headerMember(colHeader, 2023);
  assert.ok(year);

  const phone = headerMember(year.children, 'phone');
  assert.ok(phone);
  assert.equal(phone.children.key, 'measure');
  assert.deepEqual(
    phone.children.members.map((member) => member.value),
    ['销售额', '订单数'],
  );
});

test('没有列维度时，度量作为列轴根维度', () => {
  const rowOnlyDimensions = [{ key: 'region', axis: 'row' }];
  const sales = aggregate(detail, {
    dimensions: rowOnlyDimensions,
    measure: { key: 'sales', aggregate: 'sum' },
  });
  const count = aggregate(detail, { dimensions: rowOnlyDimensions });

  const dual = combineMeasures({
    dimensions: rowOnlyDimensions,
    measures: [
      { label: '销售额', rows: sales.rows, valueField: sales.measure.key },
      { label: '订单数', rows: count.rows, valueField: count.measure.key },
    ],
  });

  assert.equal(dual.dimensions.at(-1).parent, undefined);

  const layout = layoutPivot(dual.rows, {
    dimensions: dual.dimensions,
    value: dual.value,
  });
  assert.deepEqual(layout.size, { rows: 2, cols: 2 });
  assert.equal(
    cellAt(layout, { region: 'east', measure: '销售额' }).value,
    60,
  );
  assert.equal(cellAt(layout, { region: 'east', measure: '订单数' }).value, 3);
});

test('非法输入显式报错', () => {
  const measures = measureInputs();

  assert.throws(
    () => combineMeasures({ dimensions, measures: [measures[0]] }),
    /至少需要两个度量/,
  );

  assert.throws(
    () =>
      combineMeasures({
        dimensions,
        measures: [measures[0], { ...measures[1], label: '销售额' }],
      }),
    /label 重复/,
  );

  assert.throws(
    () =>
      combineMeasures({
        dimensions: [...dimensions, { key: 'measure', axis: 'col' }],
        measures,
      }),
    /保留的 measure/,
  );

  assert.throws(
    () =>
      combineMeasures({
        dimensions: [...dimensions, { key: 'value', axis: 'col' }],
        measures,
      }),
    /保留的 value/,
  );

  assert.throws(
    () =>
      combineMeasures({
        dimensions: [
          { key: 'year', axis: 'col' },
          { key: 'product', axis: 'col' },
        ],
        measures,
      }),
    /层级链/,
  );
});
