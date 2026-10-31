/**
 * 并列度量 feature：只负责布局数据，不改核心算法，也不处理热力图。
 *
 * 把多个 aggregate 结果展开成长表，并把“度量”作为列轴最末一层维度：
 *
 *   dims: region > city（行）, year > product（列）
 *   rows: { region, city, year, product, measure: '销售额', value: 123 }
 *         { region, city, year, product, measure: '订单数', value: 7 }
 *   cols: year > product > measure
 *
 * 然后把长表交给核心 layoutPivot({ value: 'value' })。核心矩阵、表头与渲染
 * 不需要任何改动。
 *
 * 输入要求：
 * - dimensions 是核心布局的维度配置；
 * - 每个 measure 的 rows 来自 aggregate，使用该度量字段；
 * - 同一 measure 内维度组合唯一；不同 measure 的 label 唯一。
 */

export const DEFAULT_MEASURE_KEY = 'measure';
export const DEFAULT_VALUE_KEY = 'value';

/**
 * @param {{
 *   dimensions: Array<{ key: string, axis: 'row' | 'col', parent?: string | null }>,
 *   measures: Array<{
 *     label: string,
 *     rows: Array<Record<string, unknown>>,
 *     valueField: string
 *   }>,
 *   measureKey?: string,
 *   valueKey?: string
 * }} options
 * @returns {{
 *   rows: Array<Record<string, unknown>>,
 *   dimensions: Array<Record<string, unknown>>,
 *   value: string,
 *   measureKey: string,
 *   measures: Array<{ label: string, valueField: string }>
 * }}
 */
export function combineMeasures({
  dimensions,
  measures,
  measureKey = DEFAULT_MEASURE_KEY,
  valueKey = DEFAULT_VALUE_KEY,
} = {}) {
  validateDimensions(dimensions);
  if (typeof measureKey !== 'string' || measureKey === '') {
    throw new Error('combineMeasures: measureKey 必须是非空字符串');
  }
  if (typeof valueKey !== 'string' || valueKey === '') {
    throw new Error('combineMeasures: valueKey 必须是非空字符串');
  }
  if (measureKey === valueKey) {
    throw new Error('combineMeasures: measureKey 与 valueKey 不能相同');
  }

  const dimensionKeys = new Set(dimensions.map((dimension) => dimension.key));
  if (dimensionKeys.has(measureKey)) {
    throw new Error(`combineMeasures: 维度 key 不能使用保留的 ${measureKey}`);
  }
  if (dimensionKeys.has(valueKey)) {
    throw new Error(`combineMeasures: 维度 key 不能使用保留的 ${valueKey}`);
  }

  if (!Array.isArray(measures) || measures.length < 2) {
    throw new Error('combineMeasures: 至少需要两个度量');
  }

  const labels = new Set();
  for (const measure of measures) {
    if (!measure || typeof measure !== 'object') {
      throw new Error('combineMeasures: 每个度量必须是对象');
    }
    if (typeof measure.label !== 'string' || measure.label === '') {
      throw new Error('combineMeasures: 每个度量必须有非空字符串 label');
    }
    if (labels.has(measure.label)) {
      throw new Error(`combineMeasures: 度量 label 重复: ${measure.label}`);
    }
    if (!Array.isArray(measure.rows)) {
      throw new Error(`combineMeasures: 度量 ${measure.label} 的 rows 必须是数组`);
    }
    if (typeof measure.valueField !== 'string' || measure.valueField === '') {
      throw new Error(`combineMeasures: 度量 ${measure.label} 必须提供 valueField`);
    }
    labels.add(measure.label);
  }

  const rows = [];
  for (const measure of measures) {
    for (const row of measure.rows) {
      const longRow = {
        [measureKey]: measure.label,
        [valueKey]: row[measure.valueField],
      };
      for (const dimension of dimensions) {
        longRow[dimension.key] = row[dimension.key] ?? null;
      }
      rows.push(longRow);
    }
  }

  const parentKey = leafColumnKey(dimensions);
  const measureDimension = {
    key: measureKey,
    axis: 'col',
    ...(parentKey === null ? {} : { parent: parentKey }),
    order: 'first-seen',
  };

  return {
    rows,
    dimensions: [
      ...dimensions.map((dimension) => ({ ...dimension })),
      measureDimension,
    ],
    value: valueKey,
    measureKey,
    measures: measures.map((measure) => ({
      label: measure.label,
      valueField: measure.valueField,
    })),
  };
}

function validateDimensions(dimensions) {
  if (!Array.isArray(dimensions) || dimensions.length === 0) {
    throw new Error('combineMeasures: dimensions 必填，且至少包含一个维度');
  }

  const keys = new Set();
  for (const dimension of dimensions) {
    if (!dimension || typeof dimension.key !== 'string' || dimension.key === '') {
      throw new Error('combineMeasures: 每个维度必须有非空字符串 key');
    }
    if (keys.has(dimension.key)) {
      throw new Error(`combineMeasures: 维度 key 重复: ${dimension.key}`);
    }
    keys.add(dimension.key);
  }
}

/** 找到列轴层级链的末端；没有列维度时返回 null。 */
function leafColumnKey(dimensions) {
  const colDimensions = dimensions.filter((dimension) => dimension.axis === 'col');
  if (colDimensions.length === 0) return null;

  const leaves = colDimensions.filter(
    (dimension) =>
      !colDimensions.some((other) => other.parent === dimension.key),
  );
  if (leaves.length !== 1) {
    throw new Error(
      'combineMeasures: 列轴必须恰好有一条层级链（单根、每个维度最多一个子维度）',
    );
  }
  return leaves[0].key;
}
