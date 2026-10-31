/**
 * 数据模型模块入口。
 *
 * 两个业务阶段互相独立：
 * 1. aggregate：明细记录 -> 每个维度组合唯一的多维数据。
 * 2. layoutPivot：多维数据 -> 二维网格坐标与矩阵变换。
 */

export { aggregate, AGGREGATES } from './aggregate.mjs';
export { layoutPivot, AXIS } from './pivot-layout.mjs';
export { valueKey } from './value-key.mjs';
