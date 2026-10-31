/**
 * 维度取值的稳定键。
 *
 * 聚合层用它做 group by，布局层用它做成员索引，两边必须使用同一套规则，
 * 否则同一个取值可能在聚合和布局阶段被当成两个成员。
 */
export function valueKey(value) {
  if (value === null || value === undefined) return 'null:';
  switch (typeof value) {
    case 'number':
      if (Number.isNaN(value)) return 'num:NaN';
      return `num:${Object.is(value, -0) ? '-0' : value}`;
    case 'string':
      return `str:${value}`;
    case 'boolean':
      return `bool:${value}`;
    case 'bigint':
      return `bigint:${value}`;
    case 'object':
      if (value instanceof Date) return `date:${value.getTime()}`;
      try {
        return `obj:${JSON.stringify(value)}`;
      } catch {
        return `obj:${String(value)}`;
      }
    default:
      return `${typeof value}:${String(value)}`;
  }
}
