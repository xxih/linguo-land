import { defineExtensionConfig } from './vite.config.factory';

export default defineExtensionConfig({
  mode: 'build',
  emptyOutDir: false,
  format: 'iife',
  input: {
    background: 'src/background/background.ts',
  },
});
