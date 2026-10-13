/**
 * 最近打开过的站点（浏览器里切换站点用）：记在 ~/.mori-studio/recent.json，最多 8 个，最近的在前。
 * 桌面版有自己的一份（应用配置目录里的 recent.json）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const FILE = join(homedir(), '.mori-studio', 'recent.json');
const MAX = 8;

const read = () => { try { const l = JSON.parse(readFileSync(FILE, 'utf8')); return Array.isArray(l) ? l.filter((p) => typeof p === 'string') : []; } catch { return []; } };

/** 还在的站点（目录里有 mori.config.*），最近的在前 */
export function readRecent() {
  return read().filter((p) => existsSync(p)).map((path) => ({ path, name: basename(path) }));
}

export function addRecent(root) {
  if (process.env.MORI_STUDIO_KEYCHAIN === '0') return; // 测试
  const p = resolve(root);
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify([p, ...read().filter((x) => x !== p)].slice(0, MAX)));
  } catch { /* 记不下来就算了 */ }
}
