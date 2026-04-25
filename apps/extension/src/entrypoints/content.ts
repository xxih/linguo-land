import { defineContentScript } from 'wxt/utils/define-content-script';
import { setupContent } from '@/content/content';
import '@/index.css';

export default defineContentScript({
  matches: ['<all_urls>'],
  matchAboutBlank: true,
  allFrames: true,
  cssInjectionMode: 'ui',
  async main(ctx) {
    await setupContent(ctx);
  },
});
