/**
 * 主页基准测试表格：读取 bench/results.json 并渲染。
 * 结果文件由 `node bench/run.mjs` 生成。
 */

import { normalizeLang, pick } from './i18n.mjs';

const RESULTS_URL = new URL('../bench/results.json', import.meta.url);

export async function renderBenchmark(options = {}) {
  const lang = normalizeLang(options.lang);
  const t = (zh, en) => pick(lang, zh, en);
  const rowsEl = document.querySelector('[data-bench-rows]');
  if (!rowsEl) return;

  const metaEl = document.querySelector('[data-bench-meta]');
  const notesEl = document.querySelector('[data-bench-notes]');

  try {
    const response = await fetch(RESULTS_URL, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    rowsEl.innerHTML = data.results
      .map((result) => resultRow(result, lang))
      .join('');

    if (metaEl) {
      const env = data.environment;
      const date = new Date(data.generatedAt);
      const dateText = Number.isNaN(date.getTime())
        ? ''
        : date.toISOString().slice(0, 10);
      const memory =
        lang === 'en'
          ? `${env.totalMemoryGB} GiB memory (${env.availableMemoryGBAtStart} GiB available)`
          : `${env.totalMemoryGB} GiB 内存（可用 ${env.availableMemoryGBAtStart} GiB）`;
      metaEl.textContent =
        `Node ${env.node} · ${env.cpu} · ${env.cpuCount} vCPU · ` +
        memory +
        (dateText ? ` · ${dateText}` : '');
    }

    if (notesEl) {
      const notes =
        lang === 'en' && Array.isArray(data.notesEn)
          ? data.notesEn
          : (data.notes ?? []);
      notesEl.innerHTML = notes
        .map((note) => `<li>${escapeHtml(note)}</li>`)
        .join('');
    }

    renderSummary(data.results);
  } catch (error) {
    rowsEl.innerHTML =
      `<tr><td colspan="8" class="bench-error">` +
      `${t('基准结果加载失败：', 'Failed to load benchmark results: ')}` +
      `${escapeHtml(error.message)}</td></tr>`;
  }
}

function renderSummary(results) {
  const million = results.find(
    (result) => result.ok && result.rows === 1_000_000 && result.mode === 'single',
  );
  const tenMillion = results.find(
    (result) => result.ok && result.rows === 10_000_000,
  );
  const singlePeaks = results
    .filter((result) => result.ok && result.mode === 'single')
    .map((result) => result.memory.maxRssMB);

  setSummary('million', million ? formatMs(transformTime(million)) : '—');
  setSummary('ten-million', tenMillion ? formatMs(transformTime(tenMillion)) : '—');
  setSummary('peak', singlePeaks.length ? `${Math.max(...singlePeaks).toFixed(0)} MB` : '—');
}

function setSummary(key, text) {
  const target = document.querySelector(`[data-bench-summary="${key}"]`);
  if (target) target.textContent = text;
}

function resultRow(result, lang) {
  if (!result.ok) {
    const prefix = lang === 'en' ? 'Not completed: ' : '未完成：';
    return (
      `<tr><td>${formatRows(result.rows)}</td>` +
      `<td colspan="7" class="bench-error">${prefix}${escapeHtml(result.error)}</td></tr>`
    );
  }

  const mode =
    result.mode === 'chunked'
      ? lang === 'en'
        ? `Chunked · ${formatRows(result.chunkSize)}/chunk`
        : `分片 · ${formatRows(result.chunkSize)}/片`
      : lang === 'en'
        ? 'Single run'
        : '单次';
  const modeClass = result.mode === 'chunked' ? 'chunked' : 'single';

  return `<tr>
    <td><strong>${formatRows(result.rows)}</strong></td>
    <td>${formatMs(result.stages.generateMs)}</td>
    <td>${formatMs(result.stages.aggregateMs)}</td>
    <td>${result.stages.mergeMs === null ? '—' : formatMs(result.stages.mergeMs)}</td>
    <td>${formatMs(result.stages.layoutMs)}</td>
    <td><strong>${formatMs(transformTime(result))}</strong></td>
    <td>${result.memory.maxRssMB.toFixed(1)} MB</td>
    <td><span class="bench-mode bench-mode--${modeClass}">${mode}</span></td>
  </tr>`;
}

function formatMs(value) {
  if (value === null || value === undefined) return '—';
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value.toFixed(1)} ms`;
}

function transformTime(result) {
  return result.stages.transformMs ?? result.stages.totalMs;
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
