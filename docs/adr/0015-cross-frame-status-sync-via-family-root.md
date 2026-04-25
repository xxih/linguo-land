# 0015 跨 frame 状态广播携带 familyRoot

- 日期：2026-04-26
- 相关：[backlog.md#P1 iframe 各自为战](../../docs/backlog.md)；[ADR 0008 — 用户词库本地镜像](0008-extension-vocab-local-mirror.md)；[ADR 0011 — 词典白名单走后端](0011-dictionary-whitelist-server-source.md)

## Context

扩展 `allFrames: true` 注入所有 frame，每个 iframe 都跑一份独立的 content script + HighlightManager。早期的 backlog 描述了三个症状：

1. ~~每个 iframe 独立加载词典~~ —— ADR 0011 已收口到 background 镜像
2. ~~每个 iframe 独立查询~~ —— ADR 0008 的 `VocabularyMirror` 让所有 frame 共用 background 单一权威
3. **主页面"标记已掌握"事件不会同步到 iframe** —— 这是本 ADR 要解决的最后一个症状

`chrome.tabs.sendMessage(tabId, msg)` 在 MV3 下默认派发到 tab 内**所有 frame**，所以广播本身没问题。真正的 gap 在 payload：消息只带字面 `word`，接收侧 `highlightManager.updateWordStatus(lemma)` 用 `item.lemmas.includes(lemma)` 匹配，**对不同词形不友好**：

- main 页用户点 "running" 标 known
- iframe 高亮的是 "ran"，注册表里 `lemmas=["run"]、familyRoot="run"`
- 广播 `word="running"` 到 iframe → `lemmas.includes("running")` 全部 false → iframe 的 "ran" 状态没变

而后端层面 `running / runs / ran / run` 是同一个 family，状态本就该一起翻。

## Decision

把"词族根" `familyRoot` 一起塞进广播，让接收侧能按 family 整族匹配。

### shared-types

`ChromeMessage` 增加：

```ts
familyRoot?: string;
```

### background

`MessageHandlers.notifyContentScriptUpdate` 在派发前向 `VocabularyMirror.query([word])` 拿 `familyRoot`：

```ts
const hit = this.mirror.query([word])[word];
chrome.tabs.sendMessage(sender.tab.id, {
  type: 'WORD_STATUS_UPDATED',
  word, status, familiarityLevel,
  familyRoot: hit?.familyRoot ?? word,
});
```

镜像在写入路径已经先于 notify 被更新（`applyMutationToMirror` 已 await 完），所以这里查到的是**最新** family 信息，不会有读到旧值的窗口。

`notifyContentScriptWordIgnored` 同样带上 `familyRoot`，给将来按需扩展（当前接收侧仍只按字面 word 移除 —— 因为忽略列表本就是按词形粒度，整族删反而过界）。

### content

`HighlightManager.updateWordStatus(lemma, status, level, familyRoot?)` 新增可选参数：

```ts
const matchingItems = this.registry.items.filter((item) =>
  familyRoot ? item.familyRoot === familyRoot : item.lemmas.includes(lemma),
);
```

`familyRoot` 提供时按 family 整族匹配；缺省走旧的 lemma includes 路径，兼容直接调用方（未来如果有内部代码不通过广播链路也能继续用）。

`EventHandlers.handleRuntimeMessage` 把 `message.familyRoot` 透传给 `updateWordStatus`。

## Consequences

**好处**

- main 页面的状态变更会**完整传播到所有 iframe**：标 known 即整族切灰、标 learning 即整族变蓝
- ADR 0008 + 0011 + 本 ADR 三块拼齐，扩展终于以"frame 透明"的姿态运作 —— 后端是单一权威、background 是单一镜像、所有 frame 都是该镜像的视图
- `familyRoot` 多 frame 同名是基于后端 family root 稳定，不需要在 mirror 里做额外协调

**代价**

- `notifyContentScriptUpdate` 多一次 mirror 查询；query 是纯内存 Map，常数时间，可忽略
- 新加 `familyRoot?` 字段挂在 `ChromeMessage` 通用 union 上 —— 跟 `WORD_STATUS_UPDATED / WORD_IGNORED` 强相关，挂在通用 message 上有点不雅；为了不大改 message 类型分割保留这个权衡
- iframe 的 ignore 同步**仍走 `chrome.storage.onChanged` 触发的全量 rescan** —— 这条链路独立、本 ADR 不动；后续如要优化（按 family 局部清理），再单独做

## 没动的相邻问题

- `chrome.storage.onChanged` 监听 `ignoredWords` 后做 `scanAndHighlight()` 全量扫描，跟 ADR 0014 的增量方向冲突 —— 单独排
- ADR 0008 留下的"少数边缘 case：lemma → family 映射也镜像下来" 仍待补
- iframe 的 popup-state（如详情卡同步、悬停同步）暂不跨 frame 协同，目前用户使用没遇到问题，先不做
