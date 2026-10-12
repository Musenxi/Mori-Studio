import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveAsset, trashAsset } from '../src/library.mjs';
import { trashEntry } from '../src/project.mjs';
import { emptyTrash, listTrash, purgeTrash, restoreTrash } from '../src/trash.mjs';

function project() {
  const root = mkdtempSync(join(tmpdir(), 'mori-trash-'));
  for (const d of ['src/assets', 'src/content/posts', 'src/content/pages', 'src/published/posts']) mkdirSync(join(root, d), { recursive: true });
  return root;
}
const post = (root, id, doc, published = false) => {
  writeFileSync(join(root, 'src/content/posts', `${id}.json`), JSON.stringify(doc));
  if (published) writeFileSync(join(root, 'src/published/posts', `${id}.json`), JSON.stringify(doc));
};
const read = (root, f) => JSON.parse(readFileSync(join(root, f), 'utf8'));

test('删文章进回收站，还原后文件、已发布版本、图片文件夹都回来；挪去共用的图，引用也改过去', () => {
  const root = project();
  saveAsset(root, 'posts/a', 'own.jpg', 'x');
  saveAsset(root, 'posts/a', 'both.jpg', 'y');
  post(root, 'a', { title: '甲', blocks: [{ type: 'image', src: '../../assets/posts/a/own.jpg' }, { type: 'image', src: '../../assets/posts/a/both.jpg' }] }, true);
  post(root, 'b', { title: '乙', blocks: [{ type: 'image', src: '../../assets/posts/a/both.jpg' }] });
  trashEntry(root, 'post', 'a');
  assert.ok(!existsSync(join(root, 'src/content/posts/a.json')));
  assert.equal(read(root, 'src/content/posts/b.json').blocks[0].src, '../../assets/shared/both.jpg');

  const [it] = listTrash(root);
  assert.equal(it.kind, 'post');
  assert.equal(it.label, '甲');
  assert.ok(it.size > 0);

  restoreTrash(root, it.key);
  assert.ok(existsSync(join(root, 'src/content/posts/a.json')));
  assert.ok(existsSync(join(root, 'src/published/posts/a.json')));
  assert.ok(existsSync(join(root, 'src/assets/posts/a/own.jpg')));
  const a = read(root, 'src/content/posts/a.json');
  assert.equal(a.blocks[0].src, '../../assets/posts/a/own.jpg');
  assert.equal(a.blocks[1].src, '../../assets/shared/both.jpg'); // 被乙用着，留在共用里
  assert.deepEqual(listTrash(root), []);
});

test('原处已经有同名的就不还原；图片连同实况视频进出；彻底删除和清空', () => {
  const root = project();
  saveAsset(root, 'posts/a', 'p.jpg', 'x');
  writeFileSync(join(root, 'src/assets/posts/a/p.mp4'), 'v');
  trashAsset(root, 'posts/a/p.jpg');
  const [it] = listTrash(root);
  assert.equal(it.kind, 'asset');
  assert.equal(it.files.length, 2);
  saveAsset(root, 'posts/a', 'p.jpg', 'z');
  assert.throws(() => restoreTrash(root, it.key), /已经有/);
  purgeTrash(root, it.key);
  assert.deepEqual(listTrash(root), []);

  saveAsset(root, '', 'q.jpg', 'x');
  trashAsset(root, 'q.jpg');
  assert.equal(listTrash(root).length, 1);
  emptyTrash(root);
  assert.deepEqual(listTrash(root), []);
});

test('没有记录的旧条目按文件名推断原位置（文章 id 里有下划线也行）', () => {
  const root = project();
  mkdirSync(join(root, '.mori-trash/assets/100-posts_my_trip'), { recursive: true });
  writeFileSync(join(root, '.mori-trash/100-post-my_trip.json'), JSON.stringify({ title: '旅行' }));
  writeFileSync(join(root, '.mori-trash/assets/100-posts_my_trip/a.jpg'), 'x');
  writeFileSync(join(root, '.mori-trash/assets/200-posts_my_trip_IMG_1.jpg'), 'x');
  writeFileSync(join(root, '.mori-trash/assets/300-shared_b_c.png'), 'x');
  const items = listTrash(root);
  const entry = items.find((x) => x.kind === 'post');
  assert.equal(entry.label, '旅行');
  assert.deepEqual(entry.files.map(([, o]) => o).sort(), ['src/assets/posts/my_trip', 'src/content/posts/my_trip.json']);
  assert.deepEqual(items.filter((x) => x.kind === 'asset').map((x) => x.label).sort(), ['posts/my_trip/IMG_1.jpg', 'shared/b_c.png']);
  restoreTrash(root, entry.key);
  assert.ok(existsSync(join(root, 'src/assets/posts/my_trip/a.jpg')));
  assert.equal(read(root, 'src/content/posts/my_trip.json').title, '旅行');
});
