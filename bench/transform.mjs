/**
 * 单个规模的变换基准。
 *
 * 原始明细 -> aggregate() -> layoutPivot()。每个规模由 bench/run.mjs
 * 放到独立 Node 进程中运行，方便用 process.resourceUsage().maxRSS 读取峰值。
 *
 * 用法：
 *   node --expose-gc bench/transform.mjs --rows 1000000
 *   node --expose-gc bench/transform.mjs --rows 10000000 --mode chunked --chunk-size 200000
 *
 * 输出：最后一行 JSON。
 */

import { aggregate } from '../src/model/aggregate.mjs';
import { layoutPivot } from '../src/model/pivot-layout.mjs';
import { dimensions, measure } from './config.mjs';
import { createChunk, mergePartialRows } from './generate.mjs';

const args = parseArgs(process.argv.slice(2));
const rowsCount = args.rows;
const mode = args.mode;
const chunkSize = args.chunkSize;

function snapshot() {
  if (typeof global.gc === 'function') global.gc();
  const memory = process.memoryUsage();
  return {
    heapUsedMB: round(memory.heapUsed / 1048576, 1),
    rssMB: round(memory.rss / 1048576, 1),
  };
}

function runSingle() {
  const baseline = snapshot();

  let start = performance.now();
  const rows = createChunk(0, rowsCount);
  const generateMs = performance.now() - start;
  const afterGenerate = snapshot();

  start = performance.now();
  const cube = aggregate(rows, { dimensions, measure });
  const aggregateMs = performance.now() - start;
  const afterAggregate = snapshot();

  start = performance.now();
  const layout = layoutPivot(cube.rows, {
    dimensions,
    value: measure.key,
  });
  const layoutMs = performance.now() - start;
  const afterLayout = snapshot();

  return {
    ok: true,
    rows: rowsCount,
    mode: 'single',
    chunkSize: null,
    stages: {
      generateMs: round(generateMs, 2),
      aggregateMs: round(aggregateMs, 2),
      mergeMs: null,
      layoutMs: round(layoutMs, 2),
      transformMs: round(aggregateMs + layoutMs, 2),
      totalMs: round(generateMs + aggregateMs + layoutMs, 2),
    },
    memory: {
      baselineHeapMB: baseline.heapUsedMB,
      generateHeapMB: afterGenerate.heapUsedMB,
      aggregateHeapMB: afterAggregate.heapUsedMB,
      layoutHeapMB: afterLayout.heapUsedMB,
      baselineRssMB: baseline.rssMB,
      maxRssMB: maxRssMB(),
    },
    output: {
      cubeRows: cube.rows.length,
      gridRows: layout.size.rows,
      gridCols: layout.size.cols,
      cells: layout.size.rows * layout.size.cols,
    },
    runtime: runtimeInfo(),
  };
}

function runChunked() {
  const baseline = snapshot();
  const groups = new Map();
  let generateMs = 0;
  let aggregateMs = 0;
  let mergeMs = 0;

  for (let offset = 0; offset < rowsCount; offset += chunkSize) {
    const count = Math.min(chunkSize, rowsCount - offset);

    let start = performance.now();
    const chunk = createChunk(offset, count);
    generateMs += performance.now() - start;

    start = performance.now();
    const partial = aggregate(chunk, { dimensions, measure });
    aggregateMs += performance.now() - start;

    start = performance.now();
    mergePartialRows(groups, partial.rows);
    mergeMs += performance.now() - start;
  }

  const mergedRows = [...groups.values()];
  const afterAggregate = snapshot();

  const layoutStart = performance.now();
  const layout = layoutPivot(mergedRows, {
    dimensions,
    value: measure.key,
  });
  const layoutMs = performance.now() - layoutStart;
  const afterLayout = snapshot();

  return {
    ok: true,
    rows: rowsCount,
    mode: 'chunked',
    chunkSize,
    stages: {
      generateMs: round(generateMs, 2),
      aggregateMs: round(aggregateMs, 2),
      mergeMs: round(mergeMs, 2),
      layoutMs: round(layoutMs, 2),
      transformMs: round(aggregateMs + mergeMs + layoutMs, 2),
      totalMs: round(generateMs + aggregateMs + mergeMs + layoutMs, 2),
    },
    memory: {
      baselineHeapMB: baseline.heapUsedMB,
      generateHeapMB: null,
      aggregateHeapMB: afterAggregate.heapUsedMB,
      layoutHeapMB: afterLayout.heapUsedMB,
      baselineRssMB: baseline.rssMB,
      maxRssMB: maxRssMB(),
    },
    output: {
      cubeRows: mergedRows.length,
      gridRows: layout.size.rows,
      gridCols: layout.size.cols,
      cells: layout.size.rows * layout.size.cols,
    },
    runtime: runtimeInfo(),
  };
}

function maxRssMB() {
  return round(process.resourceUsage().maxRSS / 1024, 1);
}

function runtimeInfo() {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  };
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseArgs(argv) {
  const options = {
    rows: 10_000,
    mode: 'single',
    chunkSize: 200_000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];

    if (flag === '--rows') {
      options.rows = Number(value);
      i += 1;
    } else if (flag === '--mode') {
      options.mode = value;
      i += 1;
    } else if (flag === '--chunk-size') {
      options.chunkSize = Number(value);
      i += 1;
    } else if (flag === '--help') {
      console.log(
        'node --expose-gc bench/transform.mjs [--rows N] [--mode single|chunked] [--chunk-size N]',
      );
      process.exit(0);
    } else {
      throw new Error(`未知参数: ${flag}`);
    }
  }

  if (!Number.isInteger(options.rows) || options.rows <= 0) {
    throw new Error('--rows 必须是正整数');
  }
  if (options.mode !== 'single' && options.mode !== 'chunked') {
    throw new Error("--mode 只能是 'single' 或 'chunked'");
  }
  if (!Number.isInteger(options.chunkSize) || options.chunkSize <= 0) {
    throw new Error('--chunk-size 必须是正整数');
  }

  return options;
}

const result = mode === 'single' ? runSingle() : runChunked();
console.log(JSON.stringify(result));
