import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, layoutPivot } from '../../src/model/index.mjs';
import { combineMeasures } from '../../src/features/dual-measure.mjs';
import {
  createHeatmapStyle,
  DEFAULT_HEATMAP_COLORS,
} from '../../src/features/heatmap.mjs';

const singleDimensions = [
  { key: 'region', axis: 'row' },
  { key: 'year', axis: 'col' },
];

const singleRows = [
  { region: 'east', year: 2023, sales: 10 },
  { region: 'east', year: 2024, sales: 30 },
  { region: 'west', year: 2023, sales: 20 },
];

const singleCube = aggregate(singleRows, {
  dimensions: singleDimensions,
  measure: { key: 'sales', aggregate: 'sum' },
});
const singleLayout = layoutPivot(singleCube.rows, {
  dimensions: singleDimensions,
  value: 'sales',
});

const dualDimensions = [
  { key: 'region', axis: 'row' },
  { key: 'year', axis: 'col', order: 'asc' },
  { key: 'product', axis: 'col', parent: 'year' },
];
const dualRows = [
  { region: 'east', year: 2023, product: 'phone', sales: 10 },
  { region: 'east', year: 2023, product: 'phone', sales: 20 },
  { region: 'east', year: 2023, product: 'laptop', sales: 30 },
  { region: 'west', year: 2024, product: 'phone', sales: 40 },
];
const dualSales = aggregate(dualRows, {
  dimensions: dualDimensions,
  measure: { key: 'sales', aggregate: 'sum' },
});
const dualCount = aggregate(dualRows, { dimensions: dualDimensions });
const dual = combineMeasures({
  dimensions: dualDimensions,
  measures: [
    { label: '销售额', rows: dualSales.rows, valueField: dualSales.measure.key },
    { label: '订单数', rows: dualCount.rows, valueField: dualCount.measure.key },
  ],
});
const dualLayout = layoutPivot(dual.rows, {
  dimensions: dual.dimensions,
  value: dual.value,
});

function cellAt(layout, members) {
  return layout.cells.find((cell) =>
    Object.entries(members).every(
      ([key, value]) => cell.members[key] === value,
    ),
  );
}

test('单度量：一个 min/max，空值不接管样式', () => {
  const style = createHeatmapStyle(singleLayout);

  assert.equal(style.hasMeasure, false);
  assert.deepEqual(style.ranges.get(''), { min: 10, max: 30 });

  const min = singleLayout.cells.find((cell) => cell.value === 10);
  const max = singleLayout.cells.find((cell) => cell.value === 30);

  assert.equal(
    style.cellStyle(min).background,
    'rgb(239, 246, 255)',
  );
  assert.equal(style.cellStyle(min).text, DEFAULT_HEATMAP_COLORS.darkText);
  assert.equal(style.cellStyle(max).background, 'rgb(29, 78, 216)');
  assert.equal(style.cellStyle(max).text, DEFAULT_HEATMAP_COLORS.lightText);

  assert.equal(style.cellStyle(null), undefined);
  assert.equal(style.cellStyle({ value: null }), undefined);
  assert.equal(style.cellStyle({ value: Number.NaN }), undefined);
});

test('双度量：按 measure 分别计算 min/max 和颜色', () => {
  const style = createHeatmapStyle(dualLayout, { measureKey: 'measure' });

  assert.equal(style.hasMeasure, true);
  assert.equal(style.ranges.size, 2);
  assert.deepEqual(style.ranges.get('销售额'), { min: 30, max: 40 });
  assert.deepEqual(style.ranges.get('订单数'), { min: 1, max: 2 });

  const salesMax = cellAt(dualLayout, {
    region: 'west',
    year: 2024,
    product: 'phone',
    measure: '销售额',
  });
  const countMax = cellAt(dualLayout, {
    region: 'east',
    year: 2023,
    product: 'phone',
    measure: '订单数',
  });
  const salesMin = cellAt(dualLayout, {
    region: 'east',
    year: 2023,
    product: 'phone',
    measure: '销售额',
  });
  const countMin = cellAt(dualLayout, {
    region: 'east',
    year: 2023,
    product: 'laptop',
    measure: '订单数',
  });

  assert.equal(style.cellStyle(salesMax).background, 'rgb(29, 78, 216)');
  assert.equal(style.cellStyle(countMax).background, 'rgb(29, 78, 216)');
  assert.equal(style.cellStyle(salesMin).background, 'rgb(239, 246, 255)');
  assert.equal(style.cellStyle(countMin).background, 'rgb(239, 246, 255)');

  // 销售额 30（本系列最小值）与订单数 2（本系列最大值）使用不同位置的颜色，
  // 证明没有按两个度量的原始数值混在一起算范围。
  assert.notEqual(
    style.cellStyle(salesMin).background,
    style.cellStyle(countMax).background,
  );
});

test('支持自定义色阶与空 layout', () => {
  const style = createHeatmapStyle(singleLayout, {
    from: '#000000',
    to: '#ffffff',
  });
  const max = singleLayout.cells.find((cell) => cell.value === 30);
  const min = singleLayout.cells.find((cell) => cell.value === 10);

  assert.deepEqual(style.cellStyle(min), {
    background: 'rgb(0, 0, 0)',
    text: '#ffffff',
  });
  assert.deepEqual(style.cellStyle(max), {
    background: 'rgb(255, 255, 255)',
    text: '#0f172a',
  });

  const empty = createHeatmapStyle({ cells: [] });
  assert.equal(empty.ranges.size, 0);
  assert.equal(empty.cellStyle({ value: 1 }), undefined);

  assert.throws(() => createHeatmapStyle(null), /layoutPivot/);
  assert.throws(() => createHeatmapStyle({}), /layoutPivot/);
});
