import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as root from '../src/index.mjs';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));

test('包是 ESM-only，且没有运行时依赖', () => {
  assert.equal(pkg.name, '@vtejuf/pivot-table');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(pkg.exports['.'], './src/index.mjs');
  assert.equal(pkg.exports['./model'], './src/model/index.mjs');
  assert.equal(pkg.exports['./render'], './src/render/index.mjs');
  assert.equal(pkg.exports['./features/*'], './src/features/*.mjs');
  assert.equal(pkg.exports['./package.json'], './package.json');
  assert.equal(pkg.publishConfig.access, 'public');
  assert.equal(pkg.publishConfig.registry, 'https://registry.npmjs.org/');
  assert.doesNotMatch(JSON.stringify(pkg.exports), /require/);
});

test('exports 指向存在的文件，files 路径有效', () => {
  for (const path of [
    pkg.exports['.'],
    pkg.exports['./model'],
    pkg.exports['./render'],
    pkg.exports['./package.json'],
  ]) {
    assert.ok(existsSync(join(rootDir, path)), `缺少入口文件: ${path}`);
  }

  for (const file of pkg.files) {
    assert.ok(existsSync(join(rootDir, file)), `files 中的路径不存在: ${file}`);
  }
});

test('根入口导出模型与渲染 API', () => {
  for (const name of [
    'aggregate',
    'layoutPivot',
    'valueKey',
    'computePivotGeometry',
    'renderPivot',
    'setupCanvas',
    'DEFAULT_THEME',
  ]) {
    assert.ok(name in root, `根入口缺少导出: ${name}`);
  }

  assert.equal(typeof root.aggregate, 'function');
  assert.equal(typeof root.layoutPivot, 'function');
  assert.equal(typeof root.renderPivot, 'function');
});
