# ADR 0007 — 扩展打包迁移到 WXT

**状态：** 已接受 — 2026-04-25

## 背景

ADR 0004 把 7 份 Vite config 抽成了一个工厂，是当时这套自写多入口架构能做的最大简化。但底层成本没被消除：

- 工厂只是把重复的 plugin/alias 收敛了，**入口本身仍然要 5 个独立 vite.config**（popup/options 一个、content / content-ui / background / tailwind-styles 各一个、加上 dev mode 的两个），靠 `emptyOutDir` 顺序串成 11 个 npm scripts。
- `manifest.json` 是手维护的 `public/manifest.json`，跟 `vite.config.*.ts` 里的 `output.entryFileNames` 要手工对齐。
- content script 拆成 `content` + `content-ui` 两个独立脚本，靠 `CustomEvent` 跨脚本通信，把 `shadowRoot` 引用塞进 `event.detail` 传给 React 树挂载方。`ShadowDomProvider` Context 是为了把这个 shadowRoot 透出给 Radix Tooltip 的 Portal 用。
- Tailwind v4 要单独打成 `assets/tailwind-styles.css`，声明成 `web_accessible_resource`，content-ui 通过 `chrome.runtime.getURL` 拉回来用 `<link>` 注入到 ShadowRoot。
- popup / options 有 HMR；content / background 改一行都要手动重新 load 扩展。

调研后选了 [WXT](https://wxt.dev) 作为新工具链：底层仍是 Vite，但有约定式 entrypoints、TS-typed manifest、跨脚本 ShadowRoot UI 的官方 API（`createShadowRootUi`），并且 content script 也有 HMR。

## 决策

### 工具链

- 引入 `wxt`（0.20.x），`srcDir: 'src'`，`outDir: 'dist'`。
- Vite 插件链通过 `vite: () => ({ plugins: [react(), tailwindcss()] })` 注入，原来工厂里那部分逻辑移到 `wxt.config.ts` 里成为单一来源。
- manifest 由 `wxt.config.ts` 的 `manifest` 字段生成，`public/manifest.json` / `manifest.jsonc` 删除。
- `package.json` scripts 收敛为 `dev` / `build` / `build:firefox` / `zip` / `version:bump` 等 wxt 标准命令。

### content + content-ui 合并

考虑过两条路：

- **(a)** 保留双脚本架构，让 WXT 只负责打包、content-ui 自己继续 `attachShadow` + `chrome.runtime.getURL` 拉 CSS。
- **(b)** 合并为单一 content script，使用 `createShadowRootUi` 接管 ShadowRoot 创建与 CSS 注入。

选 (b)。理由：

- 双脚本拆分本来就是伪关注点分离 —— 两个脚本都 `match <all_urls>`，React 包并不会因为 `CustomEvent` 解耦而少打包。
- (b) 直接消除最高风险点："Tailwind v4 怎么作为独立 CSS 资源给跨脚本 ShadowRoot 用" —— `cssInjectionMode: 'ui'` + `createShadowRootUi` 是 WXT 为这个场景内置的方案。
- (b) 顺势删掉 `injectShadowStylesheet`、`web_accessible_resources` 里的 CSS、`CustomEvent` 三个事件类型、跨脚本类型不安全的 `event.detail` 通道。
- 工作量上的差距（1–2 天 vs 2–3 天）相对一次性投入可以接受。

`ShadowDomProvider` 保留 —— `components/ui/tooltip.tsx` 用 `useShadowDom()` 拿 shadowRoot 给 Radix Portal 当 container，这是 ShadowRoot 内 portal 唯一可行的方式。只是 source 从 `event.detail.shadowRoot` 改成 `createShadowRootUi` 的 `onMount(uiContainer, shadow, shadowHost)` 第二个参数。

### Toast 一并合并

旧 toast 走第三种 `CustomEvent`（`lang-helper-show-toast`），在 light DOM 创建容器再 `attachShadow`，因为 Tailwind CSS 还没注进去而退化到 inline cssText 样式。新版 toast 也走 `createShadowRootUi`，跟 word card / translation card 三种弹窗用统一 API。

### vitest

WXT 默认接管 vite 但单元测试不应该依赖 WXT，`vitest.config.ts` 独立 alias `@: ./src` 和 `shared-types: ../../packages/shared-types`。

## 影响

- 旧 7 份 vite.config + factory + 11 个串联 npm scripts 全部删除。`apps/extension` 根目录下的 `popup.html` / `options.html` / `index.html` / `public/vite.svg` / `scripts/version-bump.js` 都没有消费方了，一并删掉。
- manifest 改由 `wxt.config.ts` 单一来源生成，host_permissions / web_accessible_resources / icons / action / background / options_ui 全部 typed 校验。
- Tailwind v4 的 ShadowRoot 注入改由 WXT 官方 `:root` → `:host` 重写 + 自动 fetch + 注入完成。`assets/tailwind-styles.css` 这个特殊 web_accessible_resource 不再存在 —— `web_accessible_resources` 现在只剩 `dictionary.json` 和 `word_groups_final_refined—25.json` 两个真的需要 fetch 的本地资源。
- content script 体积合并后从约 800KB（content + content-ui 两份）变成单份 895KB（重复打包消除）。background 27KB、popup 4.5KB、options 162KB、共享 chunk 233KB（React + Radix + MUI + Emotion）+ 70KB Tailwind CSS。
- `WordCardManager` 接受 `ContentScriptContext` 作为构造参数，承接 word card / translation card / toast 三种弹窗的 ShadowRoot 生命周期；旧版的 `dispatchShowCardEvent`、`createShadowHost` 等私有方法删除。
- `EventHandlers` 构造签名改为 `new EventHandlers(highlightManager, wordCardManager)` —— 把 manager 实例的所有权外提到 `setupContent(ctx)`，方便 `content.ts` 自己也能调 `wordCardManager.showToast`。
- `src/content/content.ts` 不再有顶层副作用，导出 `setupContent(ctx: ContentScriptContext)` 由 `entrypoints/content.ts` 调用。
- HMR 现在覆盖 popup / options / background / content 四类入口，不再需要"改完手动 reload 扩展"。

## 后续

- WXT 提供 `wxt zip` 出可上传商店的产物 —— 后续发布流程可以替换掉手工 `bumpp` + 打包。
- background / content 共享代码（Logger、shared-types）目前在两个 entrypoint 各自打了一份。WXT 默认不做 cross-entrypoint chunk split，后续如果体积成为瓶颈可以配 Rollup `manualChunks`。
- vitest 6 个失败的 `textProcessor.test.ts` case 是预存 bug（迁移前后行为一致），不在这次迁移范围内。
