import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  // WXT 默认 dev server 监听 3000，与本地 NestJS 后端冲突，错位到 3010 让 popup 能正常打到 :3000 的 API
  dev: {
    server: {
      port: 3010,
    },
  },
  vite: () => ({
    plugins: [react(), tailwindcss()],
  }),
  manifest: {
    name: 'LinguoLand',
    description: 'Your personalized language learning assistant.',
    permissions: ['storage', 'activeTab', 'contextMenus'],
    host_permissions: [
      'http://localhost:3000/*',
      'http://www.xxih.cc/*',
      'https://www.xxih.cc/*',
      'http://api.linguoland.com/*',
      'https://api.linguoland.com/*',
    ],
    web_accessible_resources: [
      {
        resources: ['word_groups_final_refined—25.json'],
        matches: ['<all_urls>'],
      },
    ],
    icons: {
      '16': 'logo.png',
      '48': 'logo.png',
      '128': 'logo.png',
    },
    action: {
      default_title: 'LinguoLand',
      default_icon: {
        '16': 'logo.png',
        '48': 'logo.png',
        '128': 'logo.png',
      },
    },
  },
});
