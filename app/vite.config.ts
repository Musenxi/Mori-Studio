import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { themeExports } from '../src/theme.mjs';

const STUDIO = process.env.MORI_STUDIO_URL ?? 'http://127.0.0.1:4400';
/** 打开的项目（mori-studio 构建前设好；单独跑 dev:ui 时自己设 MORI_ROOT=项目目录）：astro-mori/… 从它里面取 */
const ROOT = process.env.MORI_ROOT;
if (!ROOT) throw new Error('要设 MORI_ROOT=项目目录');
const theme = Object.entries(themeExports(ROOT)).map(([name, file]) => ({ find: new RegExp(`^${name}$`), replacement: file }));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: { alias: [{ find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) }, ...theme] },
  build: { outDir: '../dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 900 },
  // 开发时：界面走 Vite（热更新），接口和项目里的图片转给本机的 Studio 服务
  server: { port: 5173, proxy: { '/api': STUDIO, '/asset': STUDIO }, fs: { allow: ['..', ROOT] } },
});
