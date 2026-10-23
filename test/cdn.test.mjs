import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { moveAssets, readManifest, saveAsset, videoNames, withVideoPosters } from '../src/library.mjs';
import { pendingAssets, pendingVideos, syncToHost } from '../src/cdn.mjs';

const host = { endpoint: 'https://s3.example.com', bucket: 'b', accessKeyId: 'k', secretAccessKey: 's', publicBase: 'https://img.example.com/', prefix: '/blog/' };
const fake = () => { const puts = []; return { puts, put: async (key, body, type) => { puts.push({ key, type, size: body.length }); }, del: async () => {} }; };

test('同步到图床：压出几种宽度传上去，清单记外链；没改的不再传；移动只换键；改了重传', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mori-cdn-'));
  for (const d of ['src/assets', 'src/content/posts']) mkdirSync(join(root, d), { recursive: true });
  const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#468' } }).jpeg().toBuffer();
  const rel = saveAsset(root, 'posts/a', 'p.jpg', png);
  writeFileSync(join(root, 'src/assets/posts/a/p.mp4'), Buffer.from('....mori-photo-time=1.25 ...'));

  const c1 = fake();
  assert.equal(await syncToHost(root, host, undefined, c1), 1);
  const m = readManifest(root);
  assert.equal(m.base, 'https://img.example.com');
  const r = m.images[rel];
  assert.deepEqual(r.widths, [480, 960, 1200]);
  assert.match(r.src, /^blog\/posts\/a\/p\.[0-9a-f]{10}\.\{w\}\.webp$/);
  assert.deepEqual([r.width, r.height, r.time], [1200, 800, 1.25]);
  assert.match(r.live, /^blog\/posts\/a\/p\.[0-9a-f]{10}\.[0-9a-f]{10}\.mp4$/);
  assert.deepEqual(c1.puts.map((p) => p.type), ['image/webp', 'image/webp', 'image/webp', 'video/mp4']);

  const c2 = fake();
  assert.equal(await syncToHost(root, host, undefined, c2), 0);
  assert.equal(c2.puts.length, 0);

  const moved = moveAssets(root, [rel], 'shared').get(rel);
  assert.equal(readManifest(root).images[moved].src, r.src);
  assert.deepEqual(await pendingAssets(root, host), []);

  writeFileSync(join(root, 'src/assets', moved), await sharp(png).modulate({ brightness: 1.4 }).jpeg().toBuffer());
  assert.deepEqual(await pendingAssets(root, host), [moved]);
  const c3 = fake();
  assert.equal(await syncToHost(root, host, undefined, c3), 1);
  assert.notEqual(readManifest(root).images[moved].src, r.src);
});

test('视频：原样传上去，清单的 videos 记外链；没改的不再传；实况照片的视频不算', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mori-cdn-'));
  mkdirSync(join(root, 'src/assets/posts/v'), { recursive: true });
  const jpg = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#468' } }).jpeg().toBuffer();
  writeFileSync(join(root, 'src/assets/posts/v/clip.mp4'), Buffer.from('video'));
  writeFileSync(join(root, 'src/assets/posts/v/clip.poster.jpg'), jpg);
  saveAsset(root, 'posts/v', 'live.jpg', jpg);
  writeFileSync(join(root, 'src/assets/posts/v/live.mp4'), Buffer.from('live'));
  assert.deepEqual(pendingVideos(root, host).map(([p]) => p), ['posts/v/clip.mp4']);
  const c1 = fake();
  assert.equal(await syncToHost(root, host, undefined, c1), 3);
  assert.match(readManifest(root).videos['posts/v/clip.mp4'].src, /^blog\/posts\/v\/clip\.[0-9a-f]{10}\.mp4$/);
  assert.ok(c1.puts.some((p) => p.type === 'video/mp4' && /clip\.[0-9a-f]{10}\.mp4$/.test(p.key)));
  const c2 = fake();
  assert.equal(await syncToHost(root, host, undefined, c2), 0);
});

test('视频的名字：不和已有的图、视频、封面同名；封面没写的按名字补上', () => {
  const root = mkdtempSync(join(tmpdir(), 'mori-cdn-'));
  mkdirSync(join(root, 'src/assets/posts/v'), { recursive: true });
  writeFileSync(join(root, 'src/assets/posts/v/海边.jpg'), '');
  assert.deepEqual(videoNames(root, 'posts/v', '海边.MOV'), { video: 'posts/v/海边-2.mp4', poster: 'posts/v/海边-2.poster.jpg' });
  writeFileSync(join(root, 'src/assets/posts/v/海边-2.poster.jpg'), '');
  const doc = { blocks: [{ id: 'b1', type: 'video', src: '../../assets/posts/v/海边-2.mp4' }, { id: 'b2', type: 'video', src: '../../assets/posts/v/没有.mp4' }] };
  const out = withVideoPosters(root, doc);
  assert.equal(out.blocks[0].poster, '../../assets/posts/v/海边-2.poster.jpg');
  assert.equal(out.blocks[1].poster, undefined);
});
