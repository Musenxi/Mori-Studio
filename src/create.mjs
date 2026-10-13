/**
 * 新建站点、给站点装依赖。桌面版的启动页（经 mori-studio create / install --json）和命令行都走这里。
 * 主题从模板仓库下载：有 git 就克隆，远端叫 template（主题里的 theme:update 从它拉更新）；没有 git 就下 GitHub 的压缩包。
 * 进度通过 onEvent 报：{ step: 'download' | 'install', state: 'start' | 'done', … }，过程中的输出是 { log }。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { themeExports } from './theme.mjs';

export const THEME_REPO = 'https://github.com/Musenxi/Astro-Theme-Mori.git';
export const THEME_BRANCH = 'main';

const WIN = process.platform === 'win32';
/** 文件夹里有这些也算空的 */
const IGNORABLE = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

export const isEmptyDir = (dir) => readdirSync(dir).every((f) => IGNORABLE.has(f));

/** git 在哪；没有是 null。macOS 没装命令行工具时，/usr/bin/git 只是个占位，一运行就弹安装窗口，不能用它试 */
export function findGit() {
  if (process.platform === 'darwin' && spawnSync('xcode-select', ['-p'], { stdio: 'ignore' }).status !== 0) {
    const dir = (process.env.PATH ?? '').split(delimiter).find((d) => d && d !== '/usr/bin' && existsSync(join(d, 'git')));
    return dir ? join(dir, 'git') : null;
  }
  return spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0 ? 'git' : null;
}

/** 有 pnpm 用 pnpm（主题的锁文件是它的），没有用 Node 自带的 npm。Windows 上它们是 .cmd，要经 shell 运行 */
export function packageManager() {
  return spawnSync('pnpm', ['--version'], { stdio: 'ignore', shell: WIN }).status === 0 ? 'pnpm' : 'npm';
}

const cancelled = () => Object.assign(new Error('已取消'), { name: 'AbortError' });

