// 主题的模块在打开的项目里（src/theme.mjs），构建时才知道在哪
declare module 'astro-mori/flow';
declare module 'astro-mori/markdown';
declare module 'astro-mori/avatar';
declare module 'astro-mori/lucide' {
  export type IconNode = Array<[string, Record<string, string | number>]>;
  export const iconNode: (name: string) => IconNode | undefined;
  export const iconNames: () => string[];
  export function iconSvg(name: string, className?: string): string | null;
}
