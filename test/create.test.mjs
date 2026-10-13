import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRegistry, checkSource, createSite } from '../src/create.mjs';

test('新建站点：文件夹里有东西就不动它；下载失败把建了一半的删掉', async () => {
  const base = mkdtempSync(join(tmpdir(), 'mori-create-'));
  const full = join(base, 'full');
  mkdirSync(full);
  writeFileSync(join(full, 'notes.txt'), 'x');
  await assert.rejects(createSite({ dir: full, repo: join(base, 'nope') }), /已经有文件/);
  assert.deepEqual(readdirSync(full), ['notes.txt']);

  const fresh = join(base, 'fresh');
  await assert.rejects(createSite({ dir: fresh, repo: join(base, 'nope') }));
  assert.equal(existsSync(fresh), false);

  const empty = join(base, 'empty');
  mkdirSync(empty);
  writeFileSync(join(empty, '.DS_Store'), '');
  await assert.rejects(createSite({ dir: empty, repo: join(base, 'nope') }));
  assert.deepEqual(readdirSync(empty), []);
});

test('下载设置：仓库、分支、依赖源', () => {
  assert.deepEqual(checkSource({}), { repo: 'https://github.com/Musenxi/Astro-Theme-Mori.git', branch: 'main' });
  assert.deepEqual(checkSource({ repo: ' https://gitee.com/a/b.git ', branch: 'v0.1' }), { repo: 'https://gitee.com/a/b.git', branch: 'v0.1' });
  assert.throws(() => checkSource({ branch: '--upload-pack=x' }), /分支/);
  assert.throws(() => checkSource({ repo: '--x' }), /地址/);
  assert.equal(checkRegistry(''), '');
  assert.equal(checkRegistry('https://registry.npmmirror.com'), 'https://registry.npmmirror.com/');
  assert.throws(() => checkRegistry('registry.npmmirror.com'), /网址/);
});
