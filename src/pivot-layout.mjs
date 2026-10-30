/**
 * 业务二：布局。
 *
 * 输入是“每个维度组合唯一”的聚合数据（由 aggregate() 产生），本模块只做
 * 成员索引、矩阵变换和二维坐标，不做任何 sum / avg / count 计算。
 *
 * 一条记录是一个高维向量：每个维度的取值先编码成成员序号 i_d。
 *
 *     v = [i_1, i_2, ..., i_D, 1]^T
 *     [x, y]^T = M v
 *
 * M 的第 d 列 = span_d * 该维度所在轴的单位向量；最后一列是平移。
 * 父子层级关系体现在 span 的乘积结构里：
 *
 *     span_parent = n_child * span_child
 *
 * 也就是说父维度的一列是子维度一列的整数倍：父级负责粗定位，子级在父级
 * 划出的块内做细定位。整棵树因此等价于一个混合进制数的解码。
 *
 * 两种布局：
 * - cartesian：每个父成员下补齐该子维度的全部成员（标准笛卡尔网格）。
 * - compact：只排列数据中实际出现的成员组合。父成员块大小可变，矩阵退化
 *   为逐记录的分段仿射变换；每条记录仍返回 transforms（每个属性一次平移）。
 *
 * 限制：每个轴只支持一条层级链（单根、每个维度最多一个子维度）。
 */

import { valueKey } from './value-key.mjs';

export const AXIS = Object.freeze({ ROW: 'row', COL: 'col' });

const ROW = AXIS.ROW;
const COL = AXIS.COL;

/**
 * 计算透视表布局。
 *
 * @param {Array<Record<string, unknown>>} rows 聚合后的数据，每个维度组合一行
 * @param {{
 *   dimensions: Array<{
 *     key: string,
 *     axis: 'row' | 'col',
 *     parent?: string | null,
 *     order?: 'first-seen' | 'asc' | 'desc',
 *     compare?: (a: unknown, b: unknown) => number
 *   }>,
 *   value: string,
 *   mode?: 'cartesian' | 'compact',
 *   duplicate?: 'error' | 'first' | 'last'
 * }} options
 */
