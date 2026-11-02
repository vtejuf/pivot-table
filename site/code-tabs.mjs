/**
 * 主页「按功能查看示例」的 tab 控制器。
 *
 * 数据来自 site/code-examples.mjs；只依赖浏览器 DOM，不引入运行时依赖。
 * 没有 JavaScript 时，页面保留 <noscript> 提示。
 */

import { codeExamples } from './code-examples.mjs';

export function initCodeExamples(root = document) {
  const container = root.querySelector('[data-code-examples]');
  if (!container) return null;

  container.replaceChildren();

  const tablist = document.createElement('div');
  tablist.className = 'code-tabs__list';
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', '按功能查看示例');

  const tabs = new Map();
  const panels = new Map();

  codeExamples.forEach((example, index) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'code-tabs__tab';
    tab.id = `code-tab-${example.id}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
    tab.setAttribute('aria-controls', `code-panel-${example.id}`);
    tab.tabIndex = index === 0 ? 0 : -1;
    tab.textContent = example.label;
    tablist.append(tab);
    tabs.set(example.id, tab);

    const panel = document.createElement('div');
    panel.className = 'code-card code-tabs__panel';
    panel.id = `code-panel-${example.id}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    panel.tabIndex = 0;
    panel.hidden = index !== 0;

    const bar = document.createElement('div');
    bar.className = 'code-card__bar';
    const file = document.createElement('span');
    file.textContent = example.file;

    const actions = document.createElement('div');
    actions.className = 'code-tabs__actions';
    const status = document.createElement('span');
    status.className = 'code-card__copy-status';
    status.setAttribute('aria-live', 'polite');
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'code-card__copy';
    copy.textContent = '复制';
    copy.setAttribute('aria-label', `复制${example.label}示例`);
    copy.addEventListener('click', () => {
      copyCode(example.code, status);
    });
    actions.append(status, copy);
    bar.append(file, actions);

    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = example.code;
    pre.append(code);

    const note = document.createElement('p');
    note.className = 'code-tabs__note';
    note.textContent = example.note;

    panel.append(bar, pre, note);
    container.append(panel);
    panels.set(example.id, panel);
  });

  container.prepend(tablist);

  const activate = (id, focus = false) => {
    for (const [key, tab] of tabs) {
      const active = key === id;
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.tabIndex = active ? 0 : -1;
      panels.get(key).hidden = !active;
    }
    if (focus) tabs.get(id)?.focus();
  };

  tablist.addEventListener('click', (event) => {
    const tab = event.target.closest?.('[role="tab"]');
    if (!tab || !tab.id.startsWith('code-tab-')) return;
    activate(tab.id.slice('code-tab-'.length));
  });

  tablist.addEventListener('keydown', (event) => {
    const ids = codeExamples.map((example) => example.id);
    const current = ids.findIndex(
      (id) => tabs.get(id).getAttribute('aria-selected') === 'true',
    );

    let next = current;
    switch (event.key) {
      case 'ArrowLeft':
        next = (current - 1 + ids.length) % ids.length;
        break;
      case 'ArrowRight':
        next = (current + 1) % ids.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = ids.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    activate(ids[next], true);
  });

  return {
    activate,
    destroy() {
      container.replaceChildren();
    },
  };
}

async function copyCode(text, status) {
  try {
    await writeClipboard(text);
    flash(status, '已复制');
  } catch {
    flash(status, '复制失败');
  }
}

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 权限或非安全上下文失败时退回 execCommand。
    }
  }
  legacyCopy(text);
}

function legacyCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();

  const copied = document.execCommand('copy');
  area.remove();
  if (!copied) throw new Error('复制失败');
}

function flash(status, message) {
  clearTimeout(status._copyTimer);
  status.textContent = message;
  status._copyTimer = setTimeout(() => {
    status.textContent = '';
  }, 1600);
}
