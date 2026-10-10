/** 测试用的主题：astro-mori/… 从 MORI_THEME 指的主题仓库（或任一 MORI 项目）里取；没设就用开发依赖装的 astro-mori（主题仓库的 main） */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { useTheme } from '../src/theme.mjs';

// 用真实路径：pnpm 的 node_modules/astro-mori 是符号链接，主题自己的依赖装在真实目录旁边
process.env.MORI_THEME ??= realpathSync(fileURLToPath(new URL('../node_modules/astro-mori', import.meta.url)));
useTheme(process.env.MORI_THEME);