export function layoutPivot(rows, options = {}) {
  if (!Array.isArray(rows)) throw new TypeError('layoutPivot: rows 必须是数组');
  if (!Array.isArray(options.dimensions) || options.dimensions.length === 0) {
    throw new Error('layoutPivot: dimensions 必填，且至少包含一个维度');
  }
  const dimensions = normalizeDimensions(options.dimensions);
  if (typeof options.value !== 'string' || options.value === '') {
    throw new Error('layoutPivot: value 必填（聚合数据中的度量字段名）');
  }

  const mode = options.mode ?? 'cartesian';
  if (mode !== 'cartesian' && mode !== 'compact') {
    throw new Error(`layoutPivot: mode 只能是 'cartesian' 或 'compact'，收到 ${mode}`);
  }

  const valueField = options.value;
  const duplicate = options.duplicate ?? 'error';
  if (duplicate !== 'error' && duplicate !== 'first' && duplicate !== 'last') {
    throw new Error("layoutPivot: duplicate 只能是 'error' / 'first' / 'last'");
  }

  const dimensionOrder = [...dimensions.values()];
  const rowChain = buildChain(ROW, dimensions);
  const colChain = buildChain(COL, dimensions);

  if (rowChain.length === 0 && colChain.length === 0) {
    throw new Error('layoutPivot: 至少需要一个维度');
  }

  const globalMembers = new Map();
  for (const dim of dimensionOrder) {
    globalMembers.set(dim.key, collectMembers(rows, dim));
  }

  const rowRoot = rowChain.length ? buildLevel(rows, rowChain, 0, mode, globalMembers) : null;
  const colRoot = colChain.length ? buildLevel(rows, colChain, 0, mode, globalMembers) : null;

  const rowLength = rowRoot ? rowRoot.totalSize : 1;
  const colLength = colRoot ? colRoot.totalSize : 1;

  const cells = new Map();
  const points = [];

  for (const record of rows) {
    const rowPos = rowRoot ? locate(record, rowRoot) : { offset: 0, path: [] };
    const colPos = colRoot ? locate(record, colRoot) : { offset: 0, path: [] };
    const key = `${colPos.offset},${rowPos.offset}`;

    const members = {};
    const indexes = {};
    const transforms = [];

    for (const p of rowPos.path) {
      members[p.key] = p.value;
      indexes[p.key] = p.index;
      transforms.push({
        key: p.key,
        axis: ROW,
        memberOffset: p.offset,
        vector: [0, p.offset],
      });
    }
    for (const p of colPos.path) {
      members[p.key] = p.value;
      indexes[p.key] = p.index;
      transforms.push({
        key: p.key,
        axis: COL,
        memberOffset: p.offset,
        vector: [p.offset, 0],
      });
    }

    const existing = cells.get(key);
    if (existing && duplicate === 'error') {
      throw new Error(
        `layoutPivot: 单元格 (${colPos.offset}, ${rowPos.offset}) 出现重复记录；` +
          '布局层不做聚合，请先用 aggregate() 把明细聚合成每个维度组合唯一的数据',
      );
    }

    if (!existing || duplicate === 'last') {
      cells.set(key, {
        x: colPos.offset,
        y: rowPos.offset,
        value: record[valueField] ?? null,
        members,
        record,
      });
    }

    points.push({
      x: colPos.offset,
      y: rowPos.offset,
      record,
      members,
      indexes,
      transforms,
    });
  }

  let matrix = null;
  let dimensionVectors = null;
  if (mode === 'cartesian') {
    const spans = new Map();
    for (const [root, chain] of [
      [rowRoot, rowChain],
      [colRoot, colChain],
    ]) {
      if (!root) continue;
      let node = root;
      for (const dim of chain) {
        spans.set(dim.key, node.members.length ? node.totalSize / node.members.length : 0);
        node = node.members[0]?.children ?? null;
      }
    }

    matrix = [
      Array(dimensionOrder.length + 1).fill(0),
      Array(dimensionOrder.length + 1).fill(0),
    ];
    dimensionVectors = {};
    dimensionOrder.forEach((dim, i) => {
      const span = spans.get(dim.key) ?? 0;
      if (dim.axis === COL) matrix[0][i] = span;
      else matrix[1][i] = span;
      dimensionVectors[dim.key] = dim.axis === COL ? [span, 0] : [0, span];
    });
  }

  const sortedCells = [...cells.values()].sort((a, b) => a.y - b.y || a.x - b.x);

  return {
    mode,
    value: valueField,
    size: { rows: rowLength, cols: colLength },
    dimensions: dimensionOrder.map((dim) => ({
      key: dim.key,
      axis: dim.axis,
      parent: dim.parent,
      order: dim.order,
    })),
    matrix,
    dimensionVectors,
    cells: sortedCells,
    points,
    axes: {
      row: rowRoot ? axisResult(rowRoot, rowChain) : null,
      col: colRoot ? axisResult(colRoot, colChain) : null,
    },
    /** 网格坐标 -> 像素坐标（可选辅助，不改变模型本身）。 */
    toPixel(cellSize = {}) {
      const width = cellSize.width ?? 1;
      const height = cellSize.height ?? 1;
      return sortedCells.map((cell) => ({
        ...cell,
        px: cell.x * width,
        py: cell.y * height,
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// 维度规范与层级
// ---------------------------------------------------------------------------

function normalizeDimensions(raw) {
  if (!Array.isArray(raw)) throw new TypeError('dimensions 必须是数组');
  const map = new Map();

  for (const item of raw) {
    if (!item || typeof item.key !== 'string' || item.key === '') {
      throw new Error('维度必须有非空字符串 key');
    }
    if (map.has(item.key)) throw new Error(`维度 key 重复: ${item.key}`);
    const axis = item.axis;
    if (axis !== ROW && axis !== COL) {
      throw new Error(`维度 ${item.key} 必须显式指定 axis: 'row' 或 'col'`);
    }
    map.set(item.key, {
      key: item.key,
      parent: item.parent ?? null,
      axis,
      order: item.order ?? 'first-seen',
      compare: typeof item.compare === 'function' ? item.compare : null,
    });
  }

  for (const dim of map.values()) {
    if (dim.parent === null) continue;
    const parent = map.get(dim.parent);
    if (!parent) throw new Error(`维度 ${dim.key} 的 parent "${dim.parent}" 不存在`);
    if (parent.axis !== dim.axis) {
      throw new Error(`维度 ${dim.key} 与父维度 ${dim.parent} 必须在同一轴`);
    }

    const seen = new Set([dim.key]);
    let cursor = parent;
    while (cursor) {
      if (seen.has(cursor.key)) {
        throw new Error(`维度层级存在环: ${dim.key} -> ... -> ${cursor.key}`);
      }
      seen.add(cursor.key);
      cursor = cursor.parent ? map.get(cursor.parent) : null;
    }
  }

  return map;
}

function buildChain(axis, dimensions) {
  const axisDims = [...dimensions.values()].filter((dim) => dim.axis === axis);
  if (axisDims.length === 0) return [];

  const roots = axisDims.filter((dim) => dim.parent === null);
  if (roots.length !== 1) {
    throw new Error(`轴 ${axis} 必须恰好有一个根维度，目前有 ${roots.length} 个`);
  }

  const children = new Map();
  for (const dim of axisDims) {
    if (!dim.parent) continue;
    const list = children.get(dim.parent) ?? [];
    list.push(dim);
    children.set(dim.parent, list);
  }
  for (const [parentKey, list] of children) {
    if (list.length > 1) {
      throw new Error(
        `维度 ${parentKey} 有多个子维度 (${list.map((d) => d.key).join(', ')})；当前模型只支持单链层级`,
      );
    }
  }

  const chain = [];
  let cursor = roots[0];
  while (cursor) {
    chain.push(cursor);
    cursor = children.get(cursor.key)?.[0] ?? null;
  }
  if (chain.length !== axisDims.length) {
    throw new Error(`轴 ${axis} 的维度不构成一条完整链（可能有游离维度）`);
  }
  return chain;
}

// ---------------------------------------------------------------------------
// 成员收集与排序
// ---------------------------------------------------------------------------

function collectMembers(rows, dim) {
  const map = new Map();
  for (const row of rows) {
    const value = row[dim.key] ?? null;
    const key = valueKey(value);
    if (!map.has(key)) map.set(key, { key, value, seen: map.size });
  }

  const list = [...map.values()];
  if (typeof dim.compare === 'function') {
    list.sort((a, b) => dim.compare(a.value, b.value));
  } else if (dim.order === 'asc') {
    list.sort((a, b) => compareValues(a.value, b.value));
  } else if (dim.order === 'desc') {
    list.sort((a, b) => compareValues(b.value, a.value));
  }

  list.forEach((member, index) => {
    member.index = index;
  });
  return list;
}

function compareValues(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return String(a).localeCompare(String(b), 'zh-Hans-CN');
}

// ---------------------------------------------------------------------------
// 层级树：每层节点 = 某个维度在某个父成员上下文中的全部成员
// ---------------------------------------------------------------------------

function buildLevel(rows, chain, depth, mode, globalMembers) {
  const dim = chain[depth];
  const nextDim = depth + 1 < chain.length ? chain[depth + 1] : null;

  const groups = new Map();
  for (const row of rows) {
    const key = valueKey(row[dim.key] ?? null);
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(row);
  }

  const node = { dim, members: [], totalSize: 0, byKey: null };

  for (const globalMember of globalMembers.get(dim.key)) {
    const memberRows = groups.get(globalMember.key);
    if (mode === 'compact' && !memberRows) continue;

    const member = {
      key: globalMember.key,
      value: globalMember.value,
      index: globalMember.index,
      rows: memberRows ?? [],
      children: null,
      offset: 0,
      size: 0,
    };
    member.children = nextDim
      ? buildLevel(member.rows, chain, depth + 1, mode, globalMembers)
      : null;
    member.size = member.children ? member.children.totalSize : 1;
    node.members.push(member);
  }

  let acc = 0;
  for (const member of node.members) {
    member.offset = acc;
    acc += member.size;
  }
  node.totalSize = acc;
  node.byKey = new Map(node.members.map((member) => [member.key, member]));
  return node;
}

function locate(record, root) {
  const path = [];
  let offset = 0;
  let node = root;

  while (node) {
    const key = valueKey(record[node.dim.key] ?? null);
    const member = node.byKey.get(key);
    if (!member) {
      throw new Error(
        `记录在维度 ${node.dim.key} 上找不到成员 ${String(record[node.dim.key])}`,
      );
    }
    offset += member.offset;
    path.push({
      key: node.dim.key,
      value: member.value,
      index: member.index,
      offset: member.offset,
    });
    node = member.children;
  }

  return { offset, path };
}

function axisResult(root, chain) {
  return {
    chain: chain.map((dim) => dim.key),
    length: root.totalSize,
    header: headerOf(root, 0),
  };
}

function headerOf(node, base) {
  return {
    key: node.dim.key,
    axis: node.dim.axis,
    members: node.members.map((member) => ({
      value: member.value,
      index: member.index,
      offset: base + member.offset,
      size: member.size,
      children: member.children ? headerOf(member.children, base + member.offset) : null,
    })),
  };
}
