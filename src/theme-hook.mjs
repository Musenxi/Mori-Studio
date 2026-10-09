/** Node 的模块解析钩子：astro-mori/… 换成项目里的文件（由 theme.mjs 的 useTheme 注册） */
import { pathToFileURL } from 'node:url';

let map = {};
export function initialize(data) { map = data; }
export async function resolve(specifier, context, next) {
  return map[specifier] ? { url: pathToFileURL(map[specifier]).href, shortCircuit: true } : next(specifier, context);
}
