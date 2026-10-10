/**
 * 图片库：src/assets 下按文件夹放图片。
 *   posts/<文章 id>/   这篇文章的图
 *   pages/<页面 id>/   这个页面的图
 *   shared/           几篇共用的、站点级的（友人头像……）
 *   （根目录）          没整理过的老图片，界面上叫“未归类”
 * 图片在 Studio 里用它在 src/assets 下的相对路径标识（posts/hello/IMG_6745.jpg），内容里写成 ../../assets/<路径>。
 * 以后接图床，对象存储里也用同一个路径当 key。
 *
 * 查重：node_modules/.cache/mori-studio/assets.json 记着每张图的内容哈希、上传时原文件的哈希（HEIC 转换前）、感知哈希和尺寸；
 * 文件大小或修改时间变了就重算，随时可以删掉重建。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import sharp from 'sharp';

export const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.svg']);
export const SHARED = 'shared';
export const folderOf = (kind, id) => (kind === 'page' ? `pages/${id}` : `posts/${id}`);

const assetsDir = (root) => join(root, 'src/assets');
const abs = (root, rel) => join(assetsDir(root), ...rel.split('/'));
const SEG = /^[\w.\-一-龥]+$/;

/** 检查并规范一个相对路径（文件或文件夹）：不许 ..、绝对路径、奇怪字符 */
export function cleanRel(rel, { folder = false } = {}) {
  const parts = String(rel ?? '').split('/').filter(Boolean);
  if (String(rel ?? '').startsWith('/') || parts.some((p) => p === '.' || p === '..' || p.startsWith('.') || !SEG.test(p))) throw new Error('路径不合法');
  if (!folder && (!parts.length || !IMAGE_EXT.has(extname(parts.at(-1)).toLowerCase()))) throw new Error('路径不合法');
  return parts.join('/');
}

/** 所有图片的相对路径（跳过 . 开头的文件夹） */
export function listAssets(root) {
  const out = [];
  const walk = (dir, pre) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) walk(join(dir, e.name), `${pre}${e.name}/`);
      else if (IMAGE_EXT.has(extname(e.name).toLowerCase())) out.push(pre + e.name);
    }
  };
  if (existsSync(assetsDir(root))) walk(assetsDir(root), '');
  return out.sort();
}

/** src/assets 下所有有图片的文件夹（'' 是根目录） */
export const folderOfPath = (rel) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');

/** 实况照片的视频：和图片同名的 .mp4，放在图片旁边 */
export const liveVideo = (root, rel) => abs(root, rel.replace(/\.[^./]+$/, '.mp4'));

/** 存一张图到某个文件夹：只留文件名，不覆盖已有文件（同名加序号；别的图的实况视频也占着名字），返回相对路径 */
export function saveAsset(root, folder, name, buffer) {
  folder = cleanRel(folder, { folder: true });
  const rel = freeName(root, folder, basename(name).replace(/[^\w.\-一-龥]+/g, '_'));
  mkdirSync(dirname(abs(root, rel)), { recursive: true });
  writeFileSync(abs(root, rel), buffer);
  return rel;
}

function freeName(root, folder, name, except) {
  const ext = extname(name), stem = name.slice(0, name.length - ext.length);
  const at = (n) => (folder ? `${folder}/${n}` : n);
  let rel = at(name), k = 1;
  while (rel !== except && (existsSync(abs(root, rel)) || existsSync(liveVideo(root, rel)))) rel = at(`${stem}-${++k}${ext}`);
  return rel;
}

/* ───────────── 引用：内容里写着 ../../assets/<路径>（友人帐是 ../assets/<路径>） ───────────── */

/** 会引用图片的文件：文章、页面（正在写的和已发布的）、友人帐 */
function refFiles(root) {
  const files = [];
  for (const base of ['src/content', 'src/published']) {
    for (const dir of ['posts', 'pages']) {
      const d = join(root, base, dir);
      if (existsSync(d)) for (const f of readdirSync(d)) if (f.endsWith('.json')) files.push(join(d, f));
    }
  }
  const fr = join(root, 'src/content/friends.json');
  if (existsSync(fr)) files.push(fr);
  return files;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 文本里对某张图的引用：前面是 /assets/，后面是引号 */
const refRe = (rel) => new RegExp(`(?<=/assets/)${esc(rel)}(?=")`, 'g');

/** 把引用从旧路径改成新路径（map: 旧 → 新），返回改了几个文件 */
export function rewriteRefs(root, map) {
  const pairs = [...map].filter(([a, b]) => a !== b);
  if (!pairs.length) return 0;
  let changed = 0;
  for (const f of refFiles(root)) {
    const raw = readFileSync(f, 'utf8');
    let next = raw;
    for (const [from, to] of pairs) next = next.replace(refRe(from), to);
    if (next !== raw) { writeFileSync(f, next); changed++; }
  }
  return changed;
}

/** 内容里的引用者：文章、页面、友人帐（只看正在写的版本） */
function referrers(root, kindOf) {
  const texts = [];
  for (const [kind, dir] of [['post', 'posts'], ['page', 'pages']]) {
    const d = join(root, 'src/content', dir);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).filter((f) => f.endsWith('.json'))) {
      const id = basename(f, '.json');
      try { const raw = readFileSync(join(d, f), 'utf8'); const doc = JSON.parse(raw); texts.push({ raw, ref: { kind: kind === 'post' ? kindOf(doc) : 'page', id, title: doc.title ?? id } }); } catch { /* 有语法错误的文件跳过 */ }
    }
  }
  const fr = join(root, 'src/content/friends.json');
  if (existsSync(fr)) texts.push({ raw: readFileSync(fr, 'utf8'), ref: { kind: 'friends', id: 'friends', title: '友人帐' } });
  return texts;
}

