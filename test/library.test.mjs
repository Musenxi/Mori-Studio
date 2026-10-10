import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { assetUsage, cleanRel, mergeAssets, findSame, indexAssets, listAssets, moveAssets, rememberOrigin, saveAsset, sha256, similarGroups } from '../src/library.mjs';
import { kindOf, trashEntry } from '../src/project.mjs';

function project() {
  const root = mkdtempSync(join(tmpdir(), 'mori-lib-'));
  for (const d of ['src/assets', 'src/content/posts', 'src/content/pages', 'src/published/posts']) mkdirSync(join(root, d), { recursive: true });
  return root;
}
const post = (root, id, doc, published = false) => {
  writeFileSync(join(root, 'src/content/posts', `${id}.json`), JSON.stringify(doc));
  if (published) writeFileSync(join(root, 'src/published/posts', `${id}.json`), JSON.stringify(doc));
};
const read = (root, f) => readFileSync(join(root, f), 'utf8');

test('图片按文件夹存：列出相对路径，同名加序号，路径不合法就拒绝', () => {
  const root = project();
  assert.equal(saveAsset(root, 'posts/a', 'x y.jpg', 'x'), 'posts/a/x_y.jpg');
  assert.equal(saveAsset(root, 'posts/a', 'x y.jpg', 'x'), 'posts/a/x_y-2.jpg');
  saveAsset(root, '', 'old.jpg', 'x');
  writeFileSync(join(root, 'src/assets/posts/a/x_y.mp4'), 'v');
  assert.deepEqual(listAssets(root), ['old.jpg', 'posts/a/x_y-2.jpg', 'posts/a/x_y.jpg']);
  for (const bad of ['../x.jpg', '/etc/x.jpg', 'a/.hidden/x.jpg', 'a/x.exe']) assert.throws(() => cleanRel(bad), /不合法/);
  assert.equal(cleanRel('posts//a/', { folder: true }), 'posts/a');
});

test('移动：实况视频跟着走，正在写的、已发布的、友人帐里的引用都改', () => {
  const root = project();
  saveAsset(root, '', 'p.jpg', 'x');
  writeFileSync(join(root, 'src/assets/p.mp4'), 'v');
  saveAsset(root, '', 'pp.jpg', 'x');
  post(root, 'a', { title: 'A', cover: '../../assets/p.jpg', blocks: [{ src: '../../assets/pp.jpg' }] }, true);
  writeFileSync(join(root, 'src/content/friends.json'), JSON.stringify([{ avatar: '../assets/p.jpg' }]));
  const map = moveAssets(root, ['p.jpg'], 'posts/a');
  assert.equal(map.get('p.jpg'), 'posts/a/p.jpg');
  assert.ok(existsSync(join(root, 'src/assets/posts/a/p.mp4')) && !existsSync(join(root, 'src/assets/p.mp4')));
  for (const f of ['src/content/posts/a.json', 'src/published/posts/a.json']) {
    assert.match(read(root, f), /"\.\.\/\.\.\/assets\/posts\/a\/p\.jpg"/);
    assert.match(read(root, f), /"\.\.\/\.\.\/assets\/pp\.jpg"/); // 名字相近的另一张不受影响
  }
  assert.match(read(root, 'src/content/friends.json'), /"\.\.\/assets\/posts\/a\/p\.jpg"/);
  assert.deepEqual(assetUsage(root, kindOf).find((x) => x.path === 'posts/a/p.jpg').usedBy.map((r) => r.id).sort(), ['a', 'friends']);
});

test('删除文章：它文件夹里别处还在用的图移进共用，其余进回收站', () => {
  const root = project();
  saveAsset(root, 'posts/a', 'mine.jpg', 'x');
  saveAsset(root, 'posts/a', 'both.jpg', 'x');
  post(root, 'a', { title: 'A', blocks: [{ src: '../../assets/posts/a/mine.jpg' }, { src: '../../assets/posts/a/both.jpg' }] });
  post(root, 'b', { title: 'B', blocks: [{ src: '../../assets/posts/a/both.jpg' }] });
  trashEntry(root, 'post', 'a');
  assert.deepEqual(listAssets(root), ['shared/both.jpg']);
  assert.match(read(root, 'src/content/posts/b.json'), /assets\/shared\/both\.jpg/);
});

test('查重：原文件或存下的文件哈希一样就认出来；看起来一样的分成一组，颜色不同的不算', async () => {
  const root = project();
  const img = (color, w = 64, h = 48) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).composite([{ input: Buffer.from(`<svg width="${w}" height="${h}"><rect x="0" y="0" width="${w / 2}" height="${h}" fill="#000"/></svg>`) }]).jpeg().toBuffer();
  const a = await img('#fff');
  const rel = saveAsset(root, 'posts/a', 'a.jpg', a);
  rememberOrigin(root, rel, 'heic-hash');
  assert.equal(await findSame(root, [sha256(a)]), rel);
  assert.equal(await findSame(root, ['heic-hash']), rel);
  assert.equal(await findSame(root, ['nope']), undefined);
  // 同一张图压得更狠、换了尺寸：看起来一样；另一张完全不同的不算
  saveAsset(root, 'shared', 'a-small.jpg', await sharp(a).resize(32, 24).jpeg({ quality: 40 }).toBuffer());
  saveAsset(root, 'shared', 'other.jpg', await sharp({ create: { width: 64, height: 48, channels: 3, background: '#888' } }).composite([{ input: Buffer.from('<svg width="64" height="48"><rect x="0" y="24" width="64" height="24" fill="#000"/></svg>') }]).jpeg().toBuffer());
  saveAsset(root, 'shared', 'tinted.jpg', await img('#6af')); // 构图一样、颜色不同：不算
  const groups = similarGroups(await indexAssets(root));
  assert.deepEqual(groups.map((g) => g.sort()), [['posts/a/a.jpg', 'shared/a-small.jpg']]);
});

test('合并重复：引用改指向保留的那张，其余进回收站，实况视频挪给保留的', () => {
  const root = project();
  saveAsset(root, 'posts/a', 'k.jpg', 'x');
  saveAsset(root, 'shared', 'd.jpg', 'x');
  writeFileSync(join(root, 'src/assets/shared/d.mp4'), 'v');
  post(root, 'a', { title: 'A', blocks: [{ src: '../../assets/shared/d.jpg' }] }, true);
  mergeAssets(root, 'posts/a/k.jpg', ['shared/d.jpg']);
  assert.deepEqual(listAssets(root), ['posts/a/k.jpg']);
  assert.ok(existsSync(join(root, 'src/assets/posts/a/k.mp4')));
  for (const f of ['src/content/posts/a.json', 'src/published/posts/a.json']) assert.match(read(root, f), /assets\/posts\/a\/k\.jpg/);
});
