/**
 * 浏览器示例使用的确定性数据。
 *
 * 单独成模块，便于在 Node 中复用同一份数据验证聚合与布局结果。
 */

import { aggregate } from '../src/model/index.mjs';

export const regionCities = {
  华东: ['上海', '杭州', '南京', '苏州'],
  华北: ['北京', '天津', '青岛', '石家庄'],
  华南: ['广州', '深圳', '厦门', '珠海'],
  西南: ['成都', '重庆', '昆明', '贵阳'],
  华中: ['武汉', '长沙', '郑州', '南昌'],
};

export const years = [2019, 2020, 2021, 2022, 2023, 2024];
export const products = ['手机', '笔记本', '平板'];

export const dimensions = [
  { key: 'region', axis: 'row' },
  { key: 'city', axis: 'row', parent: 'region' },
  { key: 'year', axis: 'col', order: 'asc' },
  { key: 'product', axis: 'col', parent: 'year' },
];

/** 生成明细；每个城市只销售部分产品，compact 模式因此比 cartesian 更紧凑。 */
export function createDetail({
  regionCities: regions = regionCities,
  years: yearList = years,
  products: productList = products,
  seed: initialSeed = 20240607,
} = {}) {
  let seed = initialSeed;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const detail = [];
  for (const [region, cities] of Object.entries(regions)) {
    for (const city of cities) {
      const offered = productList.filter(() => random() > 0.28);
      if (offered.length === 0) offered.push(productList[0]);
      for (const year of yearList) {
        for (const product of offered) {
          const base =
            30 +
            city.length * 14 +
            (year - 2019) * 8 +
            productList.indexOf(product) * 11;
          const orders = 2 + Math.floor(random() * 3);
          for (let i = 0; i < orders; i += 1) {
            detail.push({
              region,
              city,
              year,
              product,
              sales: Math.round(base * (0.5 + random() * 0.9)),
            });
          }
        }
      }
    }
  }
  return detail;
}

export const detail = createDetail();
export const salesCube = aggregate(detail, {
  dimensions,
  measure: { key: 'sales', aggregate: 'sum' },
});
export const countCube = aggregate(detail, { dimensions });

/** 英文站点使用的同构示例数据；维度 key 保持不变，只替换成员取值。 */
export const regionCitiesEn = {
  'East China': ['Shanghai', 'Hangzhou', 'Nanjing', 'Suzhou'],
  'North China': ['Beijing', 'Tianjin', 'Qingdao', 'Shijiazhuang'],
  'South China': ['Guangzhou', 'Shenzhen', 'Xiamen', 'Zhuhai'],
  'Southwest China': ['Chengdu', 'Chongqing', 'Kunming', 'Guiyang'],
  'Central China': ['Wuhan', 'Changsha', 'Zhengzhou', 'Nanchang'],
};

export const productsEn = ['Phone', 'Laptop', 'Tablet'];

export const detailEn = createDetail({
  regionCities: regionCitiesEn,
  products: productsEn,
});

export const salesCubeEn = aggregate(detailEn, {
  dimensions,
  measure: { key: 'sales', aggregate: 'sum' },
});

export const countCubeEn = aggregate(detailEn, { dimensions });
