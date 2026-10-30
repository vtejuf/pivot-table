/**
 * 业务一：聚合。
 *
 * 输入明细记录，按 dimensions[].key 分组，输出“每个维度组合唯一”的数据。
 * 本模块只做分组与度量计算，不读取 axis / parent，也不关心行列和矩阵。
 *
 * 每条输出记录包含：
 * - 每个维度的分组字段；
 * - measure.key 指定的度量字段；
 * - __count：该组的明细条数；
 * - __valueCount：参与度量的有限数值条数（供 avg 等上卷使用）。
 */

import { valueKey } from './value-key.mjs';

export const AGGREGATES = Object.freeze(['count', 'sum', 'avg', 'min', 'max']);

const RESERVED_FIELDS = new Set(['__count', '__valueCount']);

/**
 * 聚合明细记录。
 *
 * @param {Array<Record<string, unknown>>} rows 明细记录
 * @param {{
 *   dimensions: Array<{ key: string, axis?: 'row' | 'col', parent?: string | null }>,
 *   measure?: { key?: string, aggregate?: 'count' | 'sum' | 'avg' | 'min' | 'max' }
 * }} options
 * @returns {{
 *   rows: Array<Record<string, unknown>>,
 *   dimensions: Array<Record<string, unknown>>,
 *   measure: { key: string, aggregate: string }
 * }}
 */
export function aggregate(rows, options = {}) {
  if (!Array.isArray(rows)) throw new TypeError('aggregate: rows 必须是数组');

  const dimensions = normalizeDimensions(options.dimensions);
  const measure = normalizeMeasure(options.measure, dimensions);

  const groups = new Map();

  for (const record of rows) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new TypeError('aggregate: 每条记录必须是对象');
    }

    const members = {};
    const keyParts = [];
    for (const dim of dimensions) {
      const value = record[dim.key] ?? null;
      members[dim.key] = value;
      keyParts.push(valueKey(value));
    }

    const groupKey = JSON.stringify(keyParts);
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        members,
        count: 0,
        valueCount: 0,
        sum: 0,
        min: null,
        max: null,
      };
      groups.set(groupKey, group);
    }

    group.count += 1;

    if (measure.aggregate !== 'count') {
      const value = record[measure.key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        group.valueCount += 1;
        group.sum += value;
        if (group.min === null || value < group.min) group.min = value;
        if (group.max === null || value > group.max) group.max = value;
      }
    }
  }

  const output = [];
  for (const group of groups.values()) {
    const result = { ...group.members };

    switch (measure.aggregate) {
      case 'count':
        result[measure.key] = group.count;
        break;
      case 'sum':
        result[measure.key] = group.valueCount === 0 ? 0 : group.sum;
        break;
      case 'avg':
        result[measure.key] =
          group.valueCount === 0 ? null : group.sum / group.valueCount;
        break;
      case 'min':
        result[measure.key] = group.min;
        break;
      case 'max':
        result[measure.key] = group.max;
        break;
    }

    result.__count = group.count;
    result.__valueCount =
      measure.aggregate === 'count' ? group.count : group.valueCount;
    output.push(result);
  }

  return {
    rows: output,
    dimensions: dimensions.map((dim) => ({ ...dim })),
    measure: { key: measure.key, aggregate: measure.aggregate },
  };
}

// ---------------------------------------------------------------------------
// 配置规范化
// ---------------------------------------------------------------------------

function normalizeDimensions(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('aggregate: dimensions 必填，且至少包含一个维度');
  }

  const seen = new Set();
  return raw.map((item) => {
    if (!item || typeof item.key !== 'string' || item.key === '') {
      throw new Error('aggregate: 每个维度必须有非空字符串 key');
    }
    if (seen.has(item.key)) {
      throw new Error(`aggregate: 维度 key 重复: ${item.key}`);
    }
    if (RESERVED_FIELDS.has(item.key)) {
      throw new Error(`aggregate: 维度 key 不能使用保留字段 ${item.key}`);
    }
    seen.add(item.key);
    return { ...item };
  });
}

function normalizeMeasure(raw, dimensions) {
  if (raw == null) {
    return { key: '__count', aggregate: 'count' };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('aggregate: measure 必须是对象');
  }

  const kind = raw.aggregate ?? 'count';
  if (!AGGREGATES.includes(kind)) {
    throw new Error(
      `aggregate: 不支持的聚合方式 ${kind}，可选 ${AGGREGATES.join(' / ')}`,
    );
  }

  const key = raw.key ?? (kind === 'count' ? '__count' : null);
  if (typeof key !== 'string' || key === '') {
    throw new Error(`aggregate: ${kind} 聚合必须提供非空字符串 measure.key`);
  }

  const isCountDefault = kind === 'count' && key === '__count';
  if (RESERVED_FIELDS.has(key) && !isCountDefault) {
    throw new Error(`aggregate: measure.key 不能使用保留字段 ${key}`);
  }
  if (dimensions.some((dim) => dim.key === key)) {
    throw new Error(`aggregate: measure.key 与维度 key 冲突: ${key}`);
  }

  return { key, aggregate: kind };
}
