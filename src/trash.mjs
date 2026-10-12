/**
 * 回收站：删除的文章、页面、图片都移进项目的 .mori-trash/（不进 git），这里列出、还原、彻底删除。
 * 每次删除在 .mori-trash/index.json 记一条：放进去的文件、它们原来在哪、哪些图挪去了共用（还原时把引用改回来）。
 * 有这份记录之前删的，按文件名推断原位置。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { rewriteRefs } from './library.mjs';

export const TRASH = '.mori-trash';
const indexFile = (root) => join(root, TRASH, 'index.json');
const readIndex = (root) => { try { return JSON.parse(readFileSync(indexFile(root), 'utf8')); } catch { return []; } };
const writeIndex = (root, items) => { mkdirSync(join(root, TRASH), { recursive: true }); writeFileSync(indexFile(root), JSON.stringify(items, null, 2) + '\n'); };

/**
 * 记一条删除。item: { key, kind: 'post' | 'page' | 'asset', label, files: [[回收站里的路径, 原路径], …], moved?: [[原路径, 现在的路径], …] }，路径都相对项目根目录
 */
export function recordTrash(root, item) {
  writeIndex(root, [...readIndex(root), { ...item, deletedAt: Date.now() }]);
}

const sizeOf = (f) => {
  try {
    const s = statSync(f);
    return s.isDirectory() ? readdirSync(f).reduce((n, x) => n + sizeOf(join(f, x)), 0) : s.size;
  } catch { return 0; }
};

/** 没有记录的旧条目：按文件名推断 */
function legacyItems(root, known) {
  const dir = join(root, TRASH), out = [];
  if (!existsSync(dir)) return out;
  const ENTRY = /^(\d+)-(post|travel|page)-(.+?)(\.published)?\.json$/;
  const entries = new Map();
  for (const f of readdirSync(dir)) {
    const m = ENTRY.exec(f);
    if (!m || known.has(`${TRASH}/${f}`)) continue;
    const [, stamp, k, id, pub] = m;
    const kind = k === 'page' ? 'page' : 'post', folder = kind === 'page' ? 'pages' : 'posts';
    const key = `${stamp}-${kind}-${id}`;
    const e = entries.get(key) ?? { key: `legacy:${key}`, kind, label: id, deletedAt: +stamp, files: [] };
    e.files.push([`${TRASH}/${f}`, pub ? `src/published/${folder}/${id}.json` : `src/content/${folder}/${id}.json`]);
    if (!pub) { try { e.label = JSON.parse(readFileSync(join(dir, f), 'utf8')).title || id; } catch { /* 保留 id */ } }
    const imgs = `${TRASH}/assets/${stamp}-${folder}_${id}`;
    if (!e.files.some(([t]) => t === imgs) && existsSync(join(root, imgs)) && !known.has(imgs)) e.files.push([imgs, `src/assets/${folder}/${id}`]);
    entries.set(key, e);
  }
  out.push(...entries.values());

  // 图片：<时间>-<原路径，/ 换成了 _>；文章 id 里也可能有 _，用已知的 id（现有的和回收站里的）去对
  const ids = new Set([...readdirSync(dir)].map((f) => ENTRY.exec(f)?.[3]).filter(Boolean));
  for (const k of ['posts', 'pages']) { try { for (const f of readdirSync(join(root, 'src/content', k))) ids.add(basename(f, '.json')); } catch { /* 没有这个目录 */ } }
  const guess = (name) => {
    const [top, ...rest] = name.split('_');
    if (top === 'shared' || !rest.length) return `${top}/${rest.join('_')}`;
    const tail = rest.join('_');
    const id = [...ids].filter((x) => tail === x || tail.startsWith(`${x}_`)).sort((a, b) => b.length - a.length)[0] ?? rest[0];
    return tail === id ? `${top}/${id}` : `${top}/${id}/${tail.slice(id.length + 1)}`;
  };
  const adir = join(dir, 'assets');
  const claimed = new Set(out.flatMap((e) => e.files.map(([t]) => t)));
  if (existsSync(adir)) {
    const names = readdirSync(adir);
    for (const f of names) {
      const t = `${TRASH}/assets/${f}`, m = /^(\d+)-(.+)$/.exec(f);
      if (!m || known.has(t) || claimed.has(t)) continue;
      // 实况视频跟着同名的图片走
      if (f.endsWith('.mp4') && names.some((g) => g !== f && g.replace(/\.[^.]+$/, '') === f.replace(/\.mp4$/, ''))) continue;
      const orig = `src/assets/${guess(m[2])}`;
      const files = [[t, orig]];
      const video = names.find((g) => g === f.replace(/\.[^.]+$/, '.mp4') && g !== f);
      if (video) files.push([`${TRASH}/assets/${video}`, orig.replace(/\.[^.]+$/, '.mp4')]);
      out.push({ key: `legacy:${t}`, kind: 'asset', label: orig.slice('src/assets/'.length), deletedAt: +m[1], files });
    }
  }
  return out;
}

/** 回收站里的东西，新删的在前 */
export function listTrash(root) {
  const indexed = readIndex(root).filter((it) => it.files.some(([t]) => existsSync(join(root, t))));
  const known = new Set(indexed.flatMap((it) => it.files.map(([t]) => t)));
  return [...indexed, ...legacyItems(root, known)]
    .map((it) => ({ ...it, size: it.files.reduce((n, [t]) => n + sizeOf(join(root, t)), 0) }))
    .sort((a, b) => b.deletedAt - a.deletedAt);
}

const find = (root, key) => {
  const it = listTrash(root).find((x) => x.key === key);
  if (!it) throw new Error('回收站里没有这一项');
  return it;
};
const drop = (root, key) => writeIndex(root, readIndex(root).filter((x) => x.key !== key));

/** 放回原处。原处已经有同名的就不动，报出来 */
export function restoreTrash(root, key) {
  const it = find(root, key);
  const files = it.files.filter(([t]) => existsSync(join(root, t)));
  const taken = files.find(([, o]) => existsSync(join(root, o)));
  if (taken) throw new Error(`原来的位置已经有 ${taken[1]} 了，先改名或删掉它再还原`);
  for (const [t, o] of files) {
    mkdirSync(dirname(join(root, o)), { recursive: true });
    renameSync(join(root, t), join(root, o));
  }
  // 删除时被别的内容用到、挪去共用的图：还原的这篇里的引用也改过去
  if (it.moved?.length) rewriteRefs(root, new Map(it.moved));
  drop(root, key);
  return it;
}

/** 彻底删除一项 */
export function purgeTrash(root, key) {
  const it = find(root, key);
  for (const [t] of it.files) rmSync(join(root, t), { recursive: true, force: true });
  drop(root, key);
}

/** 清空 */
export function emptyTrash(root) {
  rmSync(join(root, TRASH), { recursive: true, force: true });
}
