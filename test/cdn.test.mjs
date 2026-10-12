import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { moveAssets, readManifest, saveAsset } from '../src/library.mjs';
import { pendingAssets, syncToHost } from '../src/cdn.mjs';

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
