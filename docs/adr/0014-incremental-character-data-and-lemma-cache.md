# 0014 characterData 改增量 + 词形还原结果缓存

- 日期：2026-04-26
- 相关：[backlog.md#P1 全量重扫无缓存](../../docs/backlog.md)；`apps/extension/src/content/content.ts`、`apps/extension/src/content/utils/textProcessor.ts`、`apps/extension/src/content/utils/highlightManager.ts`
- 关联：[ADR 0012 — caretRangeFromPoint 命中查询](0012-highlight-hit-test-via-caret-range.md) 提供的 `itemsByNode` 反查索引在本 ADR 派上用场

## Context

backlog 标的"全量重扫无缓存，SPA 切路由 / 虚拟滚动反复整树扫"分两个症结：

1. **`MutationObserver` 在任何非字幕的 `characterData` 上都触发整树重扫**——React / Vue 这类 SPA 在状态更新时常发若干次 `characterData`（diff 文本节点），每发一次都重扫整页，500ms debounce 也救不了
2. **`getLemmasForWord` 没有缓存**——同一个词（"the" / "have" / "context"）在长文 + 字幕循环 + SPA 重渲染里反复出现，每次都要走 `nlp(word)`、`compromise` 内部规则匹配、再加几十行副词→形容词启发式

## Decision

### characterData 走增量

`setupDOMObserver`：

- 旧实现 `if (mutation.type === 'characterData' && !subtitle) needsFullScan = true; → scanAndHighlight()`
- 新实现：把 `mutation.target.parentElement` 收进 `characterDataParents: Set<HTMLElement>`，跟 `addedElements` 一起交给 `processRegularContent` 增量处理

`processRegularContent` 拿到 characterDataParents 后：

1. 先 `highlightManager.removeHighlightsInSubtree(parent)`：清掉这个子树里所有旧高亮——它们的 Range startOffset/endOffset 在文本被替换后已不可靠
2. 再 `scanAndHighlightNodes([...added, ...characterDataParents])`：在受影响的小子树上重建高亮

`removeHighlightsInSubtree(element)` 利用 ADR 0012 引入的 `itemsByNode` 索引：用 TreeWalker 走 element 的 Text 后代，逐个查 itemsByNode、批量删除 ranges + items。子树通常一两个节点，比对 5000 项的 registry 全表过一遍便宜得多。

### 词形还原缓存

`TextProcessor`：

- 加一个 `private static readonly lemmaCache: Map<string, string[]>`
- `getLemmasForWord(word)` 入口先 `cache.get(word.toLowerCase())`；命中直接返回，未命中才跑 nlp + 启发式，最后写回缓存
- 不设容量上限：英语活跃词汇有限，普通页面跑下来命中率应该在 80%+，长尾未知词的占用可忽略

## Consequences

**好处**

- React 应用里 typing / 状态更新只会重扫被改的小 span，不再每次 500ms 后整页洗一遍
- 长文滚动 / 字幕循环 / SPA 路由切换中遇到的旧词不再重新 lemmatize
- `removeHighlightsInSubtree` 是个通用工具，将来要做"局部刷新"还能复用
- 三处优化（[0012 caret hit-test](0012-highlight-hit-test-via-caret-range.md) / [0013 checkVisibility](0013-element-checkvisibility.md) / 本 ADR）合在一起把扩展的读路径几乎全部从"触发 layout"挪开

**代价**

- characterData 改增量路径有一个语义微差：如果同一帧里 React 先把节点的 textContent 整段换掉 + DOM 树拓扑也变（拆成不同的子元素），高亮可能在子树重建过程中短暂"不对齐"——但下一次 mutation flush 会兜回来
- lemmaCache 不带容量上限：极端情况下用户在一个超长生命周期 tab 里浏览了海量站点（含拉丁/日德语等被 nlp 当英语处理的"假词"），会缓存大量低价值词。监控到再加 LRU
- 现在子树清理依赖 `itemsByNode` 索引被准确维护（ADR 0012 已引入并在所有 add/remove 处同步）。今后再加新的高亮 push/remove 路径时务必同步索引

## 没动的相邻问题

backlog P1 / P2 还排队的：

- iframe 跨 frame 事件总线（P1）
- 副词映射表硬编码 → 后端下沉（P2）
- 字幕容器选择器抽象成配置（P2）
- WXT entrypoints 收敛（P2）
- 核心算法测试（P2）—— 这次改了关键的 `getLemmasForWord` 缓存路径和 `removeHighlightsInSubtree` 新方法，等 P2 测试任务里一起补
