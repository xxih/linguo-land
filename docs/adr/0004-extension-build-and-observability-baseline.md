# ADR 0004 — Extension build & observability baseline

**Status:** Accepted — 2026-04-25

## Context

The Chrome extension's build had three pain points that compounded each other:

1. **7 Vite configs**, ~28 lines each, duplicating plugin imports, alias setup, output naming, and build options. Any change to the shared logic (e.g. enabling source maps) had to be made in 7 places, and one config — `vite.config.content-ui.iife.ts` — was already drifting (no `emptyOutDir: false`, relying on first-in-chain ordering to coincidentally work).
2. **No production source maps.** Stack traces from production builds pointed at minified columns with no way to map back to source.
3. **No global error reporting** in any of the runtime contexts (background service worker, content-ui Shadow DOM React tree, popup, options). A React render crash showed a blank UI; an uncaught promise in the background service worker just disappeared.

Compounding issue: `Logger.log()` started with `if (!isDevelopment) return`, **silencing every log including ERROR in production builds** — defeating the point of having a logger at all.

`apps/server/.env` was referenced by `ConfigModule.forRoot({ envFilePath: '.env' })` but no `.env.example` was committed, so contributors had to guess required env vars by grep.

## Decision

### Vite

Extract `defineExtensionConfig({ mode, input, format, emptyOutDir, cssCodeSplit, root, port })` into `vite.config.factory.ts`. The 7 existing config files become 5–10 line thin callers; the factory is the only place plugins, aliases, output naming, and shared build flags live. `emptyOutDir: true` is now an explicit per-step opt-in (today only `content-ui.iife` sets it, by virtue of being first in the build chain) rather than an accidental default.

### Source maps

Factory sets `build.sourcemap = true` for every build. Resulting `.map` files ship alongside `.js` (verified across all 5 entry bundles). Total map weight ~5.5 MB — fine for an internal extension, can be revisited if uploaded to Sentry later.

### Error boundaries

New `src/lib/ErrorBoundary.tsx` (logs via `Logger.error`, renders a minimal Tailwind-classed fallback). Wrapped at all React render sites:

- `content-ui/main.tsx`: WordCard, TranslationCard, Toast renders
- `popup/index.tsx`, `options/index.tsx`: top-level entry points

### Background service worker

`self.addEventListener('error', ...)` and `self.addEventListener('unhandledrejection', ...)` route into `Logger.error`, capturing sync and promise-rejection failures that would otherwise vanish.

### Logger fix

`log()` now silences only `DEBUG` and `INFO` in production. `WARN` and `ERROR` always emit so real signals reach DevTools / future error pipelines.

### Server env doc

`apps/server/.env.example` template added with `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CORS_ORIGINS`, `DASHSCOPE_API_KEY`, `PORT`.

## Consequences

- One source of truth for Vite. Adding a new entry point is "make a 5-line config that calls the factory" instead of "copy and modify one of 7."
- Production crashes are now traceable via source maps. Background unhandled rejections AND React render crashes get logged with proper Error objects.
- ErrorBoundary fallback UI is minimal (Tailwind classes, degrades to readable plain text if Tailwind itself failed). Specific surfaces can pass a richer `fallback` prop later.
- Logger fix means production builds now emit JSON-stringified WARN/ERROR to the console — slightly chattier, but that's the point.
- `.env.example` is the only artifact a new contributor needs to copy.

## Open follow-ups

- Wire up real error reporting (Sentry or similar) — source maps and `Logger.error` pipeline are now ready for it.
- Audit remaining direct `console.*` calls in `src/` (notable offender: `testTextProcessor.ts`) and route through Logger.
- `Options.tsx` is still a single 2290-line file — addressed by ADR 0005.
