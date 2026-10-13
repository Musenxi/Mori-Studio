/**
 * 评论服务的管理客户端（接口见 Mori-Comment 的 README“管理接口”）。
 * 界面路由和以后的 MCP 工具都走这里，管理令牌只在这一处用，不交给界面。
 * endpoint、token 是函数：设定改了、令牌换了，下一次调用就用新的。
 */

/** 能对接的管理接口版本（/admin/info 的 api） */
export const API_VERSION = 1;

export function commentsClient({ endpoint, token }) {
  async function call(method, path, body) {
    const ep = endpoint(), tk = token();
    if (!ep) throw Object.assign(new Error('mori.config.ts 里没有启用自建评论（comments.provider = mori）'), { code: 400 });
    if (!tk) throw Object.assign(new Error('还没有管理令牌'), { code: 401 });
    let r;
    try {
      r = await fetch(`${ep}/admin${path}`, { method, headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    } catch (e) {
      throw Object.assign(new Error(e.name === 'TimeoutError' ? '评论服务没有响应' : `连不上评论服务（${e.cause?.code ?? e.message}）`), { code: 502 });
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error ?? `评论服务返回 ${r.status}`), { code: r.status === 401 ? 401 : r.status === 404 ? 404 : 502 });
    return j;
  }
  const query = (o) => {
    const q = new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)]));
    return q.size ? `?${q}` : '';
  };

  // /admin/info 按“地址 + 令牌”缓存；旧版服务没有这个接口（404），当作 api 0
  let infoCache = { key: '', info: null };
  async function info({ fresh = false } = {}) {
    const key = `${endpoint()}\n${token()}`;
    if (!fresh && infoCache.key === key && infoCache.info) return infoCache.info;
    let i;
    try { i = await call('GET', '/info'); } catch (e) {
      if (e.code !== 404) throw e;
      i = { service: 'mori-comments', version: null, api: 0, runtime: null, features: {} };
    }
    infoCache = { key, info: i };
    return i;
  }
  /** 连得上、令牌对，并且接口版本对得上；不行就抛出原因 */
  async function check() {
    const i = await info();
    if (i.api > API_VERSION) throw Object.assign(new Error(`评论服务的接口（${i.api}）比 Studio 新，请更新 Studio`), { code: 409 });
    return i;
  }
  /** 接入前的检查：比 check 多确认这个地址上真有评论服务（旧版服务没有 /info，任何 404 的网站也会被当成旧版） */
  async function verify() {
    try {
      const i = await check();
      if (!i.api) await call('GET', '/stats');
      return i;
    } catch (e) {
      if (e.code === 401) throw Object.assign(new Error('管理令牌不对'), { code: 400 });
      if (e.code === 404) throw Object.assign(new Error('这个地址上没有评论服务'), { code: 400 });
      throw e;
    }
  }

  /** 一页：{ comments, next }；旧版服务没有 next */
  const list = ({ status, entry, since, before, limit = 100 } = {}) =>
    call('GET', `/comments${query({ status, entry, since, before, limit })}`).then((j) => ({ comments: j.comments, next: j.next ?? null }));
  /** 翻完所有页（max 条封顶） */
  async function listAll(filter = {}, max = 5000) {
    const out = [];
    let before;
    do {
      const page = await list({ ...filter, before, limit: 500 });
      out.push(...page.comments);
      before = page.next;
    } while (before && out.length < max);
    return out;
  }
  /** 总数、待审、since 之后的新评论数 */
  async function numbers(since) {
    const st = await call('GET', `/stats${query({ since })}`);
    // 旧版服务不认 ?since=，退回到拉列表自己数
    const unread = st.since ?? (await list({ limit: 500 })).comments.filter((c) => c.createdAt > since && !c.author).length;
    return { total: (st.pending ?? 0) + (st.approved ?? 0) + (st.hidden ?? 0), pending: st.pending ?? 0, unread };
  }

  return {
    call, info, check, verify, list, listAll, numbers,
    stats: () => call('GET', '/stats'),
    traffic: () => call('GET', '/traffic'),
    reply: (c) => call('POST', '/comments', c),
    setStatus: (id, status) => call('PATCH', `/comments/${id}`, { status }),
    remove: (id) => call('DELETE', `/comments/${id}`),
    clearSpam: () => call('DELETE', '/spam'),
    settings: () => call('GET', '/settings'),
    saveSettings: (b) => call('PUT', '/settings', b),
    mail: () => call('GET', '/mail'),
    saveMail: (b) => call('PUT', '/mail', b),
    testMail: () => call('POST', '/mail/test'),
  };
}
