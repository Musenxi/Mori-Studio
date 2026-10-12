/**
 * 哪个项目有 Studio 在跑：启动后在 ~/.mori-studio/run/ 记一笔（端口、进程），退出时删掉。
 * 不用系统临时目录：MCP 客户端启动我们时只给很少几个环境变量（没有 TMPDIR），两边算出来的临时目录会不一样。
 * `mori-studio mcp` 先找它：有就连过去，没有才自己起一个，免得同一个项目开两个 Studio。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const DIR = join(homedir(), '.mori-studio', 'run');
const fileOf = (root) => join(DIR, `${createHash('sha1').update(resolve(root)).digest('hex').slice(0, 16)}.json`);

export function markRunning(root, port) {
  const f = fileOf(root);
  mkdirSync(DIR, { recursive: true });
  writeFileSync(f, JSON.stringify({ root: resolve(root), port, pid: process.pid }), { mode: 0o600 });
  const clean = () => {
    try { if (JSON.parse(readFileSync(f, 'utf8')).pid === process.pid) rmSync(f); } catch { /* 已经没了 */ }
  };
  process.on('exit', clean);
  // Ctrl+C、kill 默认不触发 exit 事件（有的库还会自己重发信号结束进程），所以收到时先清掉再退出
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { clean(); process.exit(0); });
}

/** 这个项目正在跑的 Studio 的地址；没有是 null */
export async function findRunning(root) {
  try {
    const { port, pid } = JSON.parse(readFileSync(fileOf(root), 'utf8'));
    process.kill(pid, 0);
    const url = `http://127.0.0.1:${port}`;
    const r = await fetch(`${url}/api/ping`, { signal: AbortSignal.timeout(3000) });
    return r.ok && resolve((await r.json()).root) === resolve(root) ? url : null;
  } catch { return null; }
}
