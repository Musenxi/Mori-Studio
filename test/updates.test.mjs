import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkTheme, updateTheme, updateStudio, compareVersions } from '../src/updates.mjs';

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...a) => execFileSync('git', a, { cwd, env, encoding: 'utf8' }).trim();
const commit = (dir, file, text, msg) => { writeFileSync(join(dir, file), text); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', msg); };

/** 一个模板仓库，和一个从它克隆来的站点（远端叫 template，和 Studio 里一样） */
function setup() {
  const tpl = mkdtempSync(join(tmpdir(), 'mori-tpl-'));
  git(tpl, 'init', '-q', '-b', 'main');
  const pkg = (v) => JSON.stringify({ version: v }) + '\n';
  commit(tpl, 'package.json', pkg('1.0.0'), '第一版');
  commit(tpl, 'theme.txt', 'v1\n', '第一版文件');
  const site = mkdtempSync(join(tmpdir(), 'mori-site-'));
  git(site, 'init', '-q', '-b', 'main');
  git(site, 'remote', 'add', 'template', tpl);
  git(site, 'fetch', '-q', 'template');
  git(site, 'merge', '-q', 'template/main', '--allow-unrelated-histories', '--no-edit');
  return { tpl, site };
}

test('比较版本号', () => {
  assert.equal(compareVersions('0.1.0', '0.0.9'), 1);
  assert.equal(compareVersions('0.1', '0.1.0'), 0);
  assert.equal(compareVersions('0.0.1', '0.1.0'), -1);
});

test('主题：按版本号检查；模板版本更高才算有更新，更新后合进站点', async () => {
  const { tpl, site } = setup();
  assert.deepEqual(await checkTheme(site), { version: '1.0.0', latest: '1.0.0', outdated: false, commits: [] });
  commit(tpl, 'theme.txt', 'v2\n', '改了页头'); // 提交变了但版本号没变：不算更新
  assert.equal((await checkTheme(site)).outdated, false);
  commit(tpl, 'package.json', JSON.stringify({ version: '1.1.0' }) + '\n', '发 1.1.0');
  const c = await checkTheme(site);
  assert.equal(c.outdated, true);
  assert.equal(c.latest, '1.1.0');
  assert.deepEqual(c.commits.map((x) => x.subject), ['发 1.1.0', '改了页头']);
  git(site, 'merge', '-q', 'template/main', '--no-edit'); // 合并之后版本号一致（updateTheme 在版本变了时会装依赖，这里不跑）
  assert.equal((await checkTheme(site)).outdated, false);
});

test('主题：站点自己改过别的文件不冲突；改了同一处就放弃合并，仓库保持原样', async () => {
  const { tpl, site } = setup();
  commit(site, 'mine.txt', '我的\n', '我的内容');
  commit(tpl, 'theme.txt', 'v2\n', '模板改了');
  await updateTheme(site);
  assert.equal(readFileSync(join(site, 'mine.txt'), 'utf8'), '我的\n');

  commit(site, 'theme.txt', '我也改了\n', '我改了主题文件');
  commit(tpl, 'theme.txt', 'v3\n', '模板又改了');
  const head = git(site, 'rev-parse', 'HEAD');
  await assert.rejects(updateTheme(site), /有冲突[\s\S]*theme\.txt/);
  assert.equal(git(site, 'rev-parse', 'HEAD'), head);
  assert.equal(git(site, 'status', '--porcelain'), '');
  assert.equal(readFileSync(join(site, 'theme.txt'), 'utf8'), '我也改了\n');
});

test('主题：不是 git 仓库就说清楚', async () => {
  await assert.rejects(checkTheme(mkdtempSync(join(tmpdir(), 'mori-'))), /git 仓库/);
});

test('Studio（命令行版）：在自己的仓库里 pull，依赖文件变了才要重新装', async () => {
  const origin = mkdtempSync(join(tmpdir(), 'mori-origin-'));
  git(origin, 'init', '-q', '-b', 'main');
  commit(origin, 'a.txt', '1\n', '第一版');
  const dir = mkdtempSync(join(tmpdir(), 'mori-studio-'));
  git(dir, 'clone', '-q', origin, '.');
  commit(origin, 'a.txt', '2\n', '第二版');
  const r = await updateStudio(dir);
  assert.deepEqual(r, { changed: 1, installed: false });
  assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), '2\n');
  commit(dir, 'b.txt', '本地提交\n', '本地提交');
  commit(origin, 'a.txt', '3\n', '第三版');
  await assert.rejects(updateStudio(dir), /拉取失败/); // 本地有分叉，不会自动合并
});
