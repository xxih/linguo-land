# ADR 0004 — 扩展构建与可观测基线

**状态：** 已接受 — 2026-04-25

## 背景

Chrome 扩展的构建有三个互相加剧的痛点：

1. **7 个 Vite config**，每个 ~28 行，重复定义 plugins、alias、output 命名、构建选项。要改共享逻辑（比如启用 source map）必须 7 个地方一起改，而且其中一个 —— `vite.config.content-ui.iife.ts` —— 已经悄悄漂移（缺 `emptyOutDir: false`，依赖"它是构建链第一个"才偶然不出问题）。
2. **生产没有 source map**。stack trace 落在 minify 之后的列号上，根本没法回溯到源代码行。
3. **没有全局错误上报**，service worker、content-ui Shadow DOM 内的 React 子树、popup、options 都没有兜底。React 一个 render 异常就一片白屏，service worker 里一个未 catch 的 promise 直接消失无踪。

雪上加霜：`Logger.log()` 第一行是 `if (!isDevelopment) return`，**生产环境连 ERROR 都被吞掉** —— logger 等于摆设。

`apps/server/.env` 也是一直被 `ConfigModule.forRoot({ envFilePath: '.env' })` 引用，但仓库里没有 `.env.example` 模板，新人只能 grep 源码猜需要哪些 env。

## 决策

### Vite

抽出 `defineExtensionConfig({ mode, input, format, emptyOutDir, cssCodeSplit, root, port })` 工厂到 `vite.config.factory.ts`。原来 7 个 config 改成 5–10 行的薄壳调用方，工厂是 plugins / alias / output 命名 / 共享构建标志的唯一来源。`emptyOutDir: true` 现在是显式逐步声明（目前只有 `content-ui.iife` 设了，因为它是构建链第一个），不再依赖默认行为。

### Source maps

工厂统一开 `build.sourcemap = true`。`.map` 文件随 `.js` 一起出（5 个入口产物全部验证）。总 map 体积约 5.5 MB —— 内部扩展没问题，以后接 Sentry 时可以再调整。

### Error boundaries

新建 `src/lib/ErrorBoundary.tsx`（错误走 `Logger.error`，回退 UI 用 Tailwind class 写一个最小提示）。在所有 React 渲染点包一层：

- `content-ui/main.tsx` 的 WordCard / TranslationCard / Toast 三处 render
- `popup/index.tsx`、`options/index.tsx` 的入口

### Background service worker

加 `self.addEventListener('error', ...)` 和 `self.addEventListener('unhandledrejection', ...)`，全部走 `Logger.error`。原来 service worker 里同步 throw 和未 catch 的 promise rejection 是直接消失的。

### Logger 修复

`log()` 现在只在生产环境吞 `DEBUG` 和 `INFO`，`WARN` 和 `ERROR` 一定打出来 —— 真信号才到得了 DevTools / 未来的错误上报管道。

### Server env 文档

新增 `apps/server/.env.example` 模板，列出 `DATABASE_URL`、`JWT_SECRET`、`JWT_REFRESH_SECRET`、`CORS_ORIGINS`、`DASHSCOPE_API_KEY`、`PORT`。

## 影响

- Vite 只有一个真值源，加一个新入口现在就是"写一个 5 行 config 调工厂"，不再是"复制其中一个 config 然后微改"。
- 生产崩溃可以通过 source map 回到源码行。background 的 unhandled rejection 和 React render 崩溃都能拿到带 Error 对象的日志。
- ErrorBoundary 的回退 UI 是有意做最小化的（Tailwind class，万一 Tailwind 自己挂了就降级成纯文本可读）。具体页面以后可以传 `fallback` 给更丰富的展现。
- Logger 修了之后，生产构建会向 console 打 JSON 化的 WARN/ERROR —— 是会比之前噪 —— 但这正是我们要的。
- `.env.example` 是新贡献者唯一需要 copy 的样板。

## 后续

- 接真正的错误上报（Sentry 之类）—— source map 和 `Logger.error` 管道现在已经准备好了。
- 审计 `src/` 里残余的 `console.*` 直接调用（明显的偷懒户：`testTextProcessor.ts`），都改成走 Logger。
- `Options.tsx` 还是单文件 2290 行 —— 见 ADR 0005。
