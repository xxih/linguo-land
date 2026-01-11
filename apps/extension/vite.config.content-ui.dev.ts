// apps/extension/vite.config.dev-ui.ts
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import tailwindcss from '@tailwindcss/vite'; // 你的项目已经在使用它

// 这个配置专门用于 content-ui 的独立开发
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(), // 确保Tailwind也能工作
  ],
  // 将项目根目录指向 `apps/extension`
  root: resolve(__dirname, '.'),
  server: {
    port: 5173, // 使用一个固定的端口
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {},
});
