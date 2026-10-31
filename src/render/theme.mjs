/**
 * 可视化模块：默认主题与颜色工具。
 *
 * 主题只描述样式，不参与布局计算。颜色工具供 feature（如热力图）做
 * 颜色插值和文字对比度计算。
 */

export const DEFAULT_THEME = Object.freeze({
  background: '#ffffff',
  /** 单元格区域交替行底色。 */
  cellBackground: '#ffffff',
  stripeBackground: '#f8fafc',
  /** 没有数据落点的空网格。 */
  emptyBackground: '#fbfcfe',
  grid: '#e2e8f0',
  border: '#cbd5e1',
  headerBackground: '#f1f5f9',
  headerText: '#0f172a',
  text: '#0f172a',
  headerFont: '600 12px ui-sans-serif, system-ui, sans-serif',
  valueFont: '12px ui-sans-serif, system-ui, sans-serif',
  padding: 8,
});

const DEFAULT_TEXT_COLORS = Object.freeze({
  darkText: '#0f172a',
  lightText: '#ffffff',
});

/** 把 #rgb / #rrggbb / rgb(r, g, b) 解析成 [r, g, b]。 */
export function parseHex(hex) {
  if (typeof hex !== 'string') {
    throw new TypeError(`颜色必须是字符串，收到 ${typeof hex}`);
  }
  const text = hex.trim();
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/i.exec(text);
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }

  let value = text.replace(/^#/, '');
  if (value.length === 3) {
    value = value
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`不支持的颜色格式: ${hex}（只支持 #rgb / #rrggbb / rgb()）`);
  }
  const int = Number.parseInt(value, 16);
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
}

/** 两色线性插值，t 会被裁剪到 [0, 1]。 */
export function mixHex(from, to, t) {
  const a = parseHex(from);
  const b = parseHex(to);
  const k = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const channel = (i) => Math.round(a[i] + (b[i] - a[i]) * k);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

/**
 * 根据背景色亮度选择深色或浅色文字，保证彩色背景上的可读性。
 */
export function readableTextColor(background, theme = DEFAULT_TEXT_COLORS) {
  const [r, g, b] = parseHex(background);
  const toLinear = (channel) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return luminance > 0.45 ? theme.darkText : theme.lightText;
}
