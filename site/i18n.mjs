/**
 * 站点文案的双语工具。
 *
 * 语言只由页面 <html lang> 决定：以 en 开头为英文，其余回退中文。
 * 模块不依赖 DOM，Node 测试可以直接复用。
 */

export const LANGUAGES = ['zh', 'en'];

export function normalizeLang(value) {
  return String(value ?? '').toLowerCase().startsWith('en') ? 'en' : 'zh';
}

export function documentLang(root = document) {
  return normalizeLang(root?.documentElement?.lang);
}

export function pick(lang, zh, en) {
  return normalizeLang(lang) === 'en' ? en : zh;
}

export function localeOf(lang) {
  return normalizeLang(lang) === 'en' ? 'en-US' : 'zh-CN';
}
