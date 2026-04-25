# 0010 WXT shadow host 内联样式必须带 !important

- 日期：2026-04-25
- 相关：[ADR 0007 — 扩展打包迁移到 WXT](0007-extension-migrate-to-wxt.md)；`apps/extension/src/content/utils/wordCardManager.tsx`

## Context

WXT 迁移（ADR 0007）落地后出现一个怪现象：点击页面单词，词卡 shadow host 实际被插入到 DOM 里、React 树也挂上了，但卡片不可见 —— 用 DevTools 检查发现 host 的 `computed position` 是 `static`，整个 shadow host 被排到了 `<body>` 末尾、`top/left` 内联值被忽略。

排查发现：WXT 的 `createShadowRootUi` 默认会在 shadow root 里注入一条样式：

```css
:host {
  all: initial !important;
}
```

这条规则的 `all: initial !important` 优先级压过普通 inline style，导致：

```ts
Object.assign(host.style, {
  position: 'absolute',
  left: '100px',
  top: '200px',
  ...
});
```

里所有属性都被重置回初始值（`position: static`、`left: auto` …），host 表现为一个无定位的普通 div 堆在文档流里。

只有带 `!important` 的 inline style 才能压过 `:host { all: initial !important }`。

## Decision

`wordCardManager.tsx` 里所有给 shadow host 设置定位 / 可见性 / z-index / pointer-events 的地方，**统一改用 `host.style.setProperty(name, value, 'important')`**，不再用 `Object.assign` / `host.style.X = …`。涉及四个写入点：

1. `applyHostStyles` —— 词卡 / 翻译卡的初始定位
2. `showToast` —— Toast 的 `position: fixed` + 右上角锚定
3. `scheduleRepositionAndShow` 的 rAF×2 fast path 与 200ms timeout 兜底分支 —— reposition 后再次写 left/top + visibility
4. `setupResizeObserver` 的 ResizeObserver 回调 —— 卡片内容尺寸变化后重算位置

并在两处加注释（`applyHostStyles` 与 `showToast`），说明这是为了对抗 WXT 默认的 `:host { all: initial !important }`，避免后人再用普通 inline style 踩同一个坑。

## Consequences

**好处**：

- 词卡 / 翻译卡 / Toast 的 host 定位回归正常
- 注释把"为什么必须 !important"钉在代码里，下一个写 shadow UI 的同学不用再重新排查

**代价**：

- 代码冗长（每个属性一行 `setProperty`），无法用 `Object.assign` 批量赋值；接受
- 跟 WXT 默认行为绑定，未来 WXT 版本如果改了 reset 注入策略，这层 `!important` 会变成噪音。但删除它的成本很低，发现时再清

**没动的相关问题**（写到 backlog 也不合适，记一下）：

- `loadingIndicator` 是手写的 light DOM `<div>`，不走 shadow root，不受这个坑影响
- 其它通过 `createShadowRootUi` 创建的 UI 如果将来需要在 host 上加样式，记得对照本 ADR
