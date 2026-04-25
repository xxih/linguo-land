import { defineExtensionConfig } from './vite.config.factory';

// Bundles popup.html and options.html (multi-entry, ES modules).
export default defineExtensionConfig({
  mode: 'build',
  emptyOutDir: false,
  input: {
    popup: 'popup.html',
    option: 'options.html',
  },
});
