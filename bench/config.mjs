/** 基准测试共用配置：维度基数固定，原始明细规模变化。 */

export const dimensions = [
  { key: 'region', axis: 'row' },
  { key: 'city', axis: 'row', parent: 'region' },
  { key: 'year', axis: 'col', order: 'asc' },
  { key: 'product', axis: 'col', parent: 'year' },
];

export const measure = { key: 'sales', aggregate: 'sum' };

export const members = {
  regions: 8,
  cities: 8,
  years: 6,
  products: 4,
};

export const combinations =
  members.regions * members.cities * members.years * members.products;

/** 基准配置说明，写入 results.json 供页面展示。 */
export const benchmarkConfig = {
  dimensions: ['region × 8', 'city × 8', 'year × 6', 'product × 4'],
  combinations,
  measure: 'sales · sum',
  rows: '5 个字段：region / city / year / product / sales',
  layout: 'cartesian',
};
