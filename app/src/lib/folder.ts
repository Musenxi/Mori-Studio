/**
 * 图片的文件夹（和服务端 src/library.mjs 对应）：posts/<文章 id>、pages/<页面 id>、shared（共用）、''（未归类）。
 * 编辑器里用 AssetFolder 告诉图库、Markdown 编辑、排版视图“当前文章的文件夹”；不在编辑器里时是共用。
 */
import { createContext, useContext } from 'react';

export const SHARED = 'shared';
export const folderOf = (kind: 'post' | 'page', id: string) => (kind === 'page' ? `pages/${id}` : `posts/${id}`);

export const AssetFolder = createContext<string>(SHARED);
export const useAssetFolder = () => useContext(AssetFolder);

/** 内容 JSON 里的相对路径 ⇄ 图片路径 */
export const assetPath = (path: string) => `../../assets/${path}`;
export const assetOf = (src?: string) => (src ? src.replace(/^(\.\.\/)+assets\//, '') : '');
export const baseName = (p?: string) => (p ? p.split('/').pop() ?? '' : '');

/** 文件夹的显示名：文章、页面用标题 */
export function folderLabel(folder: string, titles: Map<string, string>) {
  if (folder === SHARED) return '共用';
  if (folder === '') return '未归类';
  return titles.get(folder) ?? folder.split('/').pop() ?? folder;
}
