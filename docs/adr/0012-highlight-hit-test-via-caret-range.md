# 0012 高亮命中查询用 caretRangeFromPoint + Text 节点反查索引

- 日期：2026-04-25
- 相关：[backlog.md#P1 getHighlightAtPosition O(n) 线性扫描](../../docs/backlog.md)；`apps/extension/src/content/utils/highlightManager.ts`

## Context

`HighlightManager.getHighlightAtPosition(x, y)` 在两条热路径上被调用：

- `handleMouseMove`：用户按住 Alt 移动鼠标 → 每个 `mousemove` 事件都查一次（用来切 `cursor: pointer`）
- `eventHandlers` 的点击 / 悬停判定：每次点击或悬停一次

旧实现：

```ts
for (const item of this.registry.items) {
  const rects = item.range.getClientRects();
  for (const rect of rects) {
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      return item;
    }
  }
}
```

`registry.items` 是页面所有高亮项的扁平数组。一篇长文 5000 个高亮 + 用户按 Alt 拖鼠标 = 一帧内 5000 次 `getClientRects()`。`getClientRects` 会触发布局，整页直接卡到不可用。

## Decision

把命中查询从"几何全表扫"换成"浏览器原生 hit-test + 反查索引"。

### 反查索引

`HighlightManager` 增加 `private itemsByNode: Map<Text, HighlightInfo[]>`，与 `registry.items` 同步维护：

- `addItem(info)` 同时压入 `items` 数组和 `itemsByNode` 列表
- `clear()` 一并清空两个结构
- `removeWordHighlight` 在过滤 `items` 数组时同步从 `itemsByNode` 删除对应项

### 命中查询

```ts
getHighlightAtPosition(x: number, y: number): HighlightInfo | null {
  const range = document.caretRangeFromPoint(x, y);
  if (!range) return null;
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  const list = this.itemsByNode.get(node as Text);
  if (!list) return null;
  const offset = range.startOffset;
  for (const item of list) {
    if (offset >= item.startOffset && offset < item.endOffset) {
      return item;
    }
  }
  return null;
}
```

`caretRangeFromPoint` 是浏览器渲染层提供的 hit-test，O(log n) 走的是布局树而不是 JS 数组扫；返回的 `Range.startContainer + startOffset` 落点恰好定位到 Text 节点的具体偏移，再用 `itemsByNode` 取出该节点上的 1-3 个高亮，按 `[startOffset, endOffset)` 半开区间精确判定。

整体每次调用从 O(n_total_highlights × n_clientRects_per_highlight) 降到 O(1) 摊销 + 一次原生 hit-test。

### 边界

- `caretRangeFromPoint` 在落点不在任何 Text 节点上时返回 `null` —— 被空白 / 元素边界吃掉，按未命中处理
- caret 卡在词尾（offset == endOffset）时，按半开区间放过它给后一项—— 跟旧实现的"严格在 rect 内"语义相同，因为 rect 也不会重叠
- 标准是 `caretPositionFromPoint`，但 `caretRangeFromPoint` 在 Chromium 里更老更稳；本仓库只发 Chrome 扩展（MV3），坚持用 `caretRangeFromPoint`

## Consequences

**好处**

- Alt 拖鼠标 / 大量点击 / 长文滚动悬停的卡顿点直接消失
- 读路径完全不触发布局，跟 `IntersectionObserver` 的优化方向一致（backlog 还有一项 P1 是把 `getBoundingClientRect` 也换掉）
- 反查索引一旦建起来，将来需要"该节点上有哪些高亮"的其它操作也能复用

**代价**

- 多维护一个 Map，写路径多一次插入 / 删除，常数微增（高亮总数 5000 内忽略不计）
- caret hit-test 和几何 hit-test 在跨行高亮的极端情况下结果可能微差（旧实现按多个 ClientRect 判，新实现按 caret 落点判）—— 实践中影响不到正常使用，因为单词高亮永远只占一行内的连续 offset 区间

## 没动的相邻问题（继续在 backlog 里排）

- 全量重扫无缓存，SPA 路由 / 虚拟滚动反复整树扫（P1）—— 这是 `extractTextNodes` 那条路径
- `getBoundingClientRect` 每节点调用（P1）—— 在 `textProcessor` 的可见性检查里
- 高亮命中 / 词形还原回归测试（P2）—— 本次新逻辑没补测试（caretRangeFromPoint 在 jsdom 里跑不出真实结果），等专门测试任务里一起搞
