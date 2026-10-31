/** 基准数据生成与分片合并，transform 与 verify 共用。 */

import { combinations, members } from './config.mjs';

const regionNames = Array.from({ length: members.regions }, (_, i) => `R${i}`);
const cityNames = Array.from({ length: members.cities }, (_, i) => `C${i}`);
const productNames = Array.from({ length: members.products }, (_, i) => `P${i}`);

const cityStride = members.regions;
const yearStride = members.regions * members.cities;
const productStride = yearStride * members.years;

/** 生成连续区间 [start, start + count) 的明细记录。 */
export function createChunk(start, count) {
  const rows = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const index = start + i;
    const combo = index % combinations;
    rows[i] = {
      region: regionNames[combo % members.regions],
      city: cityNames[Math.floor(combo / cityStride) % members.cities],
      year: 2019 + (Math.floor(combo / yearStride) % members.years),
      product:
        productNames[
          Math.floor(combo / productStride) % members.products
        ],
      sales: (index % 997) + 1,
    };
  }
  return rows;
}

/** 把一次 aggregate 的部分结果合并进同一个分组表，语义等价于单次聚合。 */
export function mergePartialRows(groups, partialRows) {
  for (const row of partialRows) {
    const key = `${row.region}|${row.city}|${row.year}|${row.product}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        region: row.region,
        city: row.city,
        year: row.year,
        product: row.product,
        sales: 0,
        __count: 0,
        __valueCount: 0,
      };
      groups.set(key, group);
    }
    group.sales += row.sales;
    group.__count += row.__count;
    group.__valueCount += row.__valueCount;
  }
}
