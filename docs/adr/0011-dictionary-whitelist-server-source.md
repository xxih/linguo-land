# 0011 词典白名单走后端 + 客户端镜像 + 失败可见

- 日期：2026-04-25
- 相关：[backlog.md#P0 白名单词典是打包进去的静态 JSON](../../docs/backlog.md)；[ADR 0008 — 用户词库本地镜像](0008-extension-vocab-local-mirror.md) 给客户端镜像树立的基线

## Context

扩展的"哪些词在白名单内"原本读 `apps/extension/public/dictionary.json`（43442 行 lemma），三个明显问题：

1. **词典升级要发新版扩展**——商店审核来回，急用都没法用
2. **加载失败静默降级到空 Set**（[`dictionaryLoader.ts:146`](../../apps/extension/src/content/utils/dictionaryLoader.ts)）—— 一旦失败 `isValidWord` 永远 false，整个高亮链路静默死掉，但用户看不到任何提示
3. 跟 ADR 0008 的"用户词库本地镜像"形成两套分裂体系：用户词库走后端 + storage 镜像，白名单却仍然是打包进 zip 的静态文件

## Decision

把白名单纳入跟用户词库**同一套客户端镜像范式**，源头放后端，失败可见。

### 后端

- 数据文件 `apps/extension/public/dictionary.json` 移到 `apps/server/src/data/dictionary-whitelist.json`（已经被 `nest-cli.json` 的 `assets: ["data/**/*"]` 配置自动复制到 dist）
- 新增 `DictionaryWhitelistService` —— `OnModuleInit` 时读 JSON、计算 sha1 前 12 位作为 version、常驻内存
- 新增 `DictionaryWhitelistController` 暴露 `GET /api/v1/dictionary-whitelist`
  - **公开接口**，不挂 `JwtAuthGuard`——首次安装、未登录态也要能拉
  - 加 `Cache-Control: public, max-age=3600`，service worker 自身的 HTTP 缓存能命中
  - 单独一个 path（不是 `/api/v1/dictionary/whitelist`）以避开 `DictionaryController` 的 `:word` 通配路由 + 它的全局 JWT 守卫

返回形状 `{ version: string; words: string[] }`，对应客户端 `DictionaryWhitelistResponse`（`shared-types/index.ts`）。

### 扩展端 background

- 新增 `apps/extension/src/background/dictionaryMirror.ts`，照搬 `vocabularyMirror.ts` 的形态：
  - `chrome.storage.local['dictionaryWhitelist']` 持久化
  - `init()`：先 storage 还原 → service worker 重启即用；再异步 syncFromRemote 兜底
  - `syncFromRemote()`：fetch 后端，version 同则跳过持久化（节省一次 storage 写）
  - `getResult()` —— 给消息处理器用：有 snapshot 直接返回；首次安装无 snapshot 时 `await syncFromRemote()`，仍失败则 `{ ok: false, error }`
- `messageHandlers` 加 `case 'GET_DICTIONARY_WHITELIST'`，把 mirror 的结果原样回给内容脚本
- `background.ts onStartup` 同时调用 `DictionaryMirror.init()`，与 `VocabularyMirror` 对称

### 扩展端内容脚本

- `DictionaryLoader.loadDictionary()` 不再 `fetch(chrome.runtime.getURL('dictionary.json'))`，改为发 `GET_DICTIONARY_WHITELIST` 消息；内容脚本只负责把 words 数组建成 Set + 维护 ignoredWords
- `initialize()` 现在返回 `{ ok, error? }`；`content.ts` 拿到失败结果**显式弹 toast**："词典加载失败：…，请检查网络后刷新页面"
- `isValidWord()` 在 `dictionarySet === null` 时返回 false（高亮全停）—— 不再"全词放行"的隐式降级；toast 已经把失败暴露给用户

### 清理

- 删 `apps/extension/public/dictionary.json`（移到 server 后这里就没用了）
- `wxt.config.ts` 的 `web_accessible_resources` 去掉 `dictionary.json`

## Consequences

**好处**

- 白名单后端可热更新，不需要发扩展新版
- 失败时用户能看见 toast，不再静默死
- 跟用户词库镜像统一一套范式（storage + memory + onStartup），降低心智成本
- chrome.storage.local 缓存让二次启动几乎是即时的（无网也能用过往快照）

**代价**

- **首次安装强依赖网络**——以前打包静态文件支持完全离线初装，现在没装到就拉不到。这是有意为之：以终为始，宁可一开始要联网，也比挂着一个永远打不开新词的静态文件强
- 增加了一个公开接口，后续其它"全用户共享"数据可以参照同一形态扩展
- `DictionaryLoader.initialize()` 签名变了（返回 Result）；当前唯一调用方是 `content.ts:initializeManagers`，已同步更新

## 没动的相邻问题

backlog 里跟词典 / 高亮链路相关的还在排队，本 ADR 不动它们：

- 短语 / 多词词条支持（用户明确这次跳过）
- `getHighlightAtPosition` 改 `caretPositionFromPoint`（P1）
- Text 节点级缓存 + MutationObserver 增量（P1）
- iframe 跨 frame 事件总线（P1）
- 副词映射表 400 行硬编码下沉到后端（P2）—— 跟本 ADR 同形态：可以挂同一个公开接口并在客户端镜像
