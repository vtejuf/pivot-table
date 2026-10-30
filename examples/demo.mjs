import { aggregate } from '../src/aggregate.mjs';
import { layoutPivot } from '../src/pivot-layout.mjs';

const rows = [
  { region: '华东', city: '杭州', year: 2023, sales: 10 },
  { region: '华东', city: '杭州', year: 2024, sales: 20 },
  { region: '华东', city: '上海', year: 2023, sales: 30 },
  { region: '西南', city: '成都', year: 2023, sales: 40 },
];

const dimensions = [
  { key: 'region', axis: 'row' },
  { key: 'city', axis: 'row', parent: 'region' },
  { key: 'year', axis: 'col', order: 'asc' },
];

const measure = { key: 'sales', aggregate: 'sum' };

function show(title, result) {
  console.log(`\n=== ${title} ===`);
  console.log('网格尺寸:', result.size);
  console.log(
    '矩阵 M:\n' +
      (result.matrix
        ? result.matrix.map((row) => '  ' + JSON.stringify(row)).join('\n')
        : '  （compact 模式没有全局固定矩阵）'),
  );
  console.log('每维基向量:', result.dimensionVectors);
  console.log('坐标:');
  for (const cell of result.cells) {
    console.log(
      `  (x=${cell.x}, y=${cell.y})`,
      JSON.stringify(cell.members),
      '=>',
      cell.value,
    );
  }

  const grid = Array.from({ length: result.size.rows }, () =>
    Array(result.size.cols).fill('·'),
  );
  for (const cell of result.cells) {
    grid[cell.y][cell.x] = String(cell.value);
  }
  console.log('网格:');
  for (const line of grid) console.log('  ' + line.join('\t'));

  console.log('行表头:');
  const walk = (node, depth = 0) => {
    console.log(
      '  '.repeat(depth + 1) +
        `${node.key}: ` +
        node.members
          .map((m) => `${String(m.value)}[offset=${m.offset}, size=${m.size}]`)
          .join(' '),
    );
    for (const member of node.members) {
      if (member.children) {
        console.log('  '.repeat(depth + 2) + `↳ ${String(member.value)} 下:`);
        walk(member.children, depth + 2);
      }
    }
  };
  walk(result.axes.row.header);
}

const cube = aggregate(rows, { dimensions, measure });
console.log('=== 阶段一：聚合 ===');
console.log('聚合后行数:', cube.rows.length);
for (const row of cube.rows) console.log('  ', row);

const cartesian = layoutPivot(cube.rows, { dimensions, value: 'sales' });
show('阶段二：cartesian（笛卡尔：固定矩阵）', cartesian);

const compact = layoutPivot(cube.rows, {
  dimensions,
  value: 'sales',
  mode: 'compact',
});
show('阶段二：compact（紧凑：变长块）', compact);

// 一条记录、三个属性：先聚合成 count，再显式配置 a > b > c 行轴链
const tinyDimensions = [
  { key: 'a', axis: 'row' },
  { key: 'b', axis: 'row', parent: 'a' },
  { key: 'c', axis: 'row', parent: 'b' },
];
const tinyCube = aggregate([{ a: 1, b: 2, c: 3 }], {
  dimensions: tinyDimensions,
});
const tiny = layoutPivot(tinyCube.rows, {
  dimensions: tinyCube.dimensions,
  value: tinyCube.measure.key,
});
console.log('\n=== 单条 {a,b,c} ===');
console.log('聚合数据:', tinyCube.rows);
console.log('维度链:', tiny.axes.row.chain);
console.log('矩阵:', tiny.matrix);
console.log('单元格:', tiny.cells[0]);
