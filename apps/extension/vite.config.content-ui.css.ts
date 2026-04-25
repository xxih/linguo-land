import { defineExtensionConfig } from './vite.config.factory';

// Bundles the Tailwind stylesheet as a standalone asset injected into Shadow DOM.
export default defineExtensionConfig({
  mode: 'build',
  emptyOutDir: false,
  cssCodeSplit: true,
  input: {
    'tailwind-styles': 'src/index.css',
  },
});
