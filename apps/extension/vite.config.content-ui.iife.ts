import { defineExtensionConfig } from './vite.config.factory';

// First step in the build chain — emptyOutDir cleans dist/ before any other config writes to it.
export default defineExtensionConfig({
  mode: 'build',
  emptyOutDir: true,
  format: 'iife',
  input: {
    'content-ui': 'src/content-ui/main.tsx',
  },
});
