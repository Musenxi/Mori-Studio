/**
 * 回收站：删除的文章、页面、图片都移进项目的 .mori-trash/（不进 git），这里列出、还原、彻底删除。
 * 每次删除在 .mori-trash/index.json 记一条：放进去的文件、它们原来在哪、哪些图挪去了共用（还原时把引用改回来）。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

/** 回收站里的东西，新删的在前 */
export function listTrash(root) {
  return readIndex(root).filter((it) => it.files.some(([t]) => existsSync(join(root, t))))
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
