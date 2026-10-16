/**
 * 表情包管理：站点 public/emoji/ 下每个文件夹是一个包，里面每张图是一个表情（文件名去掉扩展名是表情名），内容里写 :[包名_表情名]。
 * 规则和主题的 astro-mori/emoji 一致；这里多列出空的包（好往里传图），pack.json 里登记的链接只读。
 * 改名时把文章、页面里的引用一起改；删除移进回收站。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { recordTrash, TRASH } from './trash.mjs';

export const EMOJI_EXT = /^\.(png|gif|webp|svg|avif|jpe?g)$/i;
const BAD = /[\s:[\]/\\]/;
const dirOf = (root) => join(root, 'public/emoji');

/** 包名、表情名：不能空、不能有空格冒号方括号斜杠、不能以 . 开头 */
export function cleanName(name, what = '名字') {
  const s = String(name ?? '').trim();
  if (!s || s.length > 64 || BAD.test(s) || s.startsWith('.')) throw new Error(`${what}不能为空，不能有空格、冒号、方括号和斜杠`);
  return s;
}

const packDir = (root, pack) => {
  const d = join(dirOf(root), cleanName(pack, '包名'));
  if (!existsSync(d) || !statSync(d).isDirectory()) throw new Error('没有这个表情包');
  return d;
};
const images = (dir) => readdirSync(dir).filter((f) => EMOJI_EXT.test(extname(f)) && !BAD.test(f.slice(0, -extname(f).length))).sort((a, b) => a.localeCompare(b, 'zh', { numeric: true }));
const stem = (f) => f.slice(0, -extname(f).length);
const readMeta = (dir) => { try { return JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')); } catch { return null; } };
const fileOf = (dir, name) => images(dir).find((f) => stem(f) === name);

/** 所有包（含空的）：[{ id, title, items: [{ name, key, file?, url?, size? }] }]，file 是本地图，url 是 pack.json 里的链接 */
export function listEmoji(root) {
  const base = dirOf(root);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !BAD.test(e.name) && !e.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    .map(({ name: id }) => {
      const dir = join(base, id), meta = readMeta(dir);
      const items = new Map(images(dir).map((f) => [stem(f), { name: stem(f), key: `${id}_${stem(f)}`, file: f, size: statSync(join(dir, f)).size }]));
      for (const [name, url] of Object.entries(meta?.items ?? {})) if (typeof url === 'string' && !BAD.test(name)) items.set(name, { name, key: `${id}_${name}`, url });
      return { id, title: typeof meta?.title === 'string' && meta.title ? meta.title : id, items: [...items.values()] };
    });
}

export function createPack(root, pack) {
  const id = cleanName(pack, '包名');
  const d = join(dirOf(root), id);
  if (existsSync(d)) throw new Error('已经有这个表情包了');
  mkdirSync(d, { recursive: true });
  return id;
}

/** 存一张表情图：文件名里不能用的字符换成 -，同名加序号。返回表情名 */
export function saveEmoji(root, pack, fileName, body) {
  const dir = packDir(root, pack);
  const ext = extname(fileName).toLowerCase();
  if (!EMOJI_EXT.test(ext)) throw new Error('表情要是 PNG、GIF、WebP、SVG、AVIF 或 JPG');
  const raw = stem(fileName).trim().replace(/[\s:[\]/\\]+/g, '-').replace(/^\.+/, '') || 'emoji';
  const taken = new Set([...images(dir).map(stem), ...Object.keys(readMeta(dir)?.items ?? {})]);
  let name = raw;
  for (let i = 2; taken.has(name); i++) name = `${raw}-${i}`;
  writeFileSync(join(dir, `${name}${ext}`), body);
  return name;
}

/** 把内容里的表情引用改名（map: 旧键 → 新键）：带 emoji 标注的文字，和字符串里写的 :[旧键] */
export function rewriteEmojiRefs(root, map) {
  const pairs = [...map].filter(([a, b]) => a !== b);
  if (!pairs.length) return 0;
  const to = new Map(pairs);
  const fix = (s) => pairs.reduce((t, [a, b]) => t.replaceAll(`:[${a}]`, `:[${b}]`), s);
  const walk = (v) => {
    if (typeof v === 'string') return fix(v);
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== 'object') return v;
    const out = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    if (typeof v.t === 'string' && Array.isArray(v.marks) && v.marks.some((m) => m?.type === 'emoji') && to.has(v.t)) out.t = to.get(v.t);
    return out;
  };
  let changed = 0;
  for (const base of ['src/content', 'src/published']) {
    for (const k of ['posts', 'pages']) {
      const d = join(root, base, k);
      if (!existsSync(d)) continue;
      for (const f of readdirSync(d).filter((x) => x.endsWith('.json'))) {
        const raw = readFileSync(join(d, f), 'utf8');
        let doc;
        try { doc = JSON.parse(raw); } catch { continue; }
        const next = walk(doc);
        if (JSON.stringify(next) === JSON.stringify(doc)) continue;
        writeFileSync(join(d, f), JSON.stringify(next, null, 2) + '\n');
        changed++;
      }
    }
  }
  return changed;
}

/** 包改名：文件夹改名，所有表情的引用一起改 */
export function renamePack(root, pack, next) {
  const from = packDir(root, pack), id = cleanName(next, '包名');
  if (id === pack) return id;
  const dest = join(dirOf(root), id);
  if (existsSync(dest)) throw new Error('已经有这个表情包了');
  const keys = listEmoji(root).find((p) => p.id === pack)?.items.map((it) => it.name) ?? [];
  renameSync(from, dest);
  rewriteEmojiRefs(root, new Map(keys.map((n) => [`${pack}_${n}`, `${id}_${n}`])));
  return id;
}

/** 表情改名（只改本地图，扩展名不变） */
export function renameEmoji(root, pack, name, next) {
  const dir = packDir(root, pack), to = cleanName(next, '表情名');
  const f = fileOf(dir, name);
  if (!f) throw new Error('没有这个表情');
  if (to === name) return to;
  if (fileOf(dir, to) || Object.hasOwn(readMeta(dir)?.items ?? {}, to)) throw new Error('这个包里已经有同名的表情了');
  renameSync(join(dir, f), join(dir, to + extname(f)));
  rewriteEmojiRefs(root, new Map([[`${pack}_${name}`, `${pack}_${to}`]]));
  return to;
}

/** 删除一个包（不带 name）或一个表情：移进回收站 */
export function trashEmoji(root, pack, name) {
  const dir = packDir(root, pack);
  const f = name === undefined ? null : fileOf(dir, name);
  if (name !== undefined && !f) throw new Error('没有这个表情');
  const orig = `public/emoji/${pack}${f ? `/${f}` : ''}`;
  const stamp = `${Date.now()}-${pack}${f ? `_${f}` : ''}`;
  mkdirSync(join(root, TRASH, 'emoji'), { recursive: true });
  renameSync(join(root, orig), join(root, TRASH, 'emoji', stamp));
  recordTrash(root, { key: `emoji:${stamp}`, kind: 'emoji', label: f ? `${pack}/${f}` : pack, files: [[`${TRASH}/emoji/${stamp}`, orig]] });
}
