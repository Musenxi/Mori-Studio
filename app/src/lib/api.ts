import type { Doc, Friend, Kind, NavItem, Project, PublishConfig, Stats, Traffic, Action } from './types';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  // 保存文章时校验不过也是 200；其余非 2xx 都当错误
  if (!r.ok && !(j && j.errors)) throw new ApiError(j?.error ?? `请求失败（${r.status}）`, r.status);
  return j as T;
}

export interface SaveResult {
  ok: boolean;
  saved?: boolean;
  errors: Array<{ path: string; message: string }>;
  annotationWarnings?: Array<{ id: number; block: string; quote?: string }>;
}
/** 图床（S3 兼容对象存储）设置；密钥读回来是空的，hasSecret 表示填过，保存时留空表示不改 */
export interface ImageHost { provider: string; endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; prefix: string; publicBase: string; pathStyle: boolean; hasSecret?: boolean }
/** 图片：path 是它在 src/assets 下的相对路径（posts/hello/IMG.jpg），folder 是所在文件夹（'' 是未归类） */
export interface AssetInfo { path: string; folder: string; name: string; size: number; mtime: number; live?: boolean; /** 设了图床时：已经传上去了 */ remote?: boolean; width?: number; height?: number; usedBy: Array<{ kind: 'post' | 'page' | 'friends'; id: string; title: string }> }
/** 回收站里的一项：files 是 [回收站里的路径, 原路径]，都相对项目根目录 */
export interface TrashItem { key: string; kind: 'post' | 'page' | 'asset' | 'emoji'; label: string; deletedAt: number; size: number; files: Array<[string, string]> }
export interface GitInfo { isRepo: boolean; top?: string; nested?: boolean; branch?: string; remotes?: Array<{ name: string; url: string }>; changed?: number; last?: string }
/** 防垃圾规则（存在评论服务里）：屏蔽词、IP 段、网址、昵称 */
/** 邮件提醒（存在评论服务里）。密码、Key 读回来是空的，has* 表示填过；保存时留空表示不改 */
export interface MailSettings {
  provider: 'off' | 'smtp' | 'resend' | 'cloudflare';
  fromName: string; fromEmail: string; to: string; site: string; accent: string;
  notifyAuthor: boolean; notifyReply: boolean;
  smtp: { host: string; port: number; user: string; pass: string; hasPass?: boolean };
  resend: { apiKey: string; hasKey?: boolean };
  cloudflare: { accountId: string; apiToken: string; hasToken?: boolean };
}

/** 表情包管理用：含空的包；file 是本地图（能改名、删除），url 是 pack.json 里登记的链接 */
export interface ManagedPack { id: string; title: string; items: Array<{ name: string; key: string; file?: string; url?: string; size?: number }> }
export interface EmojiPack { id: string; title: string; items: Array<{ name: string; key: string; url: string }> }

export interface SpamRules { words: string[]; ips: string[]; urls: string[]; names: string[] }

/** 评论服务的 /admin/info */
export interface UpdateCheck {
  studio: { version: string; latest: string; outdated: boolean; desktop: boolean; canUpdate: boolean } | { error: string } | null;
  theme: { version: string; latest: string; outdated: boolean; commits: Array<{ hash: string; subject: string }> } | { error: string } | null;
  comments: { version: string | null; latest: string | null; runtime: string | null; outdated: boolean; error?: string } | null;
}
export interface CommentsInfo { service: string; version: string | null; api: number; runtime: string | null; features: { turnstile?: boolean; mail?: string[]; online?: boolean } }

export interface CommentRow { id: number; entry: string; name: string; avatar?: string | null; url?: string | null; email?: string | null; ip?: string | null; author?: boolean; body: string; createdAt: number; status: 'pending' | 'approved' | 'hidden' | 'spam'; block?: string | null; quote?: string | null; parentId?: number | null }

