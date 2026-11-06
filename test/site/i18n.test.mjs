import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { localeOf, normalizeLang, pick } from '../../site/i18n.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const zhHtml = readFileSync(`${root}index.html`, 'utf8');
const enHtml = readFileSync(`${root}index.en.html`, 'utf8');

function collectIds(html) {
  return [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]).sort();
}

function collectDataAttributes(html) {
  return [
    ...new Set(
      [...html.matchAll(/\b(data-[a-z0-9-]+)/g)].map((match) => match[1]),
    ),
  ].sort();
}

test('语言判断与文案选择', () => {
  assert.equal(normalizeLang('en'), 'en');
  assert.equal(normalizeLang('en-US'), 'en');
  assert.equal(normalizeLang('zh-CN'), 'zh');
  assert.equal(normalizeLang(undefined), 'zh');
  assert.equal(pick('en', '中文', 'English'), 'English');
  assert.equal(pick('zh-CN', '中文', 'English'), '中文');
  assert.equal(localeOf('en'), 'en-US');
  assert.equal(localeOf('zh-CN'), 'zh-CN');
});

test('中英文主页结构一致', () => {
  assert.deepEqual(collectIds(enHtml), collectIds(zhHtml));
  assert.deepEqual(
    collectDataAttributes(enHtml),
    collectDataAttributes(zhHtml),
  );
  assert.match(zhHtml, /<html lang="zh-CN">/);
  assert.match(enHtml, /<html lang="en">/);
});

test('中英文主页互相链接，并声明 hreflang', () => {
  assert.match(zhHtml, /href="\.\/index\.en\.html"/);
  assert.match(enHtml, /href="\.\/index\.html"/);
  assert.match(zhHtml, /hreflang="en" href="\.\/index\.en\.html"/);
  assert.match(enHtml, /hreflang="zh-CN" href="\.\/index\.html"/);
});

test('英文主页除语言切换外不含中文', () => {
  const withoutLanguageLink = enHtml.replace(
    /<a href="\.\/index\.html" lang="zh-CN">中文<\/a>/,
    '',
  );
  assert.doesNotMatch(
    withoutLanguageLink,
    /[\u4e00-\u9fff]/,
    '英文主页仍有中文文本',
  );
  assert.doesNotMatch(
    withoutLanguageLink,
    /[。，、；：（）]/,
    '英文主页仍有中文标点',
  );
});

test('README 默认英文、中文版与站点互链', () => {
  const enReadme = readFileSync(`${root}README.md`, 'utf8');
  const zhReadme = readFileSync(`${root}README.zh-CN.md`, 'utf8');

  assert.match(enReadme, /\[English\]\(README\.md\)/);
  assert.match(enReadme, /\[简体中文\]\(README\.zh-CN\.md\)/);
  assert.match(zhReadme, /\[English\]\(README\.md\)/);
  assert.match(zhReadme, /\[简体中文\]\(README\.zh-CN\.md\)/);
  assert.match(zhReadme, /index\.en\.html/);
  assert.match(enReadme, /index\.en\.html/);
  assert.match(enReadme, /README\.zh-CN\.md/);
});

test('基准结果包含等长的双语说明', () => {
  for (const file of ['bench/results.json', 'bench/depth-results.json']) {
    const data = JSON.parse(readFileSync(`${root}${file}`, 'utf8'));
    assert.ok(Array.isArray(data.notes), `${file} 缺少 notes`);
    assert.ok(Array.isArray(data.notesEn), `${file} 缺少 notesEn`);
    assert.equal(data.notesEn.length, data.notes.length, `${file} 说明数量不一致`);
    assert.ok(
      data.notesEn.every((note) => !/[\u4e00-\u9fff]/.test(note)),
      `${file} 的 notesEn 仍含中文`,
    );
  }
});
