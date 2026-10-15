import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStudio } from '../src/server.mjs';
import { runTool } from '../src/cli-tool.mjs';

/** mori-studio tool：对着一个临时项目的 Studio 调 MCP 那套工具，看参数解析、--yes、退出码 */
let s, base, root;
before(async () => {
  root = mkdtempSync(join(tmpdir(), 'mori-cli-'));
  writeFileSync(join(root, 'mori.config.ts'), `export default {\n  title: 'T',\n  categories: [{ id: 'a', zh: 'A', en: 'A' }],\n};\n`);
  for (const d of ['src/content/posts', 'src/content/pages', 'src/assets']) mkdirSync(join(root, d), { recursive: true });
  s = await startStudio({ root, port: 0 });
  base = `http://127.0.0.1:${s.server.address().port}`;
});
after(() => s.stop());

/** 跑一次，收集标准输出、标准错误 */
async function run(...argv) {
  const out = [], err = [], ow = process.stdout.write, ew = process.stderr.write;
  process.stdout.write = (c) => { out.push(String(c)); return true; };
  process.stderr.write = (c) => { err.push(String(c)); return true; };
  try { return { code: await runTool(base, argv), out: out.join(''), err: err.join('') }; } finally { process.stdout.write = ow; process.stderr.write = ew; }
}

test('列出工具、看参数', async () => {
  const list = await run();
  assert.equal(list.code, 0);
  assert.match(list.out, /^delete_entry .*--yes/m);
  const help = await run('update_entry', '--help');
  assert.match(help.out, /--meta\s+object（可选）/);
});

test('调用：JSON 参数、--json、读文件', async () => {
  const md = join(root, 'body.md');
  writeFileSync(md, '# 你好\n\n正文。\n');
  assert.equal((await run('create_entry', '--kind', 'post', '--id', 'hello', '--title', 'x', '--markdown', `@${md}`)).code, 0);
  assert.equal((await run('update_entry', '--json', '{"kind":"post","id":"hello","meta":{"tags":["一","二"]}}')).code, 0);
  const r = await run('read_entry', '--kind', 'post', '--id', 'hello');
  assert.match(r.out, /"tags": \[\n\s+"一",\n\s+"二"\n\s+\]/);
  assert.match(r.out, /# 你好\n\n正文。/);
});

test('参数不对 2，破坏性的没加 --yes 是 3，工具出错 1', async () => {
  assert.equal((await run('nope')).code, 2);
  assert.equal((await run('read_entry', '--kind', 'post', '--idd', 'x')).code, 2);
  assert.equal((await run('update_entry', '--kind', 'post', '--id', 'hello', '--meta', '{bad')).code, 2);
  assert.equal((await run('delete_entry', '--kind', 'post', '--id', 'hello')).code, 3);
  assert.ok(existsSync(join(root, 'src/content/posts/hello.json')));
  assert.equal((await run('read_entry', '--kind', 'post', '--id', 'missing')).code, 1);
  assert.equal((await run('delete_entry', '--kind', 'post', '--id', 'hello', '--yes')).code, 0);
  assert.ok(!existsSync(join(root, 'src/content/posts/hello.json')));
});
