import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { codeExamples, codeExamplesEn, getCodeExamples } from '../../site/code-examples.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('示例覆盖 Demo 的 8 个功能', () => {
  assert.deepEqual(
    codeExamples.map((example) => example.id),
    [
      'core',
      'dual',
      'heatmap',
      'totals',
      'overlay',
      'scrollbar',
      'marker',
      'collapse',
    ],
  );

  for (const example of codeExamples) {
    assert.ok(example.label, `${example.id} 缺少 label`);
    assert.ok(example.file, `${example.id} 缺少 file`);
    assert.ok(example.code.includes('import '), `${example.id} 缺少 import`);
    assert.ok(example.note, `${example.id} 缺少 note`);
  }
});

test('示例不再使用已移除的核心 heatmap 选项', () => {
  for (const example of codeExamples) {
    assert.doesNotMatch(
      example.code,
      /heatmap\s*:\s*true/,
      `${example.id} 仍在使用已移除的 heatmap 选项`,
    );
  }
});

test('示例 import 路径都指向存在的模块', () => {
  for (const example of [...codeExamples, ...codeExamplesEn]) {
    const paths = [...example.code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
      (match) => match[1],
    );
    assert.ok(paths.length > 0, `${example.id} 缺少 import`);

    for (const path of paths) {
      assert.ok(
        path.startsWith('./'),
        `${example.id} 的路径必须是相对项目根: ${path}`,
      );
      assert.ok(
        existsSync(`${root}${path.slice(2)}`),
        `${example.id} 引用不存在的模块: ${path}`,
      );
    }
  }
});

test('英文示例与中文示例结构一致，且不含中文', () => {
  assert.deepEqual(
    codeExamplesEn.map((example) => example.id),
    codeExamples.map((example) => example.id),
  );

  for (const [index, example] of codeExamplesEn.entries()) {
    const chinese = codeExamples[index];
    assert.equal(example.file, chinese.file, `${example.id} 文件不一致`);
    assert.ok(example.label, `${example.id} 缺少英文 label`);
    assert.ok(example.note, `${example.id} 缺少英文 note`);
    assert.doesNotMatch(
      `${example.label}\n${example.note}\n${example.code}`,
      /[\u4e00-\u9fff]/,
      `${example.id} 的英文示例仍含中文`,
    );
  }

  assert.equal(getCodeExamples('en'), codeExamplesEn);
  assert.equal(getCodeExamples('zh-CN'), codeExamples);
});
