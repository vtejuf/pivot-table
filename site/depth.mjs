/**
 * 维度深度实验表格：读取 bench/depth-results.json。
 * 结果由 `node bench/depth-run.mjs` 生成。
 */

const RESULTS_URL = new URL('../bench/depth-results.json', import.meta.url);

export async function renderDepthExperiment() {
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
      rowSteps.map((step) => depthRow(step, threshold, data.config?.heapMB)).join('') ||
      emptyRow();
    colsEl.innerHTML =
      colSteps.map((step) => depthRow(step, threshold, data.config?.heapMB)).join('') ||
      emptyRow();

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
      stopEl.textContent = stopText(data);
      stopEl.className = `depth-stop ${stopClass(data.stop?.reason)}`;
    }

    if (metaEl) metaEl.textContent = metaText(data);

    if (notesEl) {
      notesEl.innerHTML = (data.notes ?? [])
        .map((note) => `<li>${escapeHtml(note)}</li>`)
        .join('');
    }
  } catch (error) {
    const message = escapeHtml(error.message);
    rowsEl.innerHTML = errorRow(message);
    if (colsEl) colsEl.innerHTML = errorRow(message);
    if (stopEl) {
      stopEl.textContent = `深度实验结果加载失败：${message}`;
      stopEl.className = 'depth-stop is-error';
    }
  }
}

function depthRow(result, threshold, heapMB) {
  if (!result.ok) {
    return `<tr class="depth-failed">
      <td><strong>${result.rowDepth}</strong></td>
      <td>${result.colDepth}</td>
      <td colspan="3">${escapeHtml(result.error ?? '未完成')}</td>
      <td>≥ ${heapMB ?? '?'} MB（堆上限）</td>
      <td>未完成</td>
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
    <td>${formatRows(result.output.cubeRows)} 行 / ${formatRows(result.output.cells)} 格</td>
  </tr>`;
}

function emptyRow() {
  return '<tr><td colspan="7">没有该阶段的记录。</td></tr>';
}

function errorRow(message) {
  return `<tr><td colspan="7" class="bench-error">${message}</td></tr>`;
}

function setSummary(key, text) {
  const target = document.querySelector(`[data-depth-summary="${key}"]`);
  if (target) target.textContent = text;
}

function stopText(data) {
  const stop = data.stop;
  const at = stop?.at;
  const where = at ? `行 ${at.rowDepth} / 列 ${at.colDepth}` : '当前组合';

  if (stop?.reason === 'memory') {
    return (
      `内存受限停止：${where} 在 ${data.config?.heapMB ?? '?'} MB 堆上 OOM。` +
      '矩阵变换未完成，3 秒阈值没有被测到。'
    );
  }

  if (stop?.reason === 'time') {
    const step = (data.steps ?? []).find(
      (item) =>
        item.ok &&
        item.rowDepth === at?.rowDepth &&
        item.colDepth === at?.colDepth,
    );
    return (
      `达到阈值：${where} 的矩阵变换耗时 ${formatMs(step?.stages.layoutMs)}，` +
      `超过 ${formatMs(data.config?.matrixThresholdMs)}，实验停止。`
    );
  }

  if (stop?.reason === 'complete') {
    return '行列深度都达到 10，实验完成。';
  }

  return stop?.message ?? '实验停止。';
}

function stopClass(reason) {
  if (reason === 'time') return 'is-time';
  if (reason === 'complete') return 'is-complete';
  return 'is-error';
}

function metaText(data) {
  const env = data.environment;
  const config = data.config;
  const date = new Date(data.generatedAt);
  const dateText = Number.isNaN(date.getTime())
    ? ''
    : date.toISOString().slice(0, 10);

  return (
    `Node ${env.node} · ${env.cpu} · ${env.cpuCount} vCPU · ` +
    `${env.totalMemoryGB} GiB 内存 · ` +
    `${formatRows(config.rows)} 条/步 · 堆上限 ${config.heapMB} MB · ` +
    `单次运行${dateText ? ` · ${dateText}` : ''}`
  );
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
