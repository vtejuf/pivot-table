import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_THEME,
  mixHex,
  parseHex,
  readableTextColor,
} from '../../src/render/index.mjs';

test('parseHex 支持简写、全写与 rgb()', () => {
  assert.deepEqual(parseHex('#fff'), [255, 255, 255]);
  assert.deepEqual(parseHex('#1d4ed8'), [29, 78, 216]);
  assert.deepEqual(parseHex('rgb(10, 20, 30)'), [10, 20, 30]);
  assert.throws(() => parseHex('blue'), /不支持的颜色格式/);
  assert.throws(() => parseHex(123), /颜色必须是字符串/);
});

test('mixHex 线性插值并裁剪 t', () => {
  assert.equal(mixHex('#000000', '#ffffff', 0.5), 'rgb(128, 128, 128)');
  assert.equal(mixHex('#000000', '#ffffff', -1), 'rgb(0, 0, 0)');
  assert.equal(mixHex('#000000', '#ffffff', 2), 'rgb(255, 255, 255)');
});

test('readableTextColor 按亮度选深色或浅色文字', () => {
  assert.equal(readableTextColor('#ffffff'), DEFAULT_THEME.heatmap.darkText);
  assert.equal(readableTextColor('#1d4ed8'), DEFAULT_THEME.heatmap.lightText);
});
