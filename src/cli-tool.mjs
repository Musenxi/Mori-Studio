/**
 * `mori-studio tool`：在命令行里调用 MCP 那套工具（同一份实现，见 mcp.mjs，进程内用内存通道连上），
 * 给 Claude Code 这类能跑命令的客户端、脚本用。
 *   mori-studio tool                        列出工具
 *   mori-studio tool <名字> --help           参数
 *   mori-studio tool <名字> [--参数 值 …]    调用。不是字符串的参数（数字、数组、对象）按 JSON 写；值写 - 从标准输入读，@路径 读文件
 *   --json '{…}'                            参数整个用一个 JSON 给
 *   --yes                                   标了破坏性的工具（删除、撤回、发布到线上）要加它才执行
 * 返回：结果打到标准输出；出错打到标准错误，退出码 1；参数不对 2；破坏性工具没加 --yes 3
 */
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from './mcp.mjs';

const typeOf = (p) => p.type ?? (p.anyOf ?? []).map((x) => x.type).find((t) => t && t !== 'null') ?? 'any';
const label = (p) => (p.enum ? p.enum.join(' | ') : typeOf(p));

/** 值的来源：- 是标准输入，@路径 是文件，其余原样 */
const source = (v) => (v === '-' ? readFileSync(0, 'utf8') : v.startsWith('@') ? readFileSync(v.slice(1), 'utf8') : v);

/**
 * @param {string | (() => Promise<string>)} base Studio 的地址（同 createMcpServer）
 * @param {string[]} argv tool 后面的参数（已去掉 --root）
 * @returns {Promise<number>} 退出码
 */
export async function runTool(base, argv) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(base).connect(a);
  const client = new Client({ name: 'mori-studio-cli', version: '0' });
  await client.connect(b);
  const { tools } = await client.listTools();
  const out = (s) => process.stdout.write(s.endsWith('\n') ? s : `${s}\n`);
  const err = (s) => process.stderr.write(s.endsWith('\n') ? s : `${s}\n`);

  const [name, ...rest] = argv;
  if (!name || name === '--help' || name === 'list') {
    const w = Math.max(...tools.map((t) => t.name.length));
    out(tools.map((t) => `${t.name.padEnd(w)}  ${t.title ?? ''}${t.annotations?.destructiveHint ? '（破坏性，要加 --yes）' : ''}`).join('\n'));
    out('\nmori-studio tool <名字> --help 看参数');
    return 0;
  }
  const tool = tools.find((t) => t.name === name);
  if (!tool) { err(`没有这个工具：${name}。mori-studio tool 列出全部`); return 2; }
  const props = tool.inputSchema?.properties ?? {}, required = new Set(tool.inputSchema?.required ?? []);

  if (rest.includes('--help')) {
    out(`${tool.name}  ${tool.title ?? ''}\n${tool.description ?? ''}`);
    const keys = Object.keys(props);
    if (keys.length) {
      const w = Math.max(...keys.map((k) => k.length)) + 2;
      out('\n' + keys.map((k) => `  --${k.padEnd(w)}${label(props[k])}${required.has(k) ? '' : '（可选）'}${props[k].description ? `  ${props[k].description}` : ''}`).join('\n'));
    }
    return 0;
  }

  const input = {};
  let yes = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--yes') { yes = true; continue; }
    if (!a.startsWith('--')) { err(`多出来的参数：${a}`); return 2; }
    const key = a.slice(2), raw = rest[i + 1];
    if (raw === undefined) { err(`--${key} 后面要有值`); return 2; }
    i++;
    if (key === 'json') { Object.assign(input, JSON.parse(source(raw))); continue; }
    const p = props[key];
    if (!p) { err(`${name} 没有 --${key} 这个参数。mori-studio tool ${name} --help 看参数`); return 2; }
    const v = source(raw);
    if (typeOf(p) === 'string') input[key] = v;
    else { try { input[key] = JSON.parse(v); } catch { err(`--${key} 要是 ${label(p)}（按 JSON 写）`); return 2; } }
  }
  if (tool.annotations?.destructiveHint && !yes) { err(`${name} 会${tool.title ?? '改动内容'}，确认要做就加 --yes`); return 3; }

  const r = await client.callTool({ name, arguments: input });
  const text = (r.content ?? []).map((c) => c.text ?? '').join('\n');
  if (r.isError) { err(text); return 1; }
  out(text);
  return 0;
}
