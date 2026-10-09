/** 测试用的主题：astro-mori/… 从 MORI_THEME 指的主题仓库（或任一 MORI 项目）里取 */
import { useTheme } from '../src/theme.mjs';

if (!process.env.MORI_THEME) {
  console.error('要设 MORI_THEME=主题仓库目录，例如 MORI_THEME=../Astro-Theme-Mori pnpm test');
  process.exit(1);
}
useTheme(process.env.MORI_THEME);
