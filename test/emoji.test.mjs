import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanName, createPack, listEmoji, renameEmoji, renamePack, saveEmoji, trashEmoji } from '../src/emoji.mjs';
import { listTrash, restoreTrash } from '../src/trash.mjs';

function project() {
  const root = mkdtempSync(join(tmpdir(), 'mori-emoji-'));
  for (const d of ['public/emoji', 'src/content/posts', 'src/published/posts']) mkdirSync(join(root, d), { recursive: true });
  return root;
}
const read = (root, f) => JSON.parse(readFileSync(join(root, f), 'utf8'));
const doc = (key) => ({ title: '甲', blocks: [{ type: 'p', text: [{ t: '你好' }, { t: key, marks: [{ type: 'emoji' }] }] }], excerpt: `看 :[${key}]` });

test('新建包、上传：空包也列出，文件名里不能用的字符换掉，同名加序号，pack.json 里的链接也列出', () => {
  const root = project();
  assert.equal(createPack(root, 'bili'), 'bili');
  assert.deepEqual(listEmoji(root), [{ id: 'bili', title: 'bili', items: [] }]);
  assert.throws(() => createPack(root, 'bili'), /已经有/);
  for (const bad of ['', 'a b', 'a:b', '[x]', '../x', '.hidden']) assert.throws(() => cleanName(bad), /不能/);
  assert.equal(saveEmoji(root, 'bili', 'doge face.png', 'x'), 'doge-face');
  assert.equal(saveEmoji(root, 'bili', 'doge face.gif', 'x'), 'doge-face-2');
  assert.throws(() => saveEmoji(root, 'bili', 'a.exe', 'x'), /表情要是/);
  assert.throws(() => saveEmoji(root, 'nope', 'a.png', 'x'), /没有这个表情包/);
  writeFileSync(join(root, 'public/emoji/bili/pack.json'), JSON.stringify({ title: '哔哩', items: { 链接: 'https://x/y.png' } }));
  const [p] = listEmoji(root);
  assert.equal(p.title, '哔哩');
  assert.deepEqual(p.items.map((it) => [it.key, it.file ?? it.url]), [['bili_doge-face-2', 'doge-face-2.gif'], ['bili_doge-face', 'doge-face.png'], ['bili_链接', 'https://x/y.png']]);
});

test('改名：表情、包改名后文章（正在写的和已发布的）里的引用一起改', () => {
  const root = project();
  createPack(root, 'bili');
  saveEmoji(root, 'bili', 'doge.png', 'x');
  saveEmoji(root, 'bili', 'cat.png', 'x');
  writeFileSync(join(root, 'src/content/posts/a.json'), JSON.stringify(doc('bili_doge')));
  writeFileSync(join(root, 'src/published/posts/a.json'), JSON.stringify(doc('bili_doge')));
  writeFileSync(join(root, 'src/content/posts/b.json'), JSON.stringify(doc('other_doge')));
  assert.throws(() => renameEmoji(root, 'bili', 'doge', 'cat'), /同名/);
  renameEmoji(root, 'bili', 'doge', '狗头');
  assert.ok(existsSync(join(root, 'public/emoji/bili/狗头.png')));
  for (const f of ['src/content/posts/a.json', 'src/published/posts/a.json']) {
    const d = read(root, f);
    assert.equal(d.blocks[0].text[1].t, 'bili_狗头');
    assert.equal(d.blocks[0].text[0].t, '你好');
    assert.equal(d.excerpt, '看 :[bili_狗头]');
  }
  renamePack(root, 'bili', 'b站');
  assert.equal(read(root, 'src/content/posts/a.json').blocks[0].text[1].t, 'b站_狗头');
  assert.equal(readFileSync(join(root, 'src/content/posts/b.json'), 'utf8'), JSON.stringify(doc('other_doge')));
  assert.deepEqual(listEmoji(root).map((p) => p.id), ['b站']);
});

test('删除进回收站，能还原', () => {
  const root = project();
  createPack(root, 'bili');
  saveEmoji(root, 'bili', 'doge.png', 'x');
  saveEmoji(root, 'bili', 'cat.png', 'x');
  trashEmoji(root, 'bili', 'doge');
  assert.deepEqual(listEmoji(root)[0].items.map((it) => it.name), ['cat']);
  trashEmoji(root, 'bili');
  assert.deepEqual(listEmoji(root), []);
  const items = listTrash(root);
  assert.deepEqual(items.map((it) => [it.kind, it.label]).sort(), [['emoji', 'bili'], ['emoji', 'bili/doge.png']]);
  for (const label of ['bili', 'bili/doge.png']) restoreTrash(root, items.find((it) => it.label === label).key);
  assert.deepEqual(listEmoji(root)[0].items.map((it) => it.name).sort(), ['cat', 'doge']);
});
