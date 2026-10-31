import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function listMjs(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listMjs(path));
    else if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(path);
  }
  return files;
}

test('核心 model / render 不反向依赖 features', () => {
  for (const directory of ['src/model', 'src/render']) {
    for (const file of listMjs(join(root, directory))) {
      const source = readFileSync(file, 'utf8');
      assert.doesNotMatch(
        source,
        /from\s+['"][^'"]*features\//,
        `${file} 不应 import features`,
      );
    }
  }
});
