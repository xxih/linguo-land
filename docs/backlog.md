# 改进清单（Backlog）

本文件统一收纳"实现得不好"、"应该改进"、"以后要做"的问题。每次迭代从这里挑事做；做完用 `~~~~` 划掉并注明落地的 ADR / commit。

新增条目追加到尾部即可，按主题分节。优先级标记：`P0`（核心目标硬伤）/ `P1`（明显影响体验或稳定性）/ `P2`（卫生 / 长期债务）。

---

## apps/extension — 词汇识别与个人词库

### P0 — 核心目标硬伤

- ~~**客户端无词库缓存层，每次扫描都打后端**~~ ✅ 落地于 [ADR 0008](adr/0008-extension-vocab-local-mirror.md)
  - 位置：`src/content/content.ts:207`、`src/background/messageHandlers.ts:664`、`src/background/api/vocabularyApi.ts:46`
  - 现状：每个标签页全量扫描后通过 `QUERY_WORDS_STATUS` 把所有词元发给 background，再走 `/vocabulary/query`。多标签 = 多次大请求；离线即停摆。
  - 改进方向：扩展侧建本地词库镜像（IndexedDB 或 `chrome.storage.local`），background 启动时拉一次全量 + 增量同步（last-modified / 事件流）。content script 只做本地匹配，不走网络。

- ~~**白名单词典是打包进去的静态 JSON，加载失败静默降级**~~ ✅ 落地于 [ADR 0011](adr/0011-dictionary-whitelist-server-source.md)
  - 位置：`src/content/utils/dictionaryLoader.ts:125,146`
  - 现状：`chrome.runtime.getURL('dictionary.json')`，加载失败 fallback 为空 Set → 所有词都过不了白名单 → 整个插件静默哑掉。
  - 改进方向：词典走后端，与个人词库共享同一个本地缓存层。失败要有可见提示而不是静默降级。

- **短语 / 多词词条完全不支持**
  - 位置：`src/content/utils/textProcessor.ts`（compromise `.terms()` 单 token 粒度）
  - 现状：`machine learning`、`give up`、`in spite of` 这些对学习者最关键的搭配无法纳入词库。
  - 改进方向：词库 schema 加 `tokenCount` 字段，匹配时做最长前缀贪心匹配（3-gram → 2-gram → 1-gram）。

### P1 — 性能与稳定性

- ~~**`getHighlightAtPosition` O(n) 线性扫描**~~ ✅ 落地于 [ADR 0012](adr/0012-highlight-hit-test-via-caret-range.md)
  - 位置：`src/content/utils/highlightManager.ts:672`
  - 现状：每次点击/悬停遍历所有 `registry.items`，每项再 `getClientRects()`。5000 高亮 → 每次点击 5000 次几何查询。
  - 改进方向：用 `document.caretPositionFromPoint(x, y)` 拿到落点 Text 节点 + offset，再用 `Map<Text, HighlightInfo[]>` 反查，O(n) → O(1)。

- ~~**全量重扫无缓存，SPA 切路由 / 虚拟滚动反复整树扫**~~ ✅ 落地于 [ADR 0014](adr/0014-incremental-character-data-and-lemma-cache.md)
  - 位置：`src/content/content.ts`（`extractTextNodes(document.body)`）
  - 改进方向：以 Text 节点为 key 缓存 `{textHash → tokens}`，MutationObserver 增量只处理 diff 节点。

- ~~**iframe 各自为战，无跨 frame 协调**~~ ✅ 落地于 [ADR 0011](adr/0011-dictionary-whitelist-server-source.md) + [ADR 0015](adr/0015-cross-frame-status-sync-via-family-root.md)
  - 位置：`src/entrypoints/content.ts:8`（`allFrames: true`）
  - 现状：每个 iframe 独立加载词典 + 独立查询 + 独立维护高亮；主页面"标记已掌握"事件不会同步到 iframe。
  - 改进方向：background 当总线，把"词状态变更"事件广播到所有 frame 的 content script。

- ~~**可见性检查 `getBoundingClientRect` 每节点调用**~~ ✅ 落地于 [ADR 0013](adr/0013-element-checkvisibility.md)
  - 位置：`src/content/utils/textProcessor.ts:17-69,100`
  - 现状：每个 Text 节点都触发重排，大页面卡顿明显。
  - 改进方向：用 `IntersectionObserver` 或先按祖先元素粗筛。

### P2 — 卫生 / 长期债务

- **副词映射表 400 行硬编码**
  - 位置：`src/content/utils/textProcessor.ts:246-377`
  - 改进方向：用更完整的 wordnet 数据，或把映射数据下沉到后端、随词典一起拉。

- ~~**字幕特殊路径只覆盖 YouTube/Netflix**~~ ✅ 抽到 [`src/content/utils/subtitleSites.ts`](../apps/extension/src/content/utils/subtitleSites.ts) 的 `SUBTITLE_SITES` 数组，新增站点（Bilibili / Coursera / TED）只需追加一项配置；将来要换异步远端拉取，调用 API 不变。

- **WXT 迁移残留：entrypoints 是壳，真实逻辑还在 `src/content/`、`src/background/`**
  - 位置：`src/entrypoints/content.ts`、`src/entrypoints/background.ts`
  - 改进方向：逐步把核心逻辑收敛到 entrypoints 下。

- **核心算法测试覆盖不足**
  - 位置：仅有 `src/content/utils/textProcessor.test.ts`，高亮逻辑 / 点击命中 / 词形还原回归都没有
  - 改进方向：补词形还原、高亮命中两条核心路径的测试（按全局规则只测核心，不凑数）。

- ~~**`debugUtils` 等临时代码遗留在生产路径**~~ ✅ 落地于 commit 把内存监控 + 快捷键 + banner 收进 `import.meta.env.MODE === 'development'` 分支，prod 构建会被 Vite tree-shake；处理状态 mutex + 超时看门狗 + 全局错误兜底保留（属 service-level safety net）。
