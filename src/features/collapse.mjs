/**
 * 展开 / 折叠 feature。
 *
 * 核心布局和渲染都不修改；折叠是数据派生 + 表头交互：
 *
 * 1. collapseCube(cube, collapsed)
 *    读取 aggregate() 的 cube，按折叠状态把被折叠成员的子维度替换为
 *    COLLAPSED_VALUE，并对同一父级下的度量重新上卷。输出新的 rows，
 *    再交给核心 layoutPivot()。
 *
 * 2. hitTestHeader(layout, geometry, point)
 *    在冻结的行/列表头上找到可折叠的父成员，返回 axis / dimension / value / key。
 *
 * 3. drawCollapseIndicators(ctx, { layout, geometry, collapsed })
 *    在父成员表头右侧画 + / − 指示器，供 renderWithOverlay 使用。
 *
 * 首版边界：
 * - 只支持 compact 布局（cartesian 会为每个父级补齐全局子成员）；
 * - 只支持单度量 cube（并列度量的 rows 没有统一的 measure）；
 * - 暂不与行/列小计、总计叠加；
 * - 折叠父级后保留一个“（全部）”子成员，表示该父级的汇总。
 */

import { valueKey } from '../model/value-key.mjs';
import { rectsIntersect } from '../render/geometry.mjs';

export const COLLAPSED_VALUE = '（全部）';

const AGGREGATES = new Set(['count', 'sum', 'avg', 'min', 'max']);
const GROUP_SEPARATOR = '\u0001';
const AXIS_SEPARATOR = '\u0002';

/**
 * 稳定的折叠键：axis + 维度 key + 成员取值。
 *
 * @param {'row' | 'col'} axis
 * @param {string} dimension
 * @param {unknown} value
 */
export function collapseKey(axis, dimension, value) {
  if (axis !== 'row' && axis !== 'col') {
    throw new TypeError("collapseKey: axis 只能是 'row' 或 'col'");
  }
  if (typeof dimension !== 'string' || dimension === '') {
    throw new TypeError('collapseKey: dimension 必须是非空字符串');
  }
  return `${axis}:${dimension}:${valueKey(value)}`;
}

/**
 * 按折叠状态重新上卷 cube。
 *
 * @param {{
 *   rows: Array<Record<string, unknown>>,
 *   dimensions: Array<{ key: string, axis?: string, parent?: string | null }>,
 *   measure: { key: string, aggregate: string }
 * }} cube
 * @param {Set<string>} collapsed collapseKey() 组成的集合
 * @returns {{
 *   rows: Array<Record<string, unknown>>,
 *   dimensions: Array<object>,
 *   changed: boolean
 * }}
 */
export function collapseCube(cube, collapsed = new Set()) {
  assertCube(cube);
  if (!(collapsed instanceof Set)) {
    throw new TypeError('collapseCube: collapsed 必须是 Set');
  }
  if (collapsed.size === 0) {
    return { rows: cube.rows, dimensions: cube.dimensions, changed: false };
  }

  const rowChain = axisChain(cube.dimensions, 'row');
  const colChain = axisChain(cube.dimensions, 'col');
  const measureKey = cube.measure.key;
  const aggregate = cube.measure.aggregate;

  const groups = new Map();
  let changed = false;

  for (const row of cube.rows) {
    const rowValues = rowChain.map((key) => row[key]);
    const colValues = colChain.map((key) => row[key]);
    const rowCollapsed = findCollapsed(rowChain, rowValues, collapsed, 'row');
    const colCollapsed = findCollapsed(colChain, colValues, collapsed, 'col');

    if (rowCollapsed >= 0) {
      for (let i = rowCollapsed + 1; i < rowChain.length; i += 1) {
        rowValues[i] = COLLAPSED_VALUE;
      }
      changed = true;
    }
    if (colCollapsed >= 0) {
      for (let i = colCollapsed + 1; i < colChain.length; i += 1) {
        colValues[i] = COLLAPSED_VALUE;
      }
      changed = true;
    }

    const key = [
      ...rowValues.map((value) => valueKey(value)),
      AXIS_SEPARATOR,
      ...colValues.map((value) => valueKey(value)),
    ].join(GROUP_SEPARATOR);

    let group = groups.get(key);
    if (!group) {
      group = {
        first: row,
        rowValues,
        colValues,
        count: 0,
        valueCount: 0,
        sum: 0,
        weightedSum: 0,
        weight: 0,
        min: null,
        max: null,
        hasValue: false,
      };
      groups.set(key, group);
    }
    accumulate(group, row, measureKey);
  }

  if (!changed) {
    return { rows: cube.rows, dimensions: cube.dimensions, changed: false };
  }

  const output = [];
  for (const group of groups.values()) {
    const result = { ...group.first };
    for (let i = 0; i < rowChain.length; i += 1) {
      result[rowChain[i]] = group.rowValues[i];
    }
    for (let i = 0; i < colChain.length; i += 1) {
      result[colChain[i]] = group.colValues[i];
    }

    result[measureKey] = finalValue(group, aggregate);
    result.__count = group.count;
    result.__valueCount = group.valueCount;
    output.push(result);
  }

  return { rows: output, dimensions: cube.dimensions, changed: true };
}

