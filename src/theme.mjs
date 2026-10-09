/**
 * 主题的格式代码（文章结构、Markdown 转换、校验……）不随 Studio 带一份，而是从打开的项目里读：
 * MORI 项目本身就是主题的副本，package.json 的 exports 写着 astro-mori/flow 等文件在哪。
 * 这样 Studio 总是跟着项目的主题版本走。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { register } from 'node:module';

/** 'astro-mori/flow' → 项目里的绝对路径 */
export function themeExports(root) {
  root = resolve(root);
  const f = join(root, 'package.json');
  const exp = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).exports : null;
  if (!exp?.['./flow']) throw new Error(`${root} 不是 MORI 项目（package.json 的 exports 里没有 ./flow）`);
  return Object.fromEntries(Object.entries(exp).map(([k, v]) => [k === '.' ? 'astro-mori' : `astro-mori/${k.slice(2)}`, resolve(root, v)]));
}

/** 让 Node 里的 import 'astro-mori/…' 指向项目里的文件。要在导入 server.mjs 之前调用 */
export function useTheme(root) {
  register(new URL('./theme-hook.mjs', import.meta.url), { data: themeExports(root) });
}
