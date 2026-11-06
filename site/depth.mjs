/**
 * 维度深度实验表格：读取 bench/depth-results.json。
 * 结果由 `node bench/depth-run.mjs` 生成。
 */

import { normalizeLang, pick } from './i18n.mjs';

const RESULTS_URL = new URL('../bench/depth-results.json', import.meta.url);

export async function renderDepthExperiment(options = {}) {
  const lang = normalizeLang(options.lang);
  const t = (zh, en) => pick(lang, zh, en);
  const rowsEl = document.querySelector('[data-depth-rows]');
  if (!rowsEl) return;

  const colsEl = document.querySelector('[data-depth-cols]');
  const metaEl = document.querySelector('[data-depth-meta]');
  const notesEl = document.querySelector('[data-depth-notes]');
  const stopEl = document.querySelector('[data-depth-stop]');

  try {
    const response = await fetch(RESULTS_URL, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    const threshold = data.config?.matrixThresholdMs ?? 3000;
    const steps = data.steps ?? [];
    const rowSteps = steps.filter((step) => step.phase === 'row');
    const colSteps = steps.filter((step) => step.phase === 'col');

    rowsEl.innerHTML =
      rowSteps
        .map((step) => depthRow(step, threshold, data.config?.heapMB, lang))
        .join('') || emptyRow(lang);
    colsEl.innerHTML =
      colSteps
        .map((step) => depthRow(step, threshold, data.config?.heapMB, lang))
        .join('') || emptyRow(lang);

    const completed = steps.filter((step) => step.ok);
    const last = completed.at(-1);
    setSummary('last', last ? `${last.rowDepth} / ${last.colDepth}` : '—');
    setSummary(
      'matrix',
      last ? formatMs(last.stages.layoutMs) : '—',
    );
    setSummary(
      'memory',
      last ? `${last.memory.maxRssMB.toFixed(1)} MB` : '—',
    );

    if (stopEl) {
      stopEl.textContent = stopText(data, lang);
      stopEl.className = `depth-stop ${stopClass(data.stop?.reason)}`;
    }

    if (metaEl) metaEl.textContent = metaText(data, lang);

    if (notesEl) {
      const notes =
        lang === 'en' && Array.isArray(data.notesEn)
          ? data.notesEn
          : (data.notes ?? []);
      notesEl.innerHTML = notes
        .map((note) => `<li>${escapeHtml(note)}</li>`)
        .join('');
    }
  } catch (error) {
    const message = escapeHtml(error.message);
    rowsEl.innerHTML = errorRow(message);
    if (colsEl) colsEl.innerHTML = errorRow(message);
    if (stopEl) {
      stopEl.textContent = t(
        `深度实验结果加载失败：${message}`,
        `Failed to load depth experiment results: ${message}`,
      );
      stopEl.className = 'depth-stop is-error';
    }
  }
}

function depthRow(result, threshold, heapMB, lang) {
  if (!result.ok) {
    const failed = lang === 'en' ? 'Not completed' : '未完成';
    const heap =
      lang === 'en'
        ? `(heap limit)`
        : '（堆上限）';
    return `<tr class="depth-failed">
      <td><strong>${result.rowDepth}</strong></td>
      <td>${result.colDepth}</td>
      <td colspan="3">${escapeHtml(result.error ?? failed)}</td>
      <td>≥ ${heapMB ?? '?'} MB ${heap}</td>
      <td>${failed}</td>
    </tr>`;
  }

  const over = result.stages.layoutMs > threshold;
  const ratio = Math.min(
    100,
    Math.max(2, (result.stages.layoutMs / threshold) * 100),
  );

  return `<tr>
    <td><strong>${result.rowDepth}</strong></td>
    <td>${result.colDepth}</td>
    <td>${formatMs(result.stages.aggregateMs)}</td>
    <td>
      <div class="depth-time">
        <span class="depth-time__value">${formatMs(result.stages.layoutMs)}</span>
        <span class="depth-bar" aria-hidden="true">
          <i class="${over ? 'is-over' : ''}" style="width:${ratio.toFixed(1)}%"></i>
        </span>
      </div>
    </td>
    <td>${formatMs(result.stages.transformMs)}</td>
    <td>${result.memory.maxRssMB.toFixed(1)} MB</td>
    <td>${formatRows(result.output.cubeRows)} ${lang === 'en' ? 'rows' : '行'} / ${formatRows(result.output.cells)} ${lang === 'en' ? 'cells' : '格'}</td>
  </tr>`;
}

function emptyRow(lang) {
  return `<tr><td colspan="7">${lang === 'en' ? 'No records for this phase.' : '没有该阶段的记录。'}</td></tr>`;
}

function errorRow(message) {
  return `<tr><td colspan="7" class="bench-error">${message}</td></tr>`;
}

function setSummary(key, text) {
  const target = document.querySelector(`[data-depth-summary="${key}"]`);
  if (target) target.textContent = text;
}

function stopText(data, lang) {
  const stop = data.stop;
  const at = stop?.at;
  const where = at
    ? lang === 'en'
      ? `row ${at.rowDepth} / col ${at.colDepth}`
      : `行 ${at.rowDepth} / 列 ${at.colDepth}`
    : lang === 'en'
      ? 'the current combination'
      : '当前组合';

  if (stop?.reason === 'memory') {
    return lang === 'en'
      ? `Stopped by the memory limit: ${where} OOMed on a ${data.config?.heapMB ?? '?'} MB heap. ` +
          'The matrix transform did not finish, so the 3-second threshold was not reached.'
      : `内存受限停止：${where} 在 ${data.config?.heapMB ?? '?'} MB 堆上 OOM。` +
          '矩阵变换未完成，3 秒阈值没有被测到。';
  }

  if (stop?.reason === 'time') {
    const step = (data.steps ?? []).find(
      (item) =>
        item.ok &&
        item.rowDepth === at?.rowDepth &&
        item.colDepth === at?.colDepth,
    );
    return lang === 'en'
      ? `Threshold reached: the matrix transform for ${where} took ${formatMs(step?.stages.layoutMs)}, ` +
          `exceeding ${formatMs(data.config?.matrixThresholdMs)}; the experiment stopped.`
      : `达到阈值：${where} 的矩阵变换耗时 ${formatMs(step?.stages.layoutMs)}，` +
          `超过 ${formatMs(data.config?.matrixThresholdMs)}，实验停止。`;
  }

  if (stop?.reason === 'complete') {
    return lang === 'en'
      ? 'Row and column depth both reached 10; the experiment is complete.'
      : '行列深度都达到 10，实验完成。';
  }

  if (lang === 'en') return 'Experiment stopped.';
  return stop?.message ?? '实验停止。';
}

function stopClass(reason) {
  if (reason === 'time') return 'is-time';
  if (reason === 'complete') return 'is-complete';
  return 'is-error';
}

function metaText(data, lang) {
  const env = data.environment;
  const config = data.config;
  const date = new Date(data.generatedAt);
  const dateText = Number.isNaN(date.getTime())
    ? ''
    : date.toISOString().slice(0, 10);

  const details =
    lang === 'en'
      ? `${env.totalMemoryGB} GiB memory · ` +
        `${formatRows(config.rows)} rows/step · heap limit ${config.heapMB} MB · ` +
        `single run${dateText ? ` · ${dateText}` : ''}`
      : `${env.totalMemoryGB} GiB 内存 · ` +
        `${formatRows(config.rows)} 条/步 · 堆上限 ${config.heapMB} MB · ` +
        `单次运行${dateText ? ` · ${dateText}` : ''}`;

  return `Node ${env.node} · ${env.cpu} · ${env.cpuCount} vCPU · ${details}`;
}

function formatMs(value) {
  if (value === null || value === undefined) return '—';
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value.toFixed(1)} ms`;
}

function formatRows(value) {
  return Number(value).toLocaleString('en-US');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
