/**
 * MCP：让 AI 客户端（Claude 桌面版、Claude Code……）读写博客、管评论。
 * 工具都走 Studio 自己的 /api（和界面做的事一样，令牌、钥匙串都留在 Studio 里）；正文用 Markdown 读写，
 * 转换用编辑器同一套（app/src/lib/mdsync.js）：没改的块原样保留，块 id 尽量沿用，引用评论不会失效。
 * 两种接法：Studio 服务上的 /mcp（HTTP），或者 `mori-studio mcp --root 项目`（stdio，见 bin）。
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { toMarkdown, fromMarkdown, mdImagePath } from '../app/src/lib/mdsync.js';

const KIND = z.enum(['post', 'page']).describe('post 文章（游记也是文章），page 独立页面');
const ID = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/).describe('文件名（网址里的那一段），字母、数字、下划线、连字符');
const folderOf = (kind, id) => (kind === 'page' ? `pages/${id}` : `posts/${id}`);
const entryOf = folderOf; // 评论里的 entry 也是 posts/xxx、pages/xxx
/** 能用 update_entry 改的元信息 */
const META = { post: ['title', 'subtitle', 'date', 'category', 'tags', 'excerpt', 'cover'], page: ['title', 'excerpt'] };

const text = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
const fail = (e) => ({ content: [{ type: 'text', text: e?.message ?? String(e) }], isError: true });
/** 包一层：出错时把原因交给客户端，不抛 */
const tool = (fn) => async (args) => { try { return await fn(args ?? {}); } catch (e) { return fail(e); } };

/**
 * @param {string | (() => Promise<string>)} base Studio 服务的地址（如 http://127.0.0.1:4400），或者每次调用前去找地址的函数
 */
