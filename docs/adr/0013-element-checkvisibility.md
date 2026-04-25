# 0013 元素可见性检查改用 Element.checkVisibility

- 日期：2026-04-26
- 相关：[backlog.md#P1 可见性检查 getBoundingClientRect 每节点调用](../../docs/backlog.md)；`apps/extension/src/content/utils/textProcessor.ts`

## Context

`TextProcessor.isElementVisible(element)` 在两处热路径被调用：

- `extractTextNodes` 的 `TreeWalker.acceptNode`（每个文本节点跑一次，5000+ 节点的长文 = 5000+ 次）
- `highlightManager.highlightNodes` 内的二次校验（每个 word 一次）

旧实现：

```ts
while (current && current !== document.body) {
  const style = window.getComputedStyle(current);
  if (style.display === 'none' || style.visibility === 'hidden' || ...) return false;
  // 各种祖先 / 类名 / 属性检查
  current = current.parentElement;
}
const rect = element.getBoundingClientRect();
return rect.width > 0 && rect.height > 0;
```

两个问题：

1. **每个祖先 `getComputedStyle`** —— 触发样式计算
2. **末尾 `getBoundingClientRect`** —— 强制 layout

5000 节点 × 多个祖先 × 每次 layout = 长文打开和首次扫描卡到肉眼可感。

## Decision

主路径换 `Element.checkVisibility(options)`（Chrome 105+ 原生，不强制 layout），祖先 walk 只保留**不会触发 layout** 的产品级启发式。

```ts
if ('checkVisibility' in element) {
  const visible = element.checkVisibility({
    checkOpacity: true,
    checkVisibilityCSS: true,
    contentVisibilityAuto: true,
  });
  if (!visible) return false;
}

let current: Element | null = element;
while (current && current !== document.body) {
  if (current.hasAttribute('hidden')) return false;

  if (current.tagName === 'OPTION' && current.parentElement?.tagName === 'SELECT') {
    if (!(current.parentElement as HTMLSelectElement).matches(':focus')) return false;
  }

  if (
    current.classList.contains('dropdown-menu') ||
    current.classList.contains('popover') ||
    current.classList.contains('tooltip') ||
    current.classList.contains('menu') ||
    (current.hasAttribute('aria-hidden') && current.getAttribute('aria-hidden') === 'true')
  ) {
    return false;
  }

  current = current.parentElement;
}
return true;
```

`checkVisibility({ checkOpacity, checkVisibilityCSS, contentVisibilityAuto })` 在浏览器内核里一次性算完整祖先链的 display / visibility / opacity / content-visibility，不强制 layout（用的是缓存中的样式 / 布局信息）。

剩下的 walk 只做 `hasAttribute` / `classList.contains` / `tagName` 这种 O(1) 节点属性查询，不触发任何样式或布局。

### 主动放弃的旧检查

- `style.width === '0px'` / `style.maxWidth === '0px'` / `style.maxHeight === '0px'` —— 罕见 case，且语义上不一定真不可见（max-height:0 + overflow:visible 仍可见）。`checkVisibility` 不算这类，对齐到规范行为
- 末尾的 `getBoundingClientRect().width/height > 0` —— 同样被 `checkVisibility` 的 display:none / content-visibility 路径覆盖；剩下"size 为 0 但不是 display:none"的 case 留给业务接受
- 旧实现里 YouTube 字幕的 `style.height === '0px'` 早就被注释掉了（YT caption 的 parent 计算高度真是 0），新实现自然不复现

## Consequences

**好处**

- `extractTextNodes` 的 acceptNode 不再触发 layout，长文首次扫描和增量扫描都明显流畅
- `isElementVisible` 现在是常数时间 + 原生 hot path，跟 `getHighlightAtPosition` 改 caretRangeFromPoint（ADR 0012）方向一致：**所有读路径不再触发 layout**

**代价**

- 依赖 Chrome 105+。MV3 最低 Chrome 88，理论上 88-104 区间没有 `checkVisibility`；用 `'checkVisibility' in element` 特性检测，缺失时直接走 walk（祖先链上没有 display/visibility/opacity 检查 → 误放行率上升）。这个区间的浏览器在 2026 年几乎绝迹，不再为它特殊维护一份 fallback
- 之前 `width:0px` 等启发式拒绝的 case 现在会被放行——若实际遇到再单独处理

## 没动的相邻问题（继续在 backlog 里排）

- 全量重扫无缓存（P1）
- iframe 跨 frame 事件总线（P1）
- 副词映射表硬编码（P2）
- 字幕容器选择器抽象成配置（P2）