/** 跑一条命令，输出一行行交给 onLog（去掉颜色，进度条的 \r 也当换行）；失败时错误里带最后几行。signal 中止时连子进程一起停掉 */
function run(cmd, args, { cwd, onLog = () => {}, signal } = {}) {
  return new Promise((ok, fail) => {
    if (signal?.aborted) return fail(cancelled());
    const c = spawn(cmd, args, { cwd, shell: WIN, stdio: ['ignore', 'pipe', 'pipe'] });
    // Windows 上命令是经 cmd 起的，只停 cmd 停不掉它下面的 git / pnpm，要连进程树一起停
    const stop = () => (WIN ? spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' }) : c.kill('SIGTERM'));
    signal?.addEventListener('abort', stop, { once: true });
    const tail = [];
    const reader = () => {
      let rest = '';
      return (buf) => {
        const parts = (rest + buf.toString('utf8')).split(/\r\n|\r|\n/);
        rest = parts.pop();
        for (const raw of parts) {
          const line = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trimEnd();
          if (!line.trim()) continue;
          tail.push(line);
          if (tail.length > 30) tail.shift();
          onLog(line);
        }
      };
    };
    c.stdout.on('data', reader());
    c.stderr.on('data', reader());
    c.on('error', (e) => fail(new Error(e.code === 'ENOENT' ? `没有找到 ${cmd}` : `运行 ${cmd} 失败：${e.message}`)));
    c.on('close', (code) => {
      signal?.removeEventListener('abort', stop);
      if (signal?.aborted) return fail(cancelled());
      if (code === 0) return ok();
      // 错误一般在最后几行；npm / pnpm 的错误行带 ERR
      const err = tail.filter((l) => /\bERR|error|fatal/i.test(l)).slice(-3);
      fail(new Error((err.length ? err : tail.slice(-3)).join('\n') || `${cmd} 失败（退出码 ${code}）`));
    });
  });
}

/** 仓库地址：https 网址、git@ 地址或本机路径；分支 / 标签名只能有常见字符 */
export function checkSource({ repo = THEME_REPO, branch = THEME_BRANCH } = {}) {
  repo = String(repo ?? '').trim() || THEME_REPO;
  branch = String(branch ?? '').trim() || THEME_BRANCH;
  if (repo.startsWith('-') || /\s/.test(repo)) throw new Error('主题仓库的地址不对');
  if (!/^[\w./-]+$/.test(branch) || branch.startsWith('-')) throw new Error('分支名里有不合法的字符');
  return { repo, branch };
}

export function checkRegistry(registry) {
  const r = String(registry ?? '').trim().replace(/\/+$/, '');
  if (!r) return '';
  if (!/^https?:\/\/[^\s]+$/.test(r)) throw new Error('依赖源要是 http:// 或 https:// 开头的网址');
  return `${r}/`;
}

/** 没有 git：从 GitHub 下 tar.gz 压缩包解开 */
async function downloadArchive(repo, branch, dir, onLog, signal) {
  const m = repo.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if (!m) throw new Error('没有找到 git，只能从 GitHub 下载主题');
  const r = await fetch(`https://codeload.github.com/${m[1]}/${m[2]}/tar.gz/${branch}`, { signal }).catch((e) => { throw signal?.aborted ? cancelled() : new Error(`连不上 GitHub（${e.cause?.code ?? e.message}）`); });
  if (!r.ok) throw new Error(r.status === 404 ? `没有找到 ${m[1]}/${m[2]} 的 ${branch}` : `下载主题失败（${r.status}）`);
  const tmp = mkdtempSync(join(tmpdir(), 'mori-theme-'));
  const file = join(tmp, 'theme.tar.gz');
  try {
    let got = 0, shown = 0;
    const body = Readable.fromWeb(r.body);
    body.on('data', (c) => { got += c.length; if (got - shown > 512 * 1024) { shown = got; onLog(`已下载 ${(got / 1048576).toFixed(1)} MB`); } });
    await pipeline(body, createWriteStream(file), { signal }).catch((e) => { throw signal?.aborted ? cancelled() : e; });
    await run('tar', ['-xzf', file, '-C', dir, '--strip-components=1'], { onLog, signal });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * 新建站点：下载主题到 dir（不存在就建，存在要是空的），再装依赖。
 * 下载失败、或者中途取消（signal），建了一半的都删掉；只是装依赖失败时主题留着，之后可以只重装依赖（installDeps）。
 */
export async function createSite({ dir, repo, branch, registry, onEvent = () => {}, signal }) {
  if (!dir) throw new Error('要指定新站点的文件夹');
  dir = resolve(dir);
  ({ repo, branch } = checkSource({ repo, branch }));
  registry = checkRegistry(registry);
  const existed = existsSync(dir);
  if (existed && !isEmptyDir(dir)) throw new Error(`${dir} 里已经有文件了`);
  const onLog = (log) => onEvent({ log });
  const cleanup = () => {
    if (existed) for (const f of readdirSync(dir)) rmSync(join(dir, f), { recursive: true, force: true });
    else rmSync(dir, { recursive: true, force: true });
  };

  onEvent({ step: 'download', state: 'start' });
  try {
    mkdirSync(dir, { recursive: true });
    for (const f of IGNORABLE) rmSync(join(dir, f), { force: true }); // git clone 只肯往真正空的文件夹里放
    const git = findGit();
    if (git) await run(git, ['clone', '--progress', '--origin', 'template', '--branch', branch, repo, dir], { onLog, signal });
    else await downloadArchive(repo, branch, dir, onLog, signal);
    try { themeExports(dir); } catch { throw new Error('下载下来的不是 Mori 主题'); }
    onEvent({ step: 'download', state: 'done', via: git ? 'git' : 'archive' });
  } catch (e) {
    cleanup();
    throw e;
  }
  // 新站点第一次在 Studio 里打开时走一遍引导（刊名、作者、评论服务）
  writeFileSync(join(dir, '.mori-studio.json'), JSON.stringify({ welcome: true }) + '\n', { mode: 0o600 });
  try {
    await installDeps(dir, { registry, onEvent, signal });
  } catch (e) {
    if (signal?.aborted) cleanup();
    throw e;
  }
  return dir;
}

/** 站点的依赖装好了没有（Studio 要用项目里的 astro） */
export const hasDeps = (root) => existsSync(join(root, 'node_modules/astro/package.json'));

/** 装依赖：pnpm install（没有 pnpm 就 npm install）；registry 是依赖源，空的用默认的 */
export async function installDeps(root, { registry, onEvent = () => {}, signal } = {}) {
  root = resolve(root);
  registry = checkRegistry(registry);
  const pm = packageManager();
  onEvent({ step: 'install', state: 'start', pm });
  const args = pm === 'pnpm' ? ['install'] : ['install', '--no-audit', '--no-fund'];
  if (registry) args.push('--registry', registry);
  await run(pm, args, { cwd: root, onLog: (log) => onEvent({ log }), signal });
  if (!hasDeps(root)) throw new Error('依赖装完了，但没有找到 astro');
  onEvent({ step: 'install', state: 'done', pm });
}
