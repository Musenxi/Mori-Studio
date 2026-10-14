/** Studio 服务返回的数据形状（见 packages/studio/src/server.mjs） */
export type Kind = 'post' | 'page';

export interface Category { id: string; zh: string; en?: string; empty?: string }

export interface EntrySummary {
  kind: 'post';
  id: string;
  title: string;
  date: string;
  category?: string;
  tags: string[];
  words: number;
  /** 从没发布过（或已转为草稿） */
  draft: boolean;
  /** 已发布，但正在写的内容和已发布的不一样 */
  changed: boolean;
  pinned?: boolean;
  broken?: boolean;
}

export interface PageSummary { id: string; title: string; template: 'default' | 'friends'; draft: boolean; changed: boolean; comments: boolean; words: number; broken?: boolean }

export interface NavItem { label: string; href: string; icon?: string }
/** 页头右侧的一个操作：昼夜切换，或者一个链接（有 icon 就是图标钮） */
export type Action = { type: 'theme'; style?: 'text' | 'icon' } | { type: 'link'; label: string; href: string; icon?: string };

export interface PublishConfig {
  target: 'git' | 'cloudflare-pages' | 'rsync' | 'local';
  remote?: string; branch?: string; message?: string; project?: string; dest?: string;
}

export interface Project {
  root: string;
  configPath: string;
  dev: boolean;
  config: {
    title: string; description: string; accent: string; accentDark?: string; lang: string;
    /** 站点图标：预设 id 或 public/ 里的地址；旧版主题没有是 null。iconStamp 是图标文件的修改时间，换了图就变 */
    icon: string | null; iconStamp: number; iconPresets: Array<[string, string]>;
    categories: Category[];
    home?: { style?: 'quote' | 'cover' | 'list'; count?: number; direction?: 'h' | 'v'; tocDirection?: 'h' | 'v'; editorNote?: string };
    archive?: { direction?: 'h' | 'v' };
    feed?: { content?: 'excerpt' | 'full' };
    comments?: { avatar?: string; status?: 'on' | 'readonly' | 'off'; turnstileSiteKey?: string };
    nav: NavItem[] | null;
    actions: Action[] | null;
    actionsLayout: 'merged' | 'split';
    spoiler: 'particles' | 'blur' | 'ink';
    head: string;
    author: { name?: string; email?: string; url?: string };
    site: string;
  };
  entries: EntrySummary[];
  pages: PageSummary[];
  assets: string[];
  preview: { url: string | null };
  /** 给 MCP 客户端的启动命令（stdio）和本服务上的 /mcp 地址 */
  mcp: { command: string; args: string[]; url: string };
  publish: PublishConfig | null;
  comments: { provider: string | null; /** 头像地址模板，{hash} 换成评论的头像哈希；空 = 不显示 */ avatar: string; endpoint: string; hasToken: boolean; /** 第三方评论在 mori.config.ts 里的整块设置 */ third: Record<string, string> | null; pending: number };
  /** 新建的站点第一次打开：先走引导 */
  welcome: boolean;
}

export interface Friend { id?: string; name: string; url: string; desc?: string; avatar?: string; order?: number }

export interface Stats {
  pages: number; categories: number; words: number;
  comments: { total: number; unread: number } | null;
  views: number | null; online: number | null; likes: number | null;
}

/** 内容 JSON（文章、游记、页面）：编辑器里当作松散的对象处理，校验交给服务端 */
export type Doc = Record<string, any> & { title?: string; blocks?: any[] };
