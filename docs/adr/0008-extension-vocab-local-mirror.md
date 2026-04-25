# 0008 扩展端引入用户词库本地镜像

- 日期：2026-04-25
- 相关：[backlog.md#P0](../../docs/backlog.md) "客户端无词库缓存层" 一项

## Context

用户的核心使用方式是"打开任意网页，扩展立刻识别哪些是懂的、哪些不是"。但原实现里：

- 内容脚本每次扫描完页面，都把页面内的全部 lemma 通过 `QUERY_WORDS_STATUS` 发给 background，再走 `POST /vocabulary/query` 打后端。10 个标签页 = 10 次大请求；离线即停摆；网络抖动整页"懂/不懂"标记全消失。
- 单标签页里 SPA 切路由 / 虚拟列表上下滚 / 弹出详情后回退，都重复请求同一批词。

这是个人词库类工具的硬伤——词库是用户的资产，理应离线可用。

## Decision

把"个人词库"在客户端建立**完整本地镜像**，读路径 100% 走本地、不再回落网络；写路径仍以后端为权威。

### 后端

- 新增 `GET /api/v1/vocabulary/sync`：一次性返回当前用户拥有的所有 family + 每个 family 的全部 lemma 形态。形状见 `shared-types/index.ts` 的 `VocabularySyncResponse`。
- 改造 `PUT /vocabulary/:word` 与 `POST /vocabulary/:word/increase-familiarity`：响应里加 `family?` 与 `removedFamilyRoot?` 两个字段，扩展端凭此 in-place 更新本地镜像，避免写完再发一次额外查询。Service 层用一个 `MutationOutcome` discriminated union 统一表示 `updated / removed / noop` 三种结果。
- 删除遗留的 `WordState` 类型（无引用）。

### 扩展端

- 新增 `apps/extension/src/background/vocabularyMirror.ts`：单例，内存 `byLemma: Map<string, WordFamilyInfo>` + `byFamily: Map<string, VocabularySyncFamily>`，持久化到 `chrome.storage.local` 的 `vocabularyMirror` key。
  - `init()`：从 storage 还原 → 同步触发一次远端 sync 兜底（不阻塞）。service worker 重启后立刻可查询。
  - `query(lemmas)` 纯本地查询，大小写不敏感。**所有传入的 lemma 都会返回**——命中镜像 → 返回该 family 的真实状态；未命中 → 返回默认 `{ status: 'unknown', familyRoot: lemma 自身, familiarityLevel: 0 }`，让 content script 把它当作生词高亮（红色）。这和原 `/vocabulary/query` 行为对齐——后端对每个传入的 lemma 都会返回 entry，只是默认状态是 unknown。
  - `applyFamily(family)` / `applyFamily(null, removedRoot)` 写后回填。
  - `clear()` 登出时调用。
- `messageHandlers.handleQueryWordsStatus` 改成同步、纯本地查询；`handleUpdateWordStatus` / `BATCH_UPDATE` / `AUTO_INCREASE_FAMILIARITY` 写完都把 mutation 响应回填到镜像。
- `background.ts` 监听 `chrome.storage.onChanged` 的 accessToken：登录 → `syncFromRemote()`；登出 → `clear()`。
- 删除 `vocabularyApi.queryWordsStatus / batchQueryWords / createBatches / delay`（被本地镜像取代）。

### 不在范围内

- **lemma 与 client-side lemmatizer 的对齐**：扩展端 compromise 的还原结果应能与后端 Word.text 大致对齐（例如 "running" → "run"），但仍可能有边缘 case。镜像保留 family 的所有词形覆盖了大多数情况；个别词形若 client 未还原成功，会查不到 → 视为 unknown（仍然会被高亮，UX 与原有"未掌握"路径一致）。后续若数据显示问题集中，再考虑客户端用后端的词形归一表。
- **写入幂等性 / 离线写队列**：当前写仍同步等后端，失败抛出。离线写、重试队列、冲突合并属于下一阶段。
- **多设备同步实时性**：依赖用户重启扩展或登录事件触发 sync；下一阶段引入轮询或 push。

## Consequences

### 正面

- 页面扫描的词状态查询从"每标签页每次扫描一次网络往返"降到 0。SPA 切路由、长页滚动、多标签页全部命中本地。
- 离线可用：地铁、断网、后端故障时插件仍能正确高亮。
- 为下一阶段铺路：短语 / 多 token 词条（backlog P0-3）在本地匹配里实现成本更低；点击高亮检测的 O(n) 优化（P1）也不必绕开网络往返。

### 负面 / 风险

- **写路径耦合更深**：现在每次写后端都依赖 `family` / `removedFamilyRoot` 字段；后端漏返回会让镜像与权威数据不一致。已通过类型 `MutationOutcome` 强约束服务端必有明确分支。
- **镜像陈旧问题**：用户在 web 端（如 Options 页 / 未来的多端）改了状态后，扩展端镜像直到下次 `chrome.storage.onChanged` 触发或扩展重启才会刷新。短期靠"登录变更触发同步"覆盖最常见场景；后续可以加心跳或 push。
- **存储体积**：`chrome.storage.local` 默认 ~10MB；按 1k 词族 × 平均 5 lemma × ~6 字节估算 ~30KB，远低于阈值。
- 测试新增 `vocabularyMirror.test.ts` 覆盖 7 条核心路径（变形命中、大小写、未知词、删除、重复 apply、storage round-trip、clear）。后端写入路径暂未补 e2e（pre-existing 的 supertest 类型问题阻塞）。
