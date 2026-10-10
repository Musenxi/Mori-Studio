/** Node 的模块解析钩子：astro-mori/… 换成项目里的文件（由 theme.mjs 的 useTheme 注册） */
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';

let map = {};
export function initialize(data) { map = data; }
export async function resolve(specifier, context, next) {
  return map[specifier] ? { url: pathToFileURL(map[specifier]).href, shortCircuit: true } : next(specifier, context);
}
/** Node 不给 node_modules 里的 .ts 去类型（主题作为依赖装进来时就在那里），这里自己去 */
export async function load(url, context, next) {
  if (!url.startsWith('file:') || !url.endsWith('.ts') || !url.includes('/node_modules/')) return next(url, context);
  const source = stripTypeScriptTypes(await readFile(new URL(url), 'utf8'));
  return { format: 'module', source, shortCircuit: true };
}
