#!/usr/bin/env node
/**
 *   mori-studio [--root 站点项目目录] [--port 4400] [--dev]
 *   MORI_STUDIO_PARENT=stdin：标准输入关了就退出（桌面版用）
 *   MORI_STUDIO_DIST=目录：界面构建到哪里（默认 dist/；桌面版每个项目一份）
 *   --dev（或环境变量 MORI_STUDIO_DEV=1）：开发模式。构建后自动重启预览用的 astro dev，发布目标里多一个“本地文件夹”。不加就是正常运行。
 * 在站点项目的根目录运行（那里有 mori.config.ts 和 src/content），然后打开输出的地址。
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { themeExports, useTheme } from '../src/theme.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * 界面（app/）是用 Vite 构建的，项目里的主题模块也打包进去。
 * 没构建过、换了项目、或者界面源码 / 项目的主题模块比构建产物新，就先构建一次（几秒钟）
 */
async function ensureUi(root) {
  if (process.env.MORI_STUDIO_NO_BUILD === '1') return;
  const dist = process.env.MORI_STUDIO_DIST ?? join(here, '../dist');
  const out = join(dist, 'index.html');
  const stamp = join(dist, '.root');
  const newest = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((t, e) => Math.max(t, e.isDirectory() ? newest(join(dir, e.name)) : statSync(join(dir, e.name)).mtimeMs), 0);
  const theme = [...new Set(Object.values(themeExports(root)).map(dirname))].filter(existsSync).map(newest);
  const src = Math.max(newest(join(here, '../app/src')), statSync(join(here, '../app/index.html')).mtimeMs, ...theme);
  if (existsSync(out) && statSync(out).mtimeMs >= src && existsSync(stamp) && readFileSync(stamp, 'utf8') === root) return;
  console.log('正在构建界面（第一次运行、换了项目、或界面有更新时才需要，几秒钟）……');
  process.env.MORI_ROOT = root;
  const { build } = await import('vite');
  await build({ configFile: join(here, '../app/vite.config.ts'), logLevel: 'warn' });
  writeFileSync(stamp, root);
}


const args = process.argv.slice(2);
const opt = (name, def) => { const k = args.indexOf(`--${name}`); return k >= 0 ? args[k + 1] : def; };

try {
  const project = resolve(opt('root', process.cwd()));
  useTheme(project);
  await ensureUi(project);
  const { startStudio } = await import('../src/server.mjs');
  const dev = args.includes('--dev') || process.env.MORI_STUDIO_DEV === '1';
  const { url, root } = await startStudio({ root: project, port: +opt('port', 4400), dev });
  // 桌面版：壳通过标准输入连着我们，管道断了（壳退出、崩溃、被杀）就跟着退出，不留孤儿进程
  if (process.env.MORI_STUDIO_PARENT === 'stdin') { process.stdin.on('end', () => process.exit(0)); process.stdin.resume(); }
  console.log(`MORI Studio${dev ? '（开发模式）' : ''}\n  项目  ${root}\n  地址  ${url}\n\n只监听本机（127.0.0.1）。Ctrl+C 退出。`);
} catch (e) {
  console.error(`启动失败：${e.message}`);
  process.exit(1);
}