export function createMcpServer(base) {
  const baseOf = typeof base === 'function' ? base : async () => base;
  async function api(method, path, body, raw) {
    const r = await fetch((await baseOf()) + path, {
      method,
      headers: raw ? undefined : { 'Content-Type': 'application/json' },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const type = r.headers.get('content-type') ?? '';
    const data = type.includes('json') ? await r.json() : await r.text();
    if (!r.ok) throw new Error(typeof data === 'object' ? data.error ?? `Studio 返回 ${r.status}` : data);
    return data;
  }
  /** 构建、部署这类一路输出文字的接口：读完，看最后的 [exit N] */
  async function stream(path) {
    const out = await api('POST', path, {});
    const code = Number(/\[exit (\d+)\]\s*$/.exec(out)?.[1] ?? 1);
    return { ok: code === 0, log: out.replace(/\n?\[exit \d+\]\s*$/, '').slice(-6000) };
  }
  const project = () => api('GET', '/api/project');

  const server = new McpServer({ name: 'mori-studio', version: '0.0.1' });
  const read = { readOnlyHint: true, openWorldHint: false };

  /* ── 站点 ── */
  server.registerTool('site_info', {
    title: '站点信息',
    description: '刊名、简介、语言、分类、作者、评论服务、预览地址，以及文章、页面的数量。先调它了解这个博客。',
    annotations: read,
  }, tool(async () => {
    const p = await project();
    const c = p.config;
    return text({
      root: p.root, title: c.title, description: c.description, lang: c.lang, site: c.site || null, author: c.author,
      categories: c.categories, comments: p.comments.provider ? { provider: p.comments.provider, endpoint: p.comments.endpoint, connected: p.comments.hasToken } : null,
      publish: p.publish ? p.publish.target : null, preview: p.preview.url,
      counts: { posts: p.entries.length, drafts: p.entries.filter((e) => e.draft).length, pages: p.pages.length, assets: p.assets.length },
    });
  }));

  server.registerTool('preview_url', {
    title: '预览地址',
    description: '用项目自己的主题渲染某一篇，返回在浏览器里打开的地址（本机）。第一次要几秒。',
    inputSchema: { kind: KIND, id: ID },
    annotations: read,
  }, tool(async ({ kind, id }) => {
    const { url } = await api('POST', '/api/preview/start', {});
    return text(`${url}${kind === 'page' ? `/${id}/` : `/posts/${id}/`}`);
  }));

  server.registerTool('build_site', {
    title: '构建站点',
    description: '构建整个站点（astro build），检查内容有没有错。不发布。',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, tool(async () => text(await stream('/api/build'))));

  server.registerTool('deploy_site', {
    title: '构建并发布',
    description: '构建后按 mori.config.ts 的 publish 发布到线上。会改动公开的网站，调用前要得到用户明确同意。',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  }, tool(async () => text(await stream('/api/publish'))));

  /* ── 文章与页面 ── */
  server.registerTool('list_entries', {
    title: '列出文章和页面',
    description: '文章（新的在前）和页面的列表：id、标题、日期、分类、标签、字数、状态（draft 没发布过；changed 发布后又改过）。',
    inputSchema: { kind: KIND.optional(), status: z.enum(['draft', 'changed', 'published']).optional().describe('只要某种状态的') },
    annotations: read,
  }, tool(async ({ kind, status }) => {
    const p = await project();
    const all = [
      ...p.entries.map((e) => ({ kind: 'post', id: e.id, title: e.title, date: e.date, category: e.category, tags: e.tags, words: e.words, draft: !!e.draft, changed: !!e.changed })),
      ...p.pages.map((e) => ({ kind: 'page', id: e.id, title: e.title, words: e.words, draft: !!e.draft, changed: !!e.changed })),
    ];
    const st = (e) => (e.draft ? 'draft' : e.changed ? 'changed' : 'published');
    return text(all.filter((e) => (!kind || e.kind === kind) && (!status || st(e) === status)));
  }));

  server.registerTool('read_entry', {
    title: '读一篇',
    description: '读一篇文章或页面：元信息（JSON）+ 正文 Markdown（第一行是 # 标题）。图片只写文件名的是这篇自己文件夹里的。format 选 json 拿原始存储格式。',
    inputSchema: { kind: KIND, id: ID, format: z.enum(['markdown', 'json']).optional() },
    annotations: read,
  }, tool(async ({ kind, id, format = 'markdown' }) => {
    const doc = await api('GET', `/api/entry/${kind}/${id}`);
    if (format === 'json') return text(doc);
    const { blocks: _b, notes: _n, ...meta } = doc;
    return text(`${JSON.stringify(meta, null, 2)}\n\n---\n\n${toMarkdown(doc, folderOf(kind, id))}`);
  }));

  async function save(kind, id, doc) {
    const r = await api('PUT', `/api/entry/${kind}/${id}`, doc);
    return { saved: true, issues: r.errors ?? [], annotationWarnings: r.annotationWarnings ?? [] };
  }

  server.registerTool('create_entry', {
    title: '新建',
    description: '新建一篇文章或页面（草稿）。可以直接给正文 Markdown（第一行 # 标题）。建好后要 publish_entry 才会出现在站点上。',
    inputSchema: {
      kind: KIND, id: ID, title: z.string().min(1),
      category: z.string().optional().describe('分类 id（site_info 里有），只对文章有用；不给用第一个分类'),
      markdown: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, tool(async ({ kind, id, title, category, markdown }) => {
    await api('POST', `/api/entry/${kind}`, { id, title, category });
    if (!markdown) return text({ created: `${kind}/${id}` });
    const doc = await api('GET', `/api/entry/${kind}/${id}`);
    return text({ created: `${kind}/${id}`, ...(await save(kind, id, fromMarkdown(markdown, doc, folderOf(kind, id)))) });
  }));

  server.registerTool('update_entry', {
    title: '修改',
    description: '改一篇：markdown 给整篇正文（先 read_entry 拿到现在的再改，没改的段落原样保留）；meta 改元信息。改的是工作稿，已发布的要再 publish_entry 才更新到站点。annotationWarnings 非空表示有引用评论对不上原文了，要告诉用户。',
    inputSchema: {
      kind: KIND, id: ID,
      markdown: z.string().optional(),
      meta: z.object({
        title: z.string().optional(), subtitle: z.string().optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        category: z.string().optional(), tags: z.array(z.string()).optional(), excerpt: z.string().optional(), cover: z.string().optional(),
      }).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, tool(async ({ kind, id, markdown, meta }) => {
    let doc = await api('GET', `/api/entry/${kind}/${id}`);
    if (markdown) doc = fromMarkdown(markdown, doc, folderOf(kind, id));
    for (const [k, v] of Object.entries(meta ?? {})) {
      if (!META[kind].includes(k)) throw new Error(`${kind === 'page' ? '页面' : '文章'}不能改 ${k}`);
      doc[k] = v;
    }
    return text(await save(kind, id, doc));
  }));

  server.registerTool('publish_entry', {
    title: '发布到站点内容',
    description: '把工作稿定为发布版本（草稿变成正式的，或把修改更新上去）。线上网站要 deploy_site 之后才变。',
    inputSchema: { kind: KIND, id: ID },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, tool(async ({ kind, id }) => { await api('POST', `/api/entry/${kind}/${id}/publish`, {}); return text({ published: `${kind}/${id}` }); }));

  server.registerTool('unpublish_entry', {
    title: '撤回为草稿',
    description: '把已发布的一篇改回草稿（下次 deploy_site 后从网站上消失）。',
    inputSchema: { kind: KIND, id: ID },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, tool(async ({ kind, id }) => { await api('POST', `/api/entry/${kind}/${id}/unpublish`, {}); return text({ unpublished: `${kind}/${id}` }); }));

  server.registerTool('delete_entry', {
    title: '删除',
    description: '删除一篇（移进项目的 .mori-trash/，可以手动找回）。调用前要得到用户明确同意。',
    inputSchema: { kind: KIND, id: ID },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, tool(async ({ kind, id }) => { await api('DELETE', `/api/entry/${kind}/${id}`); return text({ deleted: `${kind}/${id}` }); }));

  /* ── 图片 ── */
  server.registerTool('list_assets', {
    title: '列出图片',
    description: '项目里图片的路径（posts/xxx/a.jpg 这样，按文章分文件夹；shared/ 是公用的）。',
    inputSchema: { folder: z.string().optional().describe('只看这个文件夹，如 posts/hello') },
    annotations: read,
  }, tool(async ({ folder }) => {
    const p = await project();
    return text(p.assets.filter((a) => !folder || a.startsWith(`${folder}/`)));
  }));

  server.registerTool('add_image', {
    title: '加一张图',
    description: '把本机的一张图片放进某篇的文件夹（自动转正方向、查重），返回正文里引用它的 Markdown，再用 update_entry 写进正文。',
    inputSchema: { kind: KIND, id: ID, path: z.string().describe('本机图片的绝对路径'), alt: z.string().optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, tool(async ({ kind, id, path, alt = '' }) => {
    const folder = folderOf(kind, id);
    const r = await api('PUT', `/api/assets/upload?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(basename(path))}`, undefined, readFileSync(path));
    return text({ path: r.path, alreadyThere: !!r.dup, markdown: `![${alt}](${mdImagePath(r.path, folder)})` });
  }));

  /* ── 评论 ── */
  server.registerTool('list_comments', {
    title: '评论列表',
    description: '评论（新的在前）：status 不给是垃圾箱以外的全部；entry 只看某一篇（posts/xxx、pages/xxx）；since 只要这个时间（毫秒）之后的；返回 next 不为空时把它当 before 取下一页。',
    inputSchema: {
      status: z.enum(['pending', 'approved', 'hidden', 'spam']).optional(),
      entry: z.string().optional(), since: z.number().int().optional(), before: z.string().optional(),
      limit: z.number().int().min(1).max(300).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, tool(async (q) => {
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
    return text(await api('GET', `/api/comments?${qs}`));
  }));

  server.registerTool('reply_comment', {
    title: '以博主身份评论',
    description: '以博主身份在某篇下发评论，或回复一条（parentId）。直接公开显示；回复待审的评论时那条一起通过。调用前要让用户确认内容。',
    inputSchema: { kind: KIND, id: ID, body: z.string().min(1).describe('评论内容，支持 Markdown'), parentId: z.number().int().optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, tool(async ({ kind, id, body, parentId }) => {
    const doc = await api('GET', `/api/entry/${kind}/${id}`).catch(() => null);
    return text(await api('POST', '/api/comments', { entry: entryOf(kind, id), body, parentId, title: doc?.title }));
  }));

  server.registerTool('set_comment_status', {
    title: '审核评论',
    description: '改一条评论的状态：approved 通过，hidden 隐藏，spam 进垃圾箱，pending 退回待审。',
    inputSchema: { id: z.number().int(), status: z.enum(['pending', 'approved', 'hidden', 'spam']) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, tool(async ({ id, status }) => text(await api('PATCH', `/api/comments/${id}`, { status }))));

  server.registerTool('delete_comment', {
    title: '删除评论',
    description: '永久删除一条评论（它的回复一起删），不能恢复。调用前要得到用户明确同意。',
    inputSchema: { id: z.number().int() },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  }, tool(async ({ id }) => text(await api('DELETE', `/api/comments/${id}`))));

  server.registerTool('site_stats', {
    title: '数字',
    description: '评论总数和未读数、各状态的评论数、全站阅读量、在线人数、总字数。',
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, tool(async () => {
    const [s, c] = await Promise.all([api('GET', '/api/stats'), api('GET', '/api/comments/stats').catch(() => null)]);
    return text({ ...s, commentsByStatus: c });
  }));

  return server;
}
