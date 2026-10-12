/**
 * 预览：用项目自己的 Astro 渲染页面（和线上一样）。
 * 项目已经有命令行的 astro dev 在跑（.astro/dev.json 里的进程还活着）就用它，免得两个渲染器同时写 .astro/；
 * 没有就在 Studio 进程里起一个（astro 的 dev() 接口，随机端口，不开工具栏）：要用时才起，请求哪页渲染哪页，
 * 十分钟没人用（界面开着预览时会定期 ensure）就停掉，Studio 退出时一起结束。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const IDLE = 10 * 60_000;

const freePort = () => new Promise((ok, fail) => {
  const s = createServer();
  s.once('error', fail);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
});

/**
 * 这个端口上的地址（连不上是 null）。命令行的 astro dev 默认绑 localhost，有的机器上只监听 IPv6（[::1]），三种写法都试
 */
export async function reach(port) {
  for (const host of ['127.0.0.1', '[::1]', 'localhost']) {
    try { if ((await fetch(`http://${host}:${port}/`, { signal: AbortSignal.timeout(1500) })).ok) return `http://${host}:${port}`; } catch { /* 换下一个 */ }
  }
  return null;
}

export function previewer(root) {
  let own = null; // 自己起的：astro 的 DevServer
  let starting = null;
  let lastUsed = 0;

  /** 命令行开着的 astro dev */
  async function external() {
    try {
      const d = JSON.parse(readFileSync(join(root, '.astro/dev.json'), 'utf8'));
      if (d.pid === process.pid) return null;
      process.kill(d.pid, 0); // 进程还在
      return await reach(d.port);
    } catch { return null; }
  }

  async function start() {
    const astro = createRequire(join(root, 'package.json')).resolve('astro');
    const { dev } = await import(pathToFileURL(astro).href);
    process.env.NODE_ENV = 'development'; // 不然 Astro 不当自己在开发模式（图片接口会拒绝）；子进程的环境里会去掉它，见 server.mjs 的 childEnv
    own = await dev({ root, server: { host: '127.0.0.1', port: await freePort() }, devToolbar: { enabled: false }, logLevel: 'error' });
  }

  const idle = setInterval(() => {
    if (own && Date.now() - lastUsed > IDLE) void stop();
  }, 60_000);
  idle.unref();

  async function stop() {
    const s = own;
    own = null;
    await s?.stop();
  }

  return {
    /** 现在能用的地址；没有渲染器是 null（不会去启动） */
    async url() {
      return own ? reach(own.address.port) : external();
    },
    /** 要用了：没有就起一个，返回地址 */
    async ensure() {
      lastUsed = Date.now();
      if (!own) {
        const ext = await external();
        if (ext) return ext;
        starting ??= start().finally(() => { starting = null; });
        await starting;
      }
      return `http://127.0.0.1:${own.address.port}`;
    },
    /** 只停自己起的；命令行开的不动 */
    stop,
  };
}
