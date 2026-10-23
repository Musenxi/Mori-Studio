/**
 * 图床：Studio 在本地把图片压成几种宽度的 webp，上传到对象存储，图床只负责存储、给外链。
 * 结果记在项目的 src/assets/cdn.json（随项目提交；托管平台构建时主题读它，有记录的图直接用外链，不再由 Astro 压缩）：
 *   { base: "https://img.example.com", images: { "posts/hello/a.jpg": { sha, width, height, src: "blog/posts/hello/a.3f2a9c1b07.{w}.webp", widths: [480, 960, 1600], live?, time? } },
 *     videos: { "posts/hello/clip.mp4": { sha, src: "blog/posts/hello/clip.5e1d0a7c22.mp4" } } }
 * 视频（正文里的视频块）原样上传，Studio 插入时已经转好了；封面是普通的图，跟着图片一起传。
 * 外链 = base + "/" + src（{w} 换成宽度）。文件名里带内容哈希：图改了外链就变，CDN 不会给旧图。
 * 没设图床，或某张图还没上传，主题照旧用本地的图。
 *
 * 图床设置存在项目的 .mori-studio.json（不进 git），Secret Key 在钥匙串里（见 secrets.mjs）；界面上只进不出。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { IMAGE_EXT, indexAssets, liveVideo, readManifest, sha256, writeManifest } from './library.mjs';
import { s3Client } from './s3.mjs';

export const WIDTHS = [480, 960, 1600, 2400];

/** 图床设置里必须填的项 */
const REQUIRED = ['endpoint', 'bucket', 'accessKeyId', 'secretAccessKey', 'publicBase'];
export const hostReady = (h) => !!h && REQUIRED.every((k) => String(h[k] ?? '').trim());
const prefixOf = (h) => String(h.prefix ?? '').replace(/^\/+|\/+$/g, '');
const baseOf = (h) => String(h.publicBase).replace(/\/+$/, '');

/** 还没上传或已经改过的图（和清单对不上） */
export async function pendingAssets(root, host) {
  if (!hostReady(host)) return [];
  const idx = await indexAssets(root), m = readManifest(root);
  const fresh = (p, e) => { const r = m.images[p]; return r && r.sha === e.sha && m.base === baseOf(host) && (!existsSync(liveVideo(root, p)) || r.live); };
  return Object.entries(idx).filter(([p, e]) => !fresh(p, e)).map(([p]) => p);
}

/** 正文里视频块用的视频：src/assets 里的 .mp4，旁边没有同名的图（有的话是那张图的实况视频，跟着图走） */
function videoFiles(root) {
  const out = [], base = join(root, 'src/assets');
  const walk = (dir, pre) => {
    const names = readdirSync(dir, { withFileTypes: true });
    const stems = new Set(names.filter((e) => e.isFile() && [...IMAGE_EXT, '.heic', '.heif'].some((x) => e.name.toLowerCase().endsWith(x))).map((e) => e.name.replace(/\.[^.]+$/, '').toLowerCase()));
    for (const e of names) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) walk(join(dir, e.name), `${pre}${e.name}/`);
      else if (e.name.toLowerCase().endsWith('.mp4') && !stems.has(e.name.slice(0, -4).toLowerCase())) out.push(pre + e.name);
    }
  };
  if (existsSync(base)) walk(base, '');
  return out;
}

/** 还没上传或改过的视频：[路径, 内容哈希] */
export function pendingVideos(root, host) {
  if (!hostReady(host)) return [];
  const m = readManifest(root);
  return videoFiles(root).map((p) => [p, sha256(readFileSync(join(root, 'src/assets', p)))]).filter(([p, sha]) => !(m.base === baseOf(host) && m.videos?.[p]?.sha === sha));
}

/** 实况视频里记着的静态照片时间点（Studio 转码时写进 mp4 注释） */
const photoTime = (file) => { const m = /mori-photo-time=([\d.]+)/.exec(readFileSync(file).toString('latin1')); return m ? +m[1] : undefined; };

/**
 * 同步：把没上传、改过的图压好传上去，视频原样传上去，清单里去掉已经不在的。log 一路报告进度。返回上传了几个文件
 * （对象存储里旧版本的文件不删：已经发出去的页面可能还引用着）
 */
export async function syncToHost(root, host, log = () => {}, client = s3Client({ ...host, region: host.region || 'auto' })) {
  if (!hostReady(host)) throw new Error('图床还没设置好');
  const idx = await indexAssets(root);
  const m = readManifest(root);
  const base = baseOf(host);
  if (m.base !== base) { m.base = base; m.images = {}; m.videos = {}; } // 换了访问域名：全部重新上传
  for (const p of Object.keys(m.images)) if (!idx[p]) delete m.images[p];
  m.videos ??= {};
  const videos = new Set(videoFiles(root));
  for (const p of Object.keys(m.videos)) if (!videos.has(p)) delete m.videos[p];
  const todo = await pendingAssets(root, host);
  let n = 0;
  for (const p of todo) {
    const e = idx[p], file = join(root, 'src/assets', p);
    const stem = `${prefixOf(host) ? `${prefixOf(host)}/` : ''}${p.replace(/\.[^./]+$/, '')}.${e.sha.slice(0, 10)}`;
    const rec = { sha: e.sha, width: e.width, height: e.height };
    if (/\.(svg|gif)$/i.test(p)) {
      // 矢量图、动图不压，原样上传
      const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase();
      await client.put(`${stem}.${ext}`, readFileSync(file), ext === 'svg' ? 'image/svg+xml' : 'image/gif');
      Object.assign(rec, { src: `${stem}.${ext}`, widths: [] });
    } else {
      const widths = [...WIDTHS.filter((w) => w < e.width), Math.min(e.width, WIDTHS.at(-1))].filter((w, i, a) => a.indexOf(w) === i);
      for (const w of widths) {
        const body = await sharp(file).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
        await client.put(`${stem}.${w}.webp`, body, 'image/webp');
      }
      Object.assign(rec, { src: `${stem}.{w}.webp`, widths });
    }
    const video = liveVideo(root, p);
    if (existsSync(video)) {
      const buf = readFileSync(video);
      const key = `${stem}.${sha256(buf).slice(0, 10)}.mp4`;
      await client.put(key, buf, 'video/mp4');
      Object.assign(rec, { live: key, ...(photoTime(video) ? { time: photoTime(video) } : {}) });
    }
    m.images[p] = rec;
    writeManifest(root, m); // 每张传完就记下，中途断了下次接着传
    log(`${p}\n`);
    n++;
  }
  for (const [p, sha] of pendingVideos(root, host)) {
    const key = `${prefixOf(host) ? `${prefixOf(host)}/` : ''}${p.replace(/\.[^./]+$/, '')}.${sha.slice(0, 10)}.mp4`;
    await client.put(key, readFileSync(join(root, 'src/assets', p)), 'video/mp4');
    m.videos[p] = { sha, src: key };
    writeManifest(root, m);
    log(`${p}\n`);
    n++;
  }
  writeManifest(root, m);
  return n;
}

/** 测试连接：传一个小文件再删掉 */
export async function testHost(host) {
  if (!hostReady(host)) throw new Error('图床还没设置好');
  const client = s3Client({ ...host, region: host.region || 'auto' });
  const key = `${prefixOf(host) ? `${prefixOf(host)}/` : ''}.mori-test-${Date.now()}.txt`;
  await client.put(key, Buffer.from('mori'), 'text/plain');
  await client.del(key);
}