/**
 * 命中可折叠的表头父成员。
 *
 * @param {object} layout
 * @param {object} geometry computePivotGeometry() 的结果
 * @param {{ x: number, y: number }} point 屏幕坐标（CSS 像素）
 * @returns {{
 *   axis: 'row' | 'col',
 *   dimension: string,
 *   value: unknown,
 *   key: string,
 *   rect: { x: number, y: number, width: number, height: number },
 *   depth: number
 * } | null}
 */
export function hitTestHeader(layout, geometry, point) {
  if (!layout || !geometry || !point) return null;
  if (!isFinitePoint(point)) return null;

  const row = hitAxis(
    layout.axes?.row?.header,
    'row',
    geometry.rowHeaderClip,
    geometry.rowHeaderRect,
    point,
  );
  if (row) return row;

  return hitAxis(
    layout.axes?.col?.header,
    'col',
    geometry.colHeaderClip,
    geometry.colHeaderRect,
    point,
  );
}

/**
 * 在冻结表头上画 + / − 指示器。
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{
 *   layout: object,
 *   geometry: object,
 *   collapsed?: Set<string>
 * }} context
 * @returns {number} 实际绘制的指示器数量
 */
export function drawCollapseIndicators(ctx, { layout, geometry, collapsed } = {}) {
  if (!ctx || typeof ctx.fillText !== 'function' || !layout || !geometry) {
    return 0;
  }

  const state = collapsed instanceof Set ? collapsed : new Set(collapsed ?? []);
  let drawn = 0;

  ctx.save();
  try {
    if (layout.axes?.row?.header && geometry.rowHeaderClip) {
      ctx.save();
      clipRect(ctx, geometry.rowHeaderClip);
      drawn += drawAxisIndicators(
        ctx,
        layout.axes.row.header,
        'row',
        geometry.rowHeaderRect,
        geometry.rowHeaderClip,
        state,
        0,
      );
      ctx.restore();
    }

    if (layout.axes?.col?.header && geometry.colHeaderClip) {
      ctx.save();
      clipRect(ctx, geometry.colHeaderClip);
      drawn += drawAxisIndicators(
        ctx,
        layout.axes.col.header,
        'col',
        geometry.colHeaderRect,
        geometry.colHeaderClip,
        state,
        0,
      );
      ctx.restore();
    }
  } finally {
    ctx.restore();
  }

  return drawn;
}

// ---------------------------------------------------------------------------
// 内部
// ---------------------------------------------------------------------------

function assertCube(cube) {
  if (
    !cube ||
    !Array.isArray(cube.rows) ||
    !Array.isArray(cube.dimensions) ||
    !cube.measure ||
    typeof cube.measure.key !== 'string' ||
    !AGGREGATES.has(cube.measure.aggregate)
  ) {
    throw new TypeError(
      'collapseCube: cube 必须是 aggregate() 的返回值（需要 rows / dimensions / measure）',
    );
  }
}