/** 每张图片：所在文件夹、大小、修改时间、是不是实况、被哪些内容引用 */
export function assetUsage(root, kindOf) {
  const texts = referrers(root, kindOf);
  return listAssets(root).map((path) => {
    const st = statSync(abs(root, path));
    const needle = `assets/${path}"`;
    return { path, folder: folderOfPath(path), name: basename(path), size: st.size, mtime: Math.round(st.mtimeMs), live: existsSync(liveVideo(root, path)), usedBy: texts.filter((t) => t.raw.includes(needle)).map((t) => t.ref) };
  });
}

/* ───────────── 移动、删除 ───────────── */

function moveFile(root, from, to) {
  mkdirSync(dirname(abs(root, to)), { recursive: true });
  renameSync(abs(root, from), abs(root, to));
  if (existsSync(liveVideo(root, from))) renameSync(liveVideo(root, from), liveVideo(root, to));
}

/** 把几张图移到另一个文件夹（实况视频一起），引用跟着改。返回 旧 → 新 */
export function moveAssets(root, paths, folder) {
  folder = cleanRel(folder, { folder: true });
  const map = new Map();
  for (const p of paths.map((x) => cleanRel(x))) {
    if (!existsSync(abs(root, p))) throw new Error(`没有 ${p}`);
    if (folderOfPath(p) === folder) continue;
    const to = freeName(root, folder, basename(p));
    moveFile(root, p, to);
    map.set(p, to);
  }
  rewriteRefs(root, map);
  forget(root, map);
  return map;
}

/** 删除一张图（连同实况视频）：移进 .mori-trash/assets/，不真的删 */
export function trashAsset(root, rel) {
  rel = cleanRel(rel);
  if (!existsSync(abs(root, rel))) throw new Error('没有这张图片');
  const trash = join(root, '.mori-trash/assets');
  mkdirSync(trash, { recursive: true });
  const stamp = `${Date.now()}-${rel.replaceAll('/', '_')}`;
  renameSync(abs(root, rel), join(trash, stamp));
  const v = liveVideo(root, rel);
  if (existsSync(v)) renameSync(v, join(trash, stamp.replace(/\.[^.]+$/, '.mp4')));
  forget(root, new Map([[rel, null]]));
}

/** 合并重复：保留 keep，其余几张的引用都改指向它，然后进回收站（keep 没有实况视频而别的有，就把视频挪给它） */
export function mergeAssets(root, keep, drops) {
  keep = cleanRel(keep);
  drops = drops.map((x) => cleanRel(x)).filter((x) => x !== keep);
  if (!existsSync(abs(root, keep))) throw new Error('没有这张图片');
  for (const d of drops) {
    if (!existsSync(liveVideo(root, keep)) && existsSync(liveVideo(root, d))) renameSync(liveVideo(root, d), liveVideo(root, keep));
  }
  rewriteRefs(root, new Map(drops.map((d) => [d, keep])));
  for (const d of drops) if (existsSync(abs(root, d))) trashAsset(root, d);
}

/**
 * 文章删除时处理它的文件夹：被别的内容用到的图移进共用（引用跟着改），其余整个文件夹移进回收站。
 * 要在文章文件已经移走之后调用（这样它自己不算引用者）
 */
export function retireFolder(root, folder, kindOf, stamp = Date.now()) {
  folder = cleanRel(folder, { folder: true });
  const dir = abs(root, folder);
  if (!existsSync(dir)) return;
  const inside = assetUsage(root, kindOf).filter((a) => a.folder === folder);
  const kept = inside.filter((a) => a.usedBy.length).map((a) => a.path);
  if (kept.length) moveAssets(root, kept, SHARED);
  const trash = join(root, '.mori-trash/assets');
  mkdirSync(trash, { recursive: true });
  renameSync(dir, join(trash, `${stamp}-${folder.replaceAll('/', '_')}`));
  forget(root, new Map(inside.map((a) => [a.path, null])));
}

/* ───────────── 查重索引 ───────────── */

