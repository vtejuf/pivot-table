/**
 * 维度深度扫描：先加行维度（1..10，列深度 0），再加列维度（行深度 10，1..10）。
 * 每个组合独立 Node 进程；变换耗时超过阈值或进程失败时停止。
 *
 * 用法：
 *   node bench/depth-run.mjs
 *   node bench/depth-run.mjs --release-rows   # 聚合后释放原始明细，降低后续布局内存
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus, freemem, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const benchDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(benchDir, '..');
const stepScript = join(benchDir, 'depth-step.mjs');
const resultsPath = join(benchDir, 'depth-results.json');

const args = parseArgs(process.argv.slice(2));
const rowsCount = args.rows;
const maxDepth = args.maxDepth;
const thresholdMs = args.threshold;
const heapMB = args.heap;
const releaseRows = args.releaseRows;

const steps = [];
for (let depth = 1; depth <= maxDepth; depth += 1) {
  steps.push({ phase: 'row', rowDepth: depth, colDepth: 0 });
}
for (let depth = 1; depth <= maxDepth; depth += 1) {
  steps.push({ phase: 'col', rowDepth: maxDepth, colDepth: depth });
}

const results = [];
let stop = { reason: 'complete', message: '已完成全部深度组合', at: null };

console.log(
  `rows=${rowsCount.toLocaleString('en-US')} maxDepth=${maxDepth} threshold=${thresholdMs}ms heap=${heapMB}MB releaseRows=${releaseRows}`,
);

for (const step of steps) {
  const label = `row=${step.rowDepth} col=${step.colDepth}`;
  process.stdout.write(`${step.phase.padEnd(3)} ${label.padEnd(14)} … `);

  const childArgs = [
    '--expose-gc',
    `--max-old-space-size=${heapMB}`,
    stepScript,
    '--rows',
    String(rowsCount),
    '--row-depth',
    String(step.rowDepth),
    '--col-depth',
    String(step.colDepth),
  ];
  if (releaseRows) childArgs.push('--release-rows');

  const startedAt = performance.now();
  const child = spawnSync(process.execPath, childArgs, {
    cwd: root,
    encoding: 'utf8',
    timeout: 300_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const wallMs = performance.now() - startedAt;

  if (child.status !== 0) {
    const reason = child.signal ? `signal ${child.signal}` : `exit ${child.status}`;
    const stderr = (child.stderr ?? '').trim();
    const isMemory =
      /heap out of memory|Allocation failed/i.test(stderr) ||
      child.signal === 'SIGABRT';
    const error = isMemory
      ? `内存不足（${(wallMs / 1000).toFixed(1)} 秒后失败）`
      : `${reason} after ${(wallMs / 1000).toFixed(1)}s`;
    results.push({
      ok: false,
      phase: step.phase,
      rowDepth: step.rowDepth,
      colDepth: step.colDepth,
      error,
      wallMs: round(wallMs, 2),
      stderr: stderr.split('\n').slice(-6).join('\n'),
    });
    stop = {
      reason: isMemory ? 'memory' : 'error',
      message: isMemory
        ? '堆内存不足，未能完成该深度组合'
        : `进程失败：${error}`,
      at: { rowDepth: step.rowDepth, colDepth: step.colDepth },
    };
    console.log(`FAILED (${isMemory ? 'OOM' : reason})`);
    break;
  }

  const jsonLine = child.stdout.trim().split('\n').at(-1);
  let parsed;
  try {
    parsed = JSON.parse(jsonLine);
  } catch {
    const error = '无法解析子进程输出';
    results.push({
      ok: false,
      phase: step.phase,
      rowDepth: step.rowDepth,
      colDepth: step.colDepth,
      error,
      stderr: (child.stderr ?? '').trim(),
    });
    stop = {
      reason: 'error',
      message: error,
      at: { rowDepth: step.rowDepth, colDepth: step.colDepth },
    };
    console.log('FAILED (invalid output)');
    break;
  }

  const result = { ...parsed, phase: step.phase, wallMs: round(wallMs, 2) };
  results.push(result);
  console.log(
    `${formatMs(result.stages.layoutMs)} matrix, ${formatMs(result.stages.transformMs)} total, ` +
      `${result.memory.maxRssMB.toFixed(1)} MB peak, ` +
      `${result.output.cubeRows.toLocaleString('en-US')} rows / ${result.output.cells.toLocaleString('en-US')} cells`,
  );

  if (result.stages.layoutMs > thresholdMs) {
    stop = {
      reason: 'time',
      message: `矩阵变换耗时 ${formatMs(result.stages.layoutMs)} 超过 ${formatMs(thresholdMs)} 阈值`,
      at: { rowDepth: step.rowDepth, colDepth: step.colDepth },
    };
    break;
  }
}

const payload = {
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: cpus()[0]?.model ?? 'unknown',
    cpuCount: cpus().length,
    totalMemoryGB: round(totalmem() / 1024 ** 3, 1),
    availableMemoryGBAtStart: round(freemem() / 1024 ** 3, 1),
  },
  config: {
    rows: rowsCount,
    maxDepth,
    matrixThresholdMs: thresholdMs,
    dimensionValueCount: 2,
    layout: 'cartesian',
    measure: 'sales · sum',
    order: '先增加行深度 1..10（列深 0），再增加列深度 1..10（行深 10）',
    stopRule:
      '矩阵变换（layoutPivot）耗时 > 3s 或行列深度全部达到 10；进程内存不足也会停止',
    releaseRows,
    heapMB,
  },
  notes: [
    '每个深度组合使用独立 Node 进程，固定 100 万条原始明细；变换合计 = 聚合 + 布局，不含数据生成。',
    '停止条件使用矩阵变换（layoutPivot）耗时，聚合耗时单独记录；这对应“矩阵变换”本身的成本。',
    '固定 20 个维度字段的对象形状，每次只激活 rowDepth + colDepth 个维度；每层 2 个成员，行网格 = 2^行深，列网格 = 2^列深。',
    '每个组合只运行一次；深度扫描用于观察趋势，不是稳定的微基准。',
    '峰值内存为 process.resourceUsage().maxRSS；原始明细在布局阶段继续驻留，内存包含完整流水线。',
  ],
  notesEn: [
    'Each depth combination uses its own Node process with 1M detail rows fixed; transform total = aggregate + layout, excluding data generation.',
    'The stop condition uses matrix transform (layoutPivot) time; aggregation time is recorded separately because this measures the matrix transform itself.',
    'The input object always has 20 dimension fields, and only rowDepth + colDepth are active at a time. Each level has 2 members, so the row grid = 2^rowDepth and the column grid = 2^colDepth.',
    'Each combination runs once; the depth sweep shows trends and is not a stable micro-benchmark.',
    'Peak memory is process.resourceUsage().maxRSS; detail rows stay resident during layout, so memory covers the full pipeline.',
  ],
  stop,
  steps: results,
};

writeFileSync(resultsPath, `${JSON.stringify(payload, null, 2)}\n`);

console.log('');
console.log(
  ['phase', 'row', 'col', 'generate', 'aggregate', 'layout', 'transform', 'peak RSS', 'rows', 'cells'].join('\t'),
);
for (const result of results) {
  if (!result.ok) {
    console.log(
      `${result.phase}\t${result.rowDepth}\t${result.colDepth}\tFAILED: ${result.error}`,
    );
    continue;
  }
  console.log(
    [
      result.phase,
      result.rowDepth,
      result.colDepth,
      formatMs(result.stages.generateMs),
      formatMs(result.stages.aggregateMs),
      formatMs(result.stages.layoutMs),
      formatMs(result.stages.transformMs),
      `${result.memory.maxRssMB.toFixed(1)} MB`,
      result.output.cubeRows.toLocaleString('en-US'),
      result.output.cells.toLocaleString('en-US'),
    ].join('\t'),
  );
}
console.log('');
console.log(`停止原因：${stop.message}`);
console.log(`已写入 ${resultsPath}`);

if (stop.reason === 'error') process.exitCode = 1;

function parseArgs(argv) {
  const options = {
    rows: 1_000_000,
    maxDepth: 10,
    threshold: 3000,
    heap: 768,
    releaseRows: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];

    if (flag === '--rows') {
      options.rows = Number(value);
      i += 1;
    } else if (flag === '--max-depth') {
      options.maxDepth = Number(value);
      i += 1;
    } else if (flag === '--threshold') {
      options.threshold = Number(value);
      i += 1;
    } else if (flag === '--heap') {
      options.heap = Number(value);
      i += 1;
    } else if (flag === '--release-rows') {
      options.releaseRows = true;
    } else if (flag === '--help') {
      console.log(
        'node bench/depth-run.mjs [--rows N] [--max-depth N] [--threshold MS] [--heap MB] [--release-rows]',
      );
      process.exit(0);
    } else {
      throw new Error(`未知参数: ${flag}`);
    }
  }

  if (!Number.isInteger(options.rows) || options.rows <= 0) {
    throw new Error('--rows 必须是正整数');
  }
  if (!Number.isInteger(options.maxDepth) || options.maxDepth < 1 || options.maxDepth > 10) {
    throw new Error('--max-depth 必须在 1..10');
  }
  if (!Number.isFinite(options.threshold) || options.threshold <= 0) {
    throw new Error('--threshold 必须是正数');
  }
  if (!Number.isInteger(options.heap) || options.heap < 256) {
    throw new Error('--heap 必须是 >= 256 的整数');
  }

  return options;
}

function formatMs(value) {
  if (value === null || value === undefined) return '—';
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value.toFixed(1)} ms`;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
