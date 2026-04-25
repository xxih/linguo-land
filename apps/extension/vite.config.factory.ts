import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import tailwindcss from '@tailwindcss/vite';

const REPO_ROOT = resolve(__dirname);

interface BuildOpts {
  mode: 'build';
  /** Rollup input map; values are paths relative to apps/extension. */
  input?: Record<string, string>;
  /** 'es' for HTML-driven popup/options, 'iife' for content/background/content-ui scripts. */
  format?: 'es' | 'iife';
  /** Pass true on the FIRST build step in the chain to clean dist; subsequent steps must be false. */
  emptyOutDir?: boolean;
  cssCodeSplit?: boolean;
}

interface DevOpts {
  mode: 'dev';
  /** Vite root, relative to apps/extension. Defaults to apps/extension itself. */
  root?: string;
  port?: number;
}

export type ExtensionConfigOptions = BuildOpts | DevOpts;

export function defineExtensionConfig(opts: ExtensionConfigOptions): UserConfig {
  const shared = {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': resolve(REPO_ROOT, './src') },
    },
  };

  if (opts.mode === 'dev') {
    return defineConfig({
      ...shared,
      root: opts.root ? resolve(REPO_ROOT, opts.root) : REPO_ROOT,
      server: { port: opts.port ?? 5173 },
    });
  }

  const input = opts.input
    ? Object.fromEntries(
        Object.entries(opts.input).map(([k, v]) => [k, resolve(REPO_ROOT, v)]),
      )
    : undefined;

  return defineConfig({
    ...shared,
    build: {
      emptyOutDir: opts.emptyOutDir ?? false,
      sourcemap: true,
      cssCodeSplit: opts.cssCodeSplit ?? false,
      rollupOptions: {
        input,
        output: {
          format: opts.format ?? 'es',
          entryFileNames: 'src/[name].js',
          chunkFileNames: 'chunks/[name].js',
          assetFileNames: 'assets/[name].[ext]',
        },
      },
    },
  });
}