/** 长任务（构建 / 发布）：输出一路推给 onChunk，结束时返回退出码 */
async function stream(url: string, onChunk: (all: string) => void): Promise<number> {
  const res = await fetch(url, { method: 'POST' });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let all = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    all += dec.decode(value);
    onChunk(all);
  }
  return +(all.match(/\[exit (\d+)\]/)?.[1] ?? 1);
}

export const api = {
  project: () => req<Project>('GET', '/api/project'),
  stats: () => req<Stats>('GET', '/api/stats'),
  traffic: () => req<Traffic>('GET', '/api/traffic'),
  emoji: () => req<{ packs: EmojiPack[] }>('GET', '/api/emoji'),
  emojiPacks: () => req<{ packs: ManagedPack[] }>('GET', '/api/emoji/packs'),
  createEmojiPack: (id: string) => req<{ ok: true; id: string }>('POST', '/api/emoji/packs', { id }),
  uploadEmoji: async (pack: string, file: File) => {
    const r = await fetch(`/api/emoji/upload?pack=${encodeURIComponent(pack)}&name=${encodeURIComponent(file.name)}`, { method: 'PUT', body: file });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(j.error ?? '上传失败', r.status);
    return j as { ok: true; name: string };
  },
  /** 不带 name 是给包改名 */
  renameEmoji: (pack: string, name: string | undefined, to: string) => req<{ ok: true; name: string }>('POST', '/api/emoji/rename', { pack, name, to }),
  removeEmoji: (pack: string, name?: string) => req<{ ok: true }>('DELETE', `/api/emoji?pack=${encodeURIComponent(pack)}${name === undefined ? '' : `&name=${encodeURIComponent(name)}`}`),

  entry: (kind: Kind, id: string) => req<Doc>('GET', `/api/entry/${kind}/${id}`),
  saveEntry: (kind: Kind, id: string, doc: Doc) => req<SaveResult>('PUT', `/api/entry/${kind}/${id}`, doc),
  createEntry: (kind: Kind, body: { id: string; title: string; category?: string }) => req<{ ok: true; id: string }>('POST', `/api/entry/${kind}`, body),
  publishEntry: (kind: Kind, id: string) => req<{ ok: true }>('POST', `/api/entry/${kind}/${id}/publish`),
  unpublishEntry: (kind: Kind, id: string) => req<{ ok: true }>('POST', `/api/entry/${kind}/${id}/unpublish`),
  discardDraft: (kind: Kind, id: string) => req<{ ok: true; removed: boolean }>('POST', `/api/entry/${kind}/${id}/discard`),
  removeEntry: (kind: Kind, id: string) => req<{ ok: true }>('DELETE', `/api/entry/${kind}/${id}`),
  trash: () => req<{ items: TrashItem[] }>('GET', '/api/trash'),
  restoreTrash: (key: string) => req<{ ok: true; item: TrashItem }>('POST', '/api/trash/restore', { key }),
  purgeTrash: (key: string) => req<{ ok: true }>('DELETE', `/api/trash?key=${encodeURIComponent(key)}`),
  emptyTrash: () => req<{ ok: true }>('DELETE', '/api/trash'),

  setConfig: (key: string, value: string | null) => req('PUT', '/api/config', { key, value }),
  uploadSiteIcon: async (file: File) => {
    const r = await fetch(`/api/site-icon?name=${encodeURIComponent(file.name)}`, { method: 'PUT', body: file });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `上传失败（${r.status}）`);
    return j as { icon: string };
  },
  setCategories: (categories: unknown[], renames: Record<string, string>) => req<{ ok: true; moved: number }>('PUT', '/api/categories', { categories, renames }),
  renameTag: (from: string, to: string | null) => req<{ ok: true; changed: number }>('POST', '/api/tags/rename', { from, to }),
  setNav: (body: { nav?: NavItem[] | null; actions?: Action[] | null }) => req<{ ok: true }>('PUT', '/api/nav', body),

  friends: () => req<{ friends: Friend[]; text: string; lost: string }>('GET', '/api/friends'),
  saveFriends: (text: string, lost: string) => req<{ ok: true; friends: Friend[]; text: string; lost: string }>('PUT', '/api/friends', { text, lost }),

  /** 上传一张图到某个文件夹；内容完全相同的图已经有了，就返回原来那张（dup） */
  upload: async (file: File, folder: string, stripLocation = false) => {
    const r = await fetch(`/api/assets/upload?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(file.name)}${stripLocation ? '&strip=1' : ''}`, { method: 'PUT', body: file });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(j.error ?? '上传失败', r.status);
    return j as { ok: true; path: string; dup: boolean };
  },
  /** 上传一段视频（正文里的视频块）到某个文件夹：服务端转成网页用的 mp4、取一帧当封面。返回视频和封面的路径 */
  uploadVideo: async (file: File, folder: string) => {
    const r = await fetch(`/api/assets/video?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(file.name)}`, { method: 'PUT', body: file });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(j.error ?? '上传失败', r.status);
    return j as { ok: true; path: string; poster?: string };
  },
  /** 上传一批文件：图片（HEIC 在服务端转成 JPEG）；和图片同名的 .mov / .mp4 是实况照片的视频，跟着那张图片传。stripLocation：存之前清掉 GPS。返回存下（或认出已有）的图片路径 */
  uploadImages: async (files: File[], folder: string, stripLocation = false) => {
    const videos = new Map(files.filter(isVideoFile).map((f) => [stemOf(f.name), f]));
    const paths: string[] = [];
    let dups = 0;
    for (const f of files.filter(isImageFile)) {
      const { path, dup } = await api.upload(f, folder, stripLocation);
      paths.push(path);
      if (dup) dups++;
      const video = videos.get(stemOf(f.name));
      if (!video) continue;
      const r = await fetch(`/api/assets/live?path=${encodeURIComponent(path)}`, { method: 'PUT', body: video });
      if (!r.ok) throw new ApiError((await r.json().catch(() => ({}))).error ?? '上传失败', r.status);
    }
    return { paths, dups };
  },

  importGpx: async (file: File) => {
    const r = await fetch('/api/gpx', { method: 'POST', body: file });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(j.error ?? '读取 GPX 失败', r.status);
    return j as { track: Array<[number, number]>; points: number; simplified: number };
  },
  geocode: (q: string) => req<{ lnglat: [number, number]; name: string }>('GET', `/api/geocode?q=${encodeURIComponent(q)}`),
  exif: () => req<{ photos: number; withGps: number; stops: Array<{ lnglat: [number, number]; date?: string; count: number }> }>('GET', '/api/exif'),

  assets: () => req<{ assets: AssetInfo[]; similar: string[][]; host: { pending: number } | null }>('GET', '/api/assets'),
  imageHost: () => req<{ host: Partial<ImageHost> | null; ready: boolean; pending: number }>('GET', '/api/image-host'),
  saveImageHost: (host: ImageHost | null) => req<{ ok: true }>('PUT', '/api/image-host', host ?? { host: null }),
  testImageHost: (host?: ImageHost) => req<{ ok: true }>('POST', '/api/image-host/test', host),
  syncImageHost: (onChunk: (t: string) => void) => stream('/api/image-host/sync', onChunk),
  moveAssets: (paths: string[], folder: string) => req<{ ok: true; moved: Record<string, string> }>('POST', '/api/assets/move', { paths, folder }),
  mergeAssets: (keep: string, drops: string[]) => req<{ ok: true }>('POST', '/api/assets/merge', { keep, drops }),
  removeAsset: (path: string) => req<{ ok: true }>('DELETE', `/api/assets?path=${encodeURIComponent(path)}`),

  comments: (status?: string) => req<{ comments: CommentRow[] }>('GET', `/api/comments${status ? `?status=${status}` : ''}`),
  commentStats: () => req<{ pending: number; approved: number; hidden: number; spam: number }>('GET', '/api/comments/stats'),
  commentSettings: () => req<{ spam: SpamRules }>('GET', '/api/comments/settings'),
  setCommentSettings: (spam: SpamRules) => req<{ spam: SpamRules }>('PUT', '/api/comments/settings', { spam }),
  commentMail: () => req<{ mail: MailSettings }>('GET', '/api/comments/mail'),
  setCommentMail: (mail: MailSettings) => req<{ mail: MailSettings }>('PUT', '/api/comments/mail', { mail }),
  testCommentMail: () => req<{ ok: boolean }>('POST', '/api/comments/mail/test'),
  postComment: (entry: string, body: string, parentId?: number, title?: string) => req('POST', '/api/comments', { entry, body, parentId, title }),
  setCommentStatus: (id: number, status: string) => req('PATCH', `/api/comments/${id}`, { status }),
  editComment: (id: number, body: string) => req('PATCH', `/api/comments/${id}`, { body }),
  removeComment: (id: number) => req('DELETE', `/api/comments/${id}`),
  clearSpam: () => req<{ removed: number }>('DELETE', '/api/comments/spam'),
  setCommentToken: (token: string) => req('PUT', '/api/comments/token', { token }),
  connectComments: (endpoint: string, token: string) => req<{ ok: boolean; info: CommentsInfo }>('PUT', '/api/comments/connect', { endpoint, token }),
  connectThirdComments: (provider: string, fields: Record<string, string>) => req<{ ok: boolean }>('POST', '/api/comments/connect', { provider, fields }),
  projects: () => req<{ current: string; recent: Array<{ path: string; name: string }>; canSwitch: boolean }>('GET', '/api/projects'),
  switchProject: (root: string) => req<{ ok: boolean }>('POST', '/api/projects/switch', { root }),
  ping: () => req<{ root: string }>('GET', '/api/ping'),
  checkUpdates: () => req<UpdateCheck>('POST', '/api/updates/check'),
  updateStudio: () => req<{ ok: boolean; changed: number; installed: boolean; restart: boolean }>('POST', '/api/updates/studio'),
  updateTheme: () => req<{ ok: boolean; changed: number; installed: boolean; restart: boolean }>('POST', '/api/updates/theme'),
  commentsInfo: () => req<CommentsInfo>('GET', '/api/comments/info'),
  welcomeDone: () => req('POST', '/api/welcome/done'),
  markCommentsSeen: () => req('POST', '/api/comments/seen'),

  previewStart: () => req<{ url: string }>('POST', '/api/preview/start', {}),
  previewStop: () => req('POST', '/api/preview/stop', {}),

  git: () => req<GitInfo>('GET', '/api/git'),
  gitInit: (url: string, branch: string) => req<GitInfo>('POST', '/api/git/init', { url, branch }),
  setPublish: (publish: PublishConfig | null) => req<{ ok: true; publish: PublishConfig | null }>('PUT', '/api/publish-config', { publish }),
  build: (onChunk: (t: string) => void) => stream('/api/build', onChunk),
  publish: (onChunk: (t: string) => void, build = true) => stream(build ? '/api/publish' : '/api/publish?build=0', onChunk),
};

const extOf = (n: string) => n.slice(n.lastIndexOf('.')).toLowerCase();
const stemOf = (n: string) => n.slice(0, n.lastIndexOf('.')).toLowerCase();
export const isImageFile = (f: File) => f.type.startsWith('image/') || ['.heic', '.heif'].includes(extOf(f.name));
export const isVideoFile = (f: File) => ['.mov', '.mp4'].includes(extOf(f.name));
/** 插入视频时能选的文件 */
export const VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/x-m4v,video/webm,.mp4,.mov,.m4v,.webm';
/** 文件选择框接受的类型：图片、HEIC、实况照片的视频 */
export const IMAGE_ACCEPT = 'image/*,.heic,.heif,.mov,.mp4';
export const assetUrl = (path: string, w = 240) => `/asset/${path.split('/').map(encodeURIComponent).join('/')}?w=${w}`;
