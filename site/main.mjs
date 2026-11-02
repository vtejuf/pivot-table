import { createPivotDemo } from './demo.mjs';
import { initCodeExamples } from './code-tabs.mjs';
import { renderBenchmark } from './bench.mjs';
import { renderDepthExperiment } from './depth.mjs';

/* -------------------------------------------------------------------------- */
/* 侧栏导航高亮                                                               */
/* -------------------------------------------------------------------------- */

const sections = [...document.querySelectorAll('main section[id]')];
const navLinks = new Map();

for (const link of document.querySelectorAll('.site-nav__link')) {
  const id = link.getAttribute('href')?.replace(/^#/, '');
  if (id) navLinks.set(id, link);
}

function updateActiveNav() {
  if (sections.length === 0) return;

  const marker = window.innerHeight * 0.3;
  let current = sections[0];
  for (const section of sections) {
    if (section.getBoundingClientRect().top <= marker) current = section;
  }

  for (const [id, link] of navLinks) {
    const active = id === current.id;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

let navFrame = 0;
window.addEventListener(
  'scroll',
  () => {
    if (navFrame) return;
    navFrame = requestAnimationFrame(() => {
      updateActiveNav();
      navFrame = 0;
    });
  },
  { passive: true },
);
window.addEventListener('resize', updateActiveNav);
updateActiveNav();

/* -------------------------------------------------------------------------- */
/* Demo                                                                       */
/* -------------------------------------------------------------------------- */

const compactViewport = window.matchMedia('(max-width: 720px)');

try {
  createPivotDemo(document, {
    height: () => (compactViewport.matches ? 420 : 540),
  });
} catch (error) {
  console.error(error);
  const target = document.querySelector('[data-demo-error]');
  if (target) {
    target.hidden = false;
    target.textContent = `Demo 初始化失败：${error.message}`;
  }
}

initCodeExamples();

renderBenchmark();
renderDepthExperiment();