function axisChain(dimensions, axis) {
  const list = dimensions.filter((dim) => dim.axis === axis);
  if (list.length === 0) return [];

  const keys = new Set(list.map((dim) => dim.key));
  const children = new Map();
  for (const dim of list) {
    const parent = dim.parent ?? null;
    if (parent !== null && !keys.has(parent)) {
      throw new Error(
        `collapseCube: ${axis} 维度的 parent 不存在: ${parent}`,
      );
    }
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(dim.key);
  }

  const roots = children.get(null) ?? [];
  if (roots.length !== 1) {
    throw new Error(`collapseCube: ${axis} 轴必须只有一个根维度`);
  }

  const chain = [];
  let current = roots[0];
  while (current) {
    chain.push(current);
    const next = children.get(current) ?? [];
    if (next.length > 1) {
      throw new Error(`collapseCube: ${axis} 轴只支持一条层级链`);
    }
    current = next[0];
  }

  if (chain.length !== list.length) {
    throw new Error(`collapseCube: ${axis} 轴存在未连接的维度`);
  }
  return chain;
}

function findCollapsed(chain, values, collapsed, axis) {
  for (let i = 0; i < chain.length - 1; i += 1) {
    if (collapsed.has(collapseKey(axis, chain[i], values[i]))) return i;
  }
  return -1;
}

function accumulate(group, row, measureKey) {
  group.count += finite(row.__count);
  group.valueCount += finite(row.__valueCount);

  const value = row[measureKey];
  if (typeof value !== 'number' || !Number.isFinite(value)) return;

  group.sum += value;
  group.hasValue = true;
  if (group.min === null || value < group.min) group.min = value;
  if (group.max === null || value > group.max) group.max = value;

  const weight = finite(row.__valueCount);
  if (weight > 0) {
    group.weightedSum += value * weight;
    group.weight += weight;
  } else {
    group.weightedSum += value;
    group.weight += 1;
  }
}

function finalValue(group, aggregate) {
  switch (aggregate) {
    case 'count':
      return group.count;
    case 'sum':
      return group.hasValue ? group.sum : 0;
    case 'avg':
      return group.weight > 0 ? group.weightedSum / group.weight : null;
    case 'min':
      return group.min;
    case 'max':
      return group.max;
    default:
      return null;
  }
}

function hitAxis(node, axis, clip, rectFn, point) {
  if (!node || !clip || typeof rectFn !== 'function') return null;
  if (!containsRect(clip, point)) return null;
  return walk(node, 0);

  function walk(current, depth) {
    for (const member of current.members ?? []) {
      const rect = rectFn(depth, member.offset, member.size);
      if (axis === 'row' && rect.y > point.y) break;
      if (axis === 'col' && rect.x > point.x) break;

      const hasChildren =
        member.children && (member.children.members?.length ?? 0) > 0;
      if (containsRect(rect, point)) {
        if (!hasChildren) return null;
        return {
          axis,
          dimension: current.key,
          value: member.value,
          key: collapseKey(axis, current.key, member.value),
          rect,
          depth,
        };
      }

      if (hasChildren) {
        const hit = walk(member.children, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  }
}

function drawAxisIndicators(
  ctx,
  node,
  axis,
  rectFn,
  clip,
  collapsed,
  depth,
) {
  let drawn = 0;

  for (const member of node.members ?? []) {
    const hasChildren =
      member.children && (member.children.members?.length ?? 0) > 0;
    if (hasChildren) {
      const rect = rectFn(depth, member.offset, member.size);
      if (rectsIntersect(rect, clip)) {
        const isCollapsed = collapsed.has(
          collapseKey(axis, node.key, member.value),
        );
        const x = rect.x + rect.width - 10;
        const y = rect.y + rect.height / 2;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
        ctx.fillRect(x - 6, y - 6, 12, 12);
        ctx.fillStyle = '#475569';
        ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(isCollapsed ? '+' : '−', x, y);
        drawn += 1;
      }

      drawn += drawAxisIndicators(
        ctx,
        member.children,
        axis,
        rectFn,
        clip,
        collapsed,
        depth + 1,
      );
    }
  }

  return drawn;
}

function clipRect(ctx, rect) {
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, Math.max(0, rect.width), Math.max(0, rect.height));
  ctx.clip();
}

function containsRect(rect, point) {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  );
}

function isFinitePoint(point) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
