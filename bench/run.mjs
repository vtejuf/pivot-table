/**
 * 基准运行器：每个规模启动独立 Node 进程，收集耗时与峰值内存。
 *
 * 用法：
 *   node bench/run.mjs
 *   node bench/run.mjs --sizes 10000,100000
 *
 * 结果写入 bench/results.json，主页的基准测试表格会读取它。
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus, freemem, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { benchmarkConfig } from './config.mjs';

const benchDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(benchDir, '..');
const transformScript = join(benchDir, 'transform.mjs');
const resultsPath = join(benchDir, 'results.json');

const sizesArg = readArg('--sizes');
const requestedSizes = sizesArg
  ? new Set(
      sizesArg
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0),
    )
  : null;

const jobs = [
  { rows: 10_000, mode: 'single', heapMB: 512 },
  { rows: 100_000, mode: 'single', heapMB: 512 },
  { rows: 1_000_000, mode: 'single', heapMB: 1024 },
  // 本机可用内存不足，千万级使用分片聚合；明确标注，不与单次结果混排。
  { rows: 10_000_000, mode: 'chunked', chunkSize: 200_000, heapMB: 512 },
].filter((job) => !requestedSizes || requestedSizes.has(job.rows));

const REPEATS = 3;
const results = [];

for (const job of jobs) {
  const args = [
    '--expose-gc',
    `--max-old-space-size=${job.heapMB}`,
    transformScript,
    '--rows',
    String(job.rows),
    '--mode',
    job.mode,
  ];
  if (job.chunkSize) args.push('--chunk-size', String(job.chunkSize));

  process.stdout.write(
    `${formatRows(job.rows)} · ${job.mode}${job.chunkSize ? ` (${formatRows(job.chunkSize)}/chunk)` : ''} … `,
  );

  const samples = [];
  const failures = [];

  for (let attempt = 1; attempt <= REPEATS; attempt += 1) {
    const startedAt = performance.now();
    const child = spawnSync(process.execPath, args, {
      cwd: root,
      encoding: 'utf8',
      timeout: 900_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const wallMs = performance.now() - startedAt;

    if (child.status !== 0) {
      const reason = child.signal
        ? `signal ${child.signal}`
        : `exit ${child.status}`;
      failures.push({
        reason: `${reason} after ${(wallMs / 1000).toFixed(1)}s`,
        stderr: (child.stderr ?? '').trim().split('\n').slice(-4).join('\n'),
      });
      process.stdout.write('x ');
      continue;
    }

    const jsonLine = child.stdout.trim().split('\n').at(-1);
    try {
      const parsed = JSON.parse(jsonLine);
      samples.push({ ...parsed, wallMs: round(wallMs, 2) });
      process.stdout.write(`${formatMs(parsed.stages.transformMs)} `);
    } catch {
      failures.push({
        reason: '无法解析子进程输出',
        stderr: child.stderr.trim(),
      });
      process.stdout.write('x ');
    }
  }

  if (samples.length === 0) {
    results.push({
      ok: false,
      rows: job.rows,
      mode: job.mode,
      chunkSize: job.chunkSize ?? null,
      error: failures[0]?.reason ?? '没有有效样本',
      stderr: failures[0]?.stderr ?? '',
    });
    console.log('FAILED');
    continue;
  }

  const representative = medianSample(samples);
  results.push({
    ...representative,
    repeats: samples.length,
    samples: samples.map((sample) => ({
      stages: sample.stages,
      memory: sample.memory,
      wallMs: sample.wallMs,
    })),
  });

  console.log(
    `→ median ${formatMs(representative.stages.transformMs)}, ` +
      `${representative.memory.maxRssMB.toFixed(1)} MB peak` +
      (failures.length > 0 ? ` (${failures.length} 次失败)` : ''),
  );
}

function medianSample(samples) {
  const sorted = [...samples].sort(
    (a, b) => a.stages.transformMs - b.stages.transformMs,
  );
  return sorted[Math.floor((sorted.length - 1) / 2)];
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
    cgroupMemoryGB: readCgroupLimitGB(),
  },
  config: benchmarkConfig,
  notes: [
    '每个规模在独立 Node 进程中运行，重复 3 次，取变换耗时中位数的一次作为代表；原始样本保存在 results.json。',
    '变换耗时 = 聚合 + 合并 + 布局，不包含夹具生成；耗时用 performance.now()，内存用 process.memoryUsage() 与 process.resourceUsage().maxRSS。',
    '1,000 万级使用分片聚合（每片 200,000 条），避免一次性持有全部明细；1 万–100 万级是单次 aggregate()。',
    '分片合并逻辑用 bench/verify.mjs 与单次聚合逐组比对，sales / __count / __valueCount 一致。',
    '布局耗时与聚合后的维度组合数相关，这里固定为 1536 个组合，因此不随原始明细数增长。',
  ],
  results,
};

writeFileSync(resultsPath, `${JSON.stringify(payload, null, 2)}\n`);

console.log('');
console.log(
  ['rows', 'mode', 'generate', 'aggregate', 'merge', 'layout', 'transform', 'peak RSS'].join('\t'),
);
for (const result of results) {
  if (!result.ok) {
    console.log(`${formatRows(result.rows)}\t${result.mode}\tFAILED: ${result.error}`);
    continue;
  }
  console.log(
    [
      formatRows(result.rows),
      result.mode,
      formatMs(result.stages.generateMs),
      formatMs(result.stages.aggregateMs),
      result.stages.mergeMs === null ? '—' : formatMs(result.stages.mergeMs),
      formatMs(result.stages.layoutMs),
      formatMs(result.stages.transformMs),
      `${result.memory.maxRssMB.toFixed(1)} MB`,
    ].join('\t'),
  );
}
console.log('');
console.log(`已写入 ${resultsPath}`);

if (results.some((result) => !result.ok)) process.exitCode = 1;

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readCgroupLimitGB() {
  try {
    const raw = readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
    if (raw === 'max') return null;
    const bytes = Number(raw);
    return Number.isFinite(bytes) ? round(bytes / 1024 ** 3, 1) : null;
  } catch {
    return null;
  }
}

function formatRows(rows) {
  return rows.toLocaleString('en-US');
}

function formatMs(value) {
  if (value === null || value === undefined) return '—';
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${value.toFixed(1)} ms`;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
