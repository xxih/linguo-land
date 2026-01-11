// apps/extension/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
    build: {
      emptyOutDir: false,
      rollupOptions: {
        input: {
          // 定义多个入口点
          popup: resolve(__dirname, 'popup.html'),
          option: resolve(__dirname, 'options.html'),
        },
        output: {
          entryFileNames: `src/[name].js`,
          chunkFileNames: `chunks/[name].js`,
          assetFileNames: `assets/[name].[ext]`,
        },
      },
    },
  };
});