const indexFile = (root) => join(root, 'node_modules/.cache/mori-studio/assets.json');
const readIndex = (root) => { try { return JSON.parse(readFileSync(indexFile(root), 'utf8')); } catch { return {}; } };
const writeIndex = (root, idx) => { mkdirSync(dirname(indexFile(root)), { recursive: true }); writeFileSync(indexFile(root), JSON.stringify(idx)); };

/** 图片移走、删掉后，索引里跟着改（map: 旧 → 新，新为 null 是删掉） */
function forget(root, map) {
  const idx = readIndex(root);
  let dirty = false;
  for (const [from, to] of map) {
    if (!idx[from]) continue;
    if (to) idx[to] = idx[from];
    delete idx[from];
    dirty = true;
  }
  if (dirty) writeIndex(root, idx);
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** 索引格式的版本：算法改了就加一，旧的条目会重算 */
const INDEX_V = 2;

/**
 * 感知指纹：dHash（256 位，缩成 17×16 灰度，比较左右相邻像素）+ 颜色（缩成 2×2 的平均色）。
 * 转正方向后再算；压缩、缩放、换格式都基本不变。只看灰度会把构图一样、颜色不同的图当成一样，所以还要比颜色
 */
async function fingerprint(file) {
  const g = await sharp(file).rotate().grayscale().resize(17, 16, { fit: 'fill' }).raw().toBuffer();
  let h = 0n;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) h = (h << 1n) | (g[y * 17 + x] > g[y * 17 + x + 1] ? 1n : 0n);
  const c = await sharp(file).rotate().removeAlpha().resize(2, 2, { fit: 'fill' }).raw().toBuffer();
  return { dhash: h.toString(16).padStart(64, '0'), color: [...c] };
}
const hamming = (a, b) => { let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; };
const colorGap = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;

/** 刷新索引：新的、改过的图重算，没了的去掉。返回 路径 → { sha, orig?, dhash, color, width, height } */
export async function indexAssets(root) {
  const idx = readIndex(root);
  const paths = listAssets(root);
  const alive = new Set(paths);
  let dirty = false;
  for (const k of Object.keys(idx)) if (!alive.has(k)) { delete idx[k]; dirty = true; }
  for (const p of paths) {
    const f = abs(root, p);
    const st = statSync(f);
    const old = idx[p];
    if (old && old.v === INDEX_V && old.size === st.size && old.mtime === Math.round(st.mtimeMs)) continue;
    const e = { v: INDEX_V, size: st.size, mtime: Math.round(st.mtimeMs), sha: sha256(readFileSync(f)), ...(old?.orig ? { orig: old.orig } : {}) };
    if (!p.toLowerCase().endsWith('.svg')) {
      try {
        const m = await sharp(f).metadata();
        e.width = m.autoOrient?.width ?? m.width;
        e.height = m.autoOrient?.height ?? m.height;
        Object.assign(e, await fingerprint(f));
      } catch { /* 读不了的图不算尺寸和相似 */ }
    }
    idx[p] = e;
    dirty = true;
  }
  if (dirty) writeIndex(root, idx);
  return idx;
}

/** 上传时记下原文件（转换前）的哈希：同一个 HEIC 再传一次也能认出来 */
export function rememberOrigin(root, rel, orig) {
  const idx = readIndex(root);
  idx[rel] = { ...(idx[rel] ?? {}), orig };
  writeIndex(root, idx);
}

/** 内容完全相同的图（原文件或存下的文件哈希一样），返回它的路径 */
export async function findSame(root, hashes) {
  const idx = await indexAssets(root);
  const want = new Set(hashes.filter(Boolean));
  return Object.entries(idx).find(([, e]) => want.has(e.sha) || want.has(e.orig))?.[0];
}

/** 看起来一样的图分组（256 位感知哈希相差不超过 limit 位，平均色每通道差不超过 colorLimit）：每组两张以上 */
export function similarGroups(idx, limit = 8, colorLimit = 5) {
  const items = Object.entries(idx).filter(([, e]) => e.dhash);
  const parent = new Map(items.map(([p]) => [p, p]));
  const find = (p) => { while (parent.get(p) !== p) p = parent.get(p); return p; };
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const [a, ea] = items[i], [b, eb] = items[j];
      // 宽高比差太多的不算（同一张图裁过就不是重复）
      if (ea.width && eb.width && Math.abs(ea.width / ea.height - eb.width / eb.height) > 0.02) continue;
      if (ea.sha === eb.sha || (hamming(ea.dhash, eb.dhash) <= limit && colorGap(ea.color, eb.color) <= colorLimit)) parent.set(find(a), find(b));
    }
  }
  const groups = new Map();
  for (const [p] of items) { const r = find(p); groups.set(r, [...(groups.get(r) ?? []), p]); }
  return [...groups.values()].filter((g) => g.length > 1);
}
