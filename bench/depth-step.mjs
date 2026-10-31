/**
 * 单个「行深度 / 列深度」组合的变换基准。
 *
 * 固定 100 万条原始明细；每增加一层维度，就多一个 0/1 成员字段。
 * 行维度使用 index 的低 10 位，列维度使用接下来的位，因此：
 *   行网格 = 2^rowDepth，列网格 = 2^colDepth。
 *
 * 用法：
 *   node --expose-gc bench/depth-step.mjs --rows 1000000 --row-depth 10 --col-depth 5
 *   node --expose-gc bench/depth-step.mjs ... --release-rows
 *
 * 输出：最后一行 JSON。
 */

import { aggregate } from '../src/model/aggregate.mjs';
import { layoutPivot } from '../src/model/pivot-layout.mjs';

const args = parseArgs(process.argv.slice(2));
const rowsCount = args.rows;
const rowDepth = args.rowDepth;
const colDepth = args.colDepth;
const releaseRows = args.releaseRows;

const dimensions = [];
for (let depth = 0; depth < rowDepth; depth += 1) {
  dimensions.push({
    key: `r${depth}`,
    axis: 'row',
    ...(depth === 0 ? {} : { parent: `r${depth - 1}` }),
  });
}
for (let depth = 0; depth < colDepth; depth += 1) {
  dimensions.push({
    key: `c${depth}`,
    axis: 'col',
    ...(depth === 0 ? {} : { parent: `c${depth - 1}` }),
  });
}

const measure = { key: 'sales', aggregate: 'sum' };

/**
 * 固定 20 个维度字段的对象形状，避免动态加字段导致对象进入字典模式。
 * 每次实验只激活其中 rowDepth + colDepth 个维度，输入明细规模与内存基线保持一致。
 */
function createRows(count) {
  const rows = new Array(count);
  for (let index = 0; index < count; index += 1) {
    rows[index] = {
      r0: index & 1,
      r1: (index >>> 1) & 1,
      r2: (index >>> 2) & 1,
      r3: (index >>> 3) & 1,
      r4: (index >>> 4) & 1,
      r5: (index >>> 5) & 1,
      r6: (index >>> 6) & 1,
      r7: (index >>> 7) & 1,
      r8: (index >>> 8) & 1,
      r9: (index >>> 9) & 1,
      c0: (index >>> 10) & 1,
      c1: (index >>> 11) & 1,
      c2: (index >>> 12) & 1,
      c3: (index >>> 13) & 1,
      c4: (index >>> 14) & 1,
      c5: (index >>> 15) & 1,
      c6: (index >>> 16) & 1,
      c7: (index >>> 17) & 1,
      c8: (index >>> 18) & 1,
      c9: (index >>> 19) & 1,
      sales: (index % 997) + 1,
    };
  }
  return rows;
}

function snapshot() {
  if (typeof global.gc === 'function') global.gc();
  const memory = process.memoryUsage();
  return {
    heapUsedMB: round(memory.heapUsed / 1048576, 1),
    rssMB: round(memory.rss / 1048576, 1),
  };
}

const baseline = snapshot();

let start = performance.now();
let rows = createRows(rowsCount);
const generateMs = performance.now() - start;
const afterGenerate = snapshot();
console.error(
  `[depth] generated ${rowsCount} rows: ${afterGenerate.heapUsedMB} MB heap, ${afterGenerate.rssMB} MB rss`,
);

start = performance.now();
const cube = aggregate(rows, { dimensions, measure });
const aggregateMs = performance.now() - start;
const afterAggregate = snapshot();
console.error(
  `[depth] aggregated ${cube.rows.length} rows: ${afterAggregate.heapUsedMB} MB heap, ${afterAggregate.rssMB} MB rss`,
);

let afterRelease = null;
if (releaseRows) {
  rows = null;
  afterRelease = snapshot();
  console.error(
    `[depth] released raw rows: ${afterRelease.heapUsedMB} MB heap, ${afterRelease.rssMB} MB rss`,
  );
}

start = performance.now();
const layout = layoutPivot(cube.rows, {
  dimensions,
  value: measure.key,
});
const layoutMs = performance.now() - start;
const afterLayout = snapshot();
console.error(
  `[depth] layout ${layout.size.rows}x${layout.size.cols}: ${afterLayout.heapUsedMB} MB heap, ${afterLayout.rssMB} MB rss`,
);

const memory = process.memoryUsage();
const maxRssMB = round(process.resourceUsage().maxRSS / 1024, 1);

const result = {
  ok: true,
  rows: rowsCount,
  rowDepth,
  colDepth,
  releaseRows,
  stages: {
    generateMs: round(generateMs, 2),
    aggregateMs: round(aggregateMs, 2),
    layoutMs: round(layoutMs, 2),
    transformMs: round(aggregateMs + layoutMs, 2),
    totalMs: round(generateMs + aggregateMs + layoutMs, 2),
  },
  memory: {
    baselineHeapMB: baseline.heapUsedMB,
    generateHeapMB: afterGenerate.heapUsedMB,
    aggregateHeapMB: afterAggregate.heapUsedMB,
    releaseHeapMB: afterRelease?.heapUsedMB ?? null,
    layoutHeapMB: afterLayout.heapUsedMB,
    rssMB: round(memory.rss / 1048576, 1),
    maxRssMB,
  },
  output: {
    cubeRows: cube.rows.length,
    gridRows: layout.size.rows,
    gridCols: layout.size.cols,
    cells: layout.size.rows * layout.size.cols,
    dimensionCount: dimensions.length,
  },
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  },
};

console.log(JSON.stringify(result));

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseArgs(argv) {
  const options = {
    rows: 1_000_000,
    rowDepth: 1,
    colDepth: 0,
    releaseRows: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];

    if (flag === '--rows') {
      options.rows = Number(value);
      i += 1;
    } else if (flag === '--row-depth') {
      options.rowDepth = Number(value);
      i += 1;
    } else if (flag === '--col-depth') {
      options.colDepth = Number(value);
      i += 1;
    } else if (flag === '--release-rows') {
      options.releaseRows = true;
    } else if (flag === '--help') {
      console.log(
        'node --expose-gc bench/depth-step.mjs [--rows N] [--row-depth N] [--col-depth N] [--release-rows]',
      );
      process.exit(0);
    } else {
      throw new Error(`未知参数: ${flag}`);
    }
  }

  if (!Number.isInteger(options.rows) || options.rows <= 0) {
    throw new Error('--rows 必须是正整数');
  }
  if (!Number.isInteger(options.rowDepth) || options.rowDepth < 0) {
    throw new Error('--row-depth 必须是非负整数');
  }
  if (!Number.isInteger(options.colDepth) || options.colDepth < 0) {
    throw new Error('--col-depth 必须是非负整数');
  }
  if (options.rowDepth > 10 || options.colDepth > 10) {
    throw new Error('行深和列深都不能超过 10');
  }
  if (options.rowDepth + options.colDepth > 20) {
    throw new Error('行 + 列深度不能超过 20（数据只提供 20 位）');
  }
  if (options.rowDepth === 0 && options.colDepth === 0) {
    throw new Error('至少需要一个维度');
  }

  return options;
}
