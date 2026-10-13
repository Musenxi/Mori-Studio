#!/usr/bin/env node
/**
 *   mori-studio [--root 站点项目目录] [--port 4400] [--dev]
 *   mori-studio mcp [--root 站点项目目录]：MCP（stdio），给 Claude 桌面版这类客户端用。这个项目有 Studio 在跑就连过去，没有就自己起一个（不带界面）
 *   mori-studio create <目录> [--repo 主题仓库] [--branch main] [--registry 依赖源] [--json]：下载主题新建站点，装好依赖
 *   mori-studio install [--root 站点项目目录] [--registry 依赖源] [--json]：给站点装依赖
 *     --json：进度一行一个 JSON（桌面版的启动页读它）
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
  const env = process.env.NODE_ENV; // vite build 会把整个进程的 NODE_ENV 设成 production，预览用的 Astro 也在这个进程里
  await build({ configFile: join(here, '../app/vite.config.ts'), logLevel: 'warn' });
  if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env;
  writeFileSync(stamp, root);
}


const args = process.argv.slice(2);
const opt = (name, def) => { const k = args.indexOf(`--${name}`); return k >= 0 ? args[k + 1] : def; };

/** MCP：标准输出只留给协议，日志都去标准错误 */
async function mcp(project) {
  console.log = console.error;
  const { findRunning } = await import('../src/running.mjs');
  let own = null;
  const base = async () => {
    const running = await findRunning(project);
    if (running) return running;
    if (!own) { const { startStudio } = await import('../src/server.mjs'); own = (await startStudio({ root: project, port: 0 })).url.replace(/\/$/, ''); }
    return own;
  };
  const { createMcpServer } = await import('../src/mcp.mjs');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  await createMcpServer(base).connect(new StdioServerTransport());
  process.stdin.on('end', () => process.exit(0)); // 客户端断开；自己起的 Studio 会让进程一直挂着，所以要主动退
}

/** create / install：进度打印出来；--json 时一行一个 JSON，出错也是 { error } */
async function setup(cmd) {
  const json = args.includes('--json');
  const { createSite, installDeps } = await import('../src/create.mjs');
  const STEPS = { download: '下载主题', install: '安装依赖' };
  const onEvent = (e) => {
    if (json) return console.log(JSON.stringify(e));
    if (e.log) console.log(`  ${e.log}`);
    else if (e.state === 'start') console.log(`▸ ${STEPS[e.step]}`);
  };
  // 桌面版取消（或退出）时关掉标准输入：停下正在跑的 git / pnpm，新建了一半的站点删掉
  const ac = new AbortController();
  if (process.env.MORI_STUDIO_PARENT === 'stdin') { process.stdin.on('end', () => ac.abort()); process.stdin.resume(); }
  try {
    const registry = opt('registry'), signal = ac.signal;
    let root;
    if (cmd === 'create') root = await createSite({ dir: args[1]?.startsWith('--') ? '' : args[1], repo: opt('repo'), branch: opt('branch'), registry, onEvent, signal });
    else await installDeps((root = resolve(opt('root', process.cwd()))), { registry, onEvent, signal });
    // 标准输入还开着，要主动退；输出到管道是异步的，写完再退
    if (json) process.stdout.write(JSON.stringify({ done: true, root }) + '\n', () => process.exit(0));
    else process.stdout.write(`\n完成：${root}\n`, () => process.exit(0));
  } catch (e) {
    if (json) process.stdout.write(JSON.stringify({ error: e.message, cancelled: e.name === 'AbortError' || undefined }) + '\n', () => process.exit(1));
    else process.stderr.write(`失败：${e.message}\n`, () => process.exit(1));
  }
}

if (args[0] === 'create' || args[0] === 'install') await setup(args[0]);
else try {
  const project = resolve(opt('root', process.cwd()));
  if (args[0] === 'mcp') {
    useTheme(project);
    await mcp(project);
  } else {
    useTheme(project);
    await ensureUi(project);
    const { startStudio } = await import('../src/server.mjs');
    const dev = args.includes('--dev') || process.env.MORI_STUDIO_DEV === '1';
    const { url, root } = await startStudio({ root: project, port: +opt('port', 4400), dev });
    // 桌面版：壳通过标准输入连着我们，管道断了（壳退出、崩溃、被杀）就跟着退出，不留孤儿进程
    if (process.env.MORI_STUDIO_PARENT === 'stdin') { process.stdin.on('end', () => process.exit(0)); process.stdin.resume(); }
    console.log(`Mori Studio${dev ? '（开发模式）' : ''}\n  项目  ${root}\n  地址  ${url}\n\n只监听本机（127.0.0.1）。Ctrl+C 退出。`);
  }
} catch (e) {
  console.error(`启动失败：${e.message}`);
  process.exit(1);
}
