/**
 * 打包前把 Studio 放进 src-tauri/studio/，tauri.conf.json 的 resources 再把它打进应用（Contents/Resources/studio）。
 * 代码（bin、src、app）+ 运行依赖：平铺的 node_modules（不用符号链接），sharp 的原生模块按当前机器的架构装。
 * 界面不在这里构建：打开项目时按项目构建（项目里的主题模块要打包进去），所以 vite 和插件也是运行依赖。
 */
import { cpSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const out = fileURLToPath(new URL('../src-tauri/studio/', import.meta.url));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(out + '.gitkeep', ''); // 开发时编译也要求这个目录存在
for (const f of ['bin', 'src', 'app', 'package.json', 'pnpm-lock.yaml', 'LICENSE']) cpSync(repo + f, out + f, { recursive: true });
// Windows 上 pnpm 是 pnpm.cmd，要经过 shell 才能找到
execFileSync('pnpm', ['install', '--prod', '--frozen-lockfile', '--config.node-linker=hoisted'], { cwd: out, stdio: 'inherit', shell: process.platform === 'win32' });
console.log(`Studio 已放进 ${out}`);
