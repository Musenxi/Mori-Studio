/**
 * 检查更新、更新：主题（站点仓库里的 template 远端）和评论服务（读 GitHub 上的版本号）。
 * 主题的更新和 `pnpm theme:update` 一样是把 template/main 合并进当前分支；冲突就放弃这次合并，仓库保持原样。
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { installDeps } from './create.mjs';

const TEMPLATE = 'https://github.com/Musenxi/Astro-Theme-Mori.git';
const STUDIO_PACKAGE = 'https://raw.githubusercontent.com/Musenxi/Mori-Studio/main/package.json';
const STUDIO_RELEASE = 'https://github.com/Musenxi/Mori-Studio/releases/latest/download/latest.json';
const COMMENT_PACKAGE = 'https://raw.githubusercontent.com/Musenxi/Mori-Comment/main/package.json';

function git(root, args, { timeout = 30_000, env } = {}) {
  return new Promise((ok, fail) => {
    execFile('git', args, { cwd: root, timeout, maxBuffer: 8 << 20, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env } }, (err, stdout, stderr) => {
      if (err) fail(Object.assign(new Error((stderr || stdout || err.message).trim()), { stdout, stderr }));
      else ok(stdout.trim());
    });
  });
}

/** 站点自己的 scripts/update-theme.mjs 里写的模板地址；没有就用默认的 */
function templateUrl(root) {
  try { return readFileSync(join(root, 'scripts/update-theme.mjs'), 'utf8').match(/TEMPLATE\s*=\s*'([^']+)'/)?.[1] ?? TEMPLATE; } catch { return TEMPLATE; }
}

/** 站点得是一个 git 仓库（根目录就是仓库根），主题才能靠合并升级 */
async function ensureRepo(root) {
  let top = '';
  try { top = await git(root, ['rev-parse', '--show-toplevel']); } catch { /* 下面报错 */ }
  if (!top || realpathSync(top) !== realpathSync(root)) throw new Error('站点文件夹不是 git 仓库，没法更新主题');
}

async function ensureRemote(root) {
  try { await git(root, ['remote', 'get-url', 'template']); } catch { await git(root, ['remote', 'add', 'template', templateUrl(root)]); }
}

/** 主题有没有更新：比站点和 template/main 上 package.json 的版本号；有新版时附上最近几条提交 */
export async function checkTheme(root) {
  await ensureRepo(root);
  await ensureRemote(root);
  await git(root, ['fetch', 'template'], { timeout: 90_000 });
  const version = String(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version ?? '0.0.0');
  const latest = String(JSON.parse(await git(root, ['show', 'template/main:package.json'])).version ?? version);
  const outdated = compareVersions(latest, version) > 0;
  const log = outdated ? await git(root, ['log', '-n', '8', '--format=%h%x09%s', 'HEAD..template/main']).catch(() => '') : '';
  return { version, latest, outdated, commits: log ? log.split('\n').map((l) => { const [hash, ...s] = l.split('\t'); return { hash, subject: s.join('\t') }; }) : [] };
}

/**
 * 更新主题：合并 template/main。依赖变了就重新装。
 * 合并不成（冲突、或者本地没提交的修改会被盖掉）就退回原样，把原因告诉调用方。
 */
export async function updateTheme(root, { registry } = {}) {
  await ensureRepo(root);
  await ensureRemote(root);
  await git(root, ['fetch', 'template'], { timeout: 90_000 });
  if (existsSync(join(root, '.git/MERGE_HEAD'))) throw new Error('仓库里有一次没做完的合并，先处理完');
  const before = await git(root, ['rev-parse', 'HEAD']);
  try {
    await git(root, ['merge', 'template/main', '--allow-unrelated-histories', '--no-edit'], { timeout: 120_000, env: { GIT_MERGE_AUTOEDIT: 'no' } });
  } catch (e) {
    const conflicts = await git(root, ['diff', '--name-only', '--diff-filter=U']).catch(() => '');
    await git(root, ['merge', '--abort']).catch(() => {});
    throw new Error(conflicts ? `有冲突，已放弃这次更新：\n${conflicts}` : e.message);
  }
  const changed = (await git(root, ['diff', '--name-only', before, 'HEAD'])).split('\n').filter(Boolean);
  const reinstall = changed.some((f) => f === 'package.json' || /(^|\/)(pnpm-lock\.yaml|package-lock\.json)$/.test(f));
  if (reinstall) await installDeps(root, { registry });
  return { changed: changed.length, installed: reinstall };
}

/** 'a.b.c' 比大小：a 比 b 新返回 1，旧 -1，一样 0 */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0), pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}

/** 读一个网址的文本。Node 自带的 fetch 不认 HTTP(S)_PROXY（NODE_USE_ENV_PROXY 没开时），有代理就交给 curl */
async function download(url) {
  const proxied = Object.keys(process.env).some((k) => /^https?_proxy$/i.test(k) && process.env[k]);
  if (!proxied || process.env.NODE_USE_ENV_PROXY === '1') {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`读不到 ${url}（${r.status}）`);
    return r.text();
  }
  return new Promise((ok, fail) => {
    execFile('curl', ['-sfL', '-m', '15', url], { maxBuffer: 1 << 20 }, (err, stdout) => (err ? fail(new Error(`读不到 ${url}`)) : ok(stdout)));
  });
}

/** 评论服务在 GitHub 上的最新版本号 */
export async function latestCommentVersion(url = COMMENT_PACKAGE) {
  const v = JSON.parse(await download(url)).version;
  if (!v) throw new Error('评论服务的 package.json 里没有版本号');
  return String(v);
}

/**
 * Studio 自己：桌面版看 GitHub Release 的 latest.json（应用启动时会提示更新，页面上不能代它装）；
 * 命令行版看 main 上的 package.json，装在 git 仓库里的可以直接 pull 更新。
 */
export async function checkStudio(dir, { desktop }) {
  const version = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
  const latest = String((JSON.parse(await download(desktop ? STUDIO_RELEASE : STUDIO_PACKAGE))).version).replace(/^v/, '');
  let canUpdate = false;
  if (!desktop) { try { await ensureRepo(dir); canUpdate = true; } catch { /* 不是 git 仓库：只能提示命令 */ } }
  return { version, latest, outdated: compareVersions(latest, version) > 0, desktop, canUpdate };
}

/** 命令行版：在自己的仓库里 pull，依赖变了重新装；之后调用方重启 */
export async function updateStudio(dir, { registry } = {}) {
  await ensureRepo(dir);
  const before = await git(dir, ['rev-parse', 'HEAD']);
  try { await git(dir, ['pull', '--ff-only'], { timeout: 120_000 }); } catch (e) { throw new Error(`拉取失败：${e.message}`); }
  const changed = (await git(dir, ['diff', '--name-only', before, 'HEAD'])).split('\n').filter(Boolean);
  const reinstall = changed.some((f) => f === 'package.json' || /(^|\/)(pnpm-lock\.yaml|package-lock\.json)$/.test(f));
  if (reinstall) await installDeps(dir, { registry });
  return { changed: changed.length, installed: reinstall };
}
