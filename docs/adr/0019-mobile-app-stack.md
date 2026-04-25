# ADR 0019：移动端技术栈与单击选词架构

## Context

新增 `apps/mobile`，目标是在 iOS / Android 上提供一个能跑通"上传 → 阅读 → 单击选词 → AI 解释 → 词族状态流转 → 多端同步"全链路的阅读器，复用既有 NestJS 后端（auth / dictionary / vocabulary / ai）+ ADR 0018 落地的 documents / reading-progress 模块。

候选栈：

1. **React Native (Expo)**：与 monorepo 现有 TS / shared-types 完全同语言，跨平台；移动端文本选择体验需要自己实现。
2. **Flutter**：文本排版能力最强，但要再学一套 Dart + 生态分裂；与项目现有 NodeJS / TS 生态完全脱节。
3. **PWA / Capacitor**：阅读器手势交互（翻页、全屏阅读、离线缓存）相比原生体验明显差；EPUB 渲染又需要 WebView 套 WebView。

选 1。理由：

- 用户核心需求是"能用、迭代快"，Expo + Metro hot-reload 在 monorepo 里几乎零配置可跑
- 共享 `packages/shared-types`：mobile 对 documents / vocabulary / dictionary / AI 接口的所有入参出参完全跟 server 一致，类型一致改一处即可
- 阅读器已经决定走 WebView + epub.js（ADR 0018），native 能不能写文字渲染不重要

## Decision

### 栈

| 层 | 选型 | 备注 |
|---|---|---|
| 框架 | Expo SDK 55（`expo-router` v5） | 文件路由、auth gate 用嵌套 layout 实现 |
| RN | 0.83.x（SDK 55 锁版） | 新架构（new arch）默认开 |
| 样式 | nativewind 4 + Tailwind v3.4 | 见下方"样式偏离" |
| 鉴权存储 | `expo-secure-store`（移动端）+ `AsyncStorage`（web fallback） | 跨平台密钥读写包成 `secure-storage.ts` |
| HTTP | axios + 401 → refresh 自动重放 | 同时持有一个 SSE 流式消费器 `ai-stream.ts` 用 XHR `progress` 事件读 SSE |
| 状态 | zustand | 只用一个 auth store；阅读器局部状态用 useState |
| EPUB | `@epubjs-react-native/core` v1.4 + `@epubjs-react-native/expo-file-system` | 内部 WebView 跑 epub.js，原书排版完整 |
| TXT | 自渲：段落 → token Pressable | tokenize 用 `\p{Letter}` Unicode 类，连字符词整体一个 token |

### 样式偏离

`CLAUDE.md` 规定"本项目用 Tailwind v4，禁止内联样式"。移动端 v1 用 **Tailwind v3.4 via nativewind 4**，是经过权衡的偏离：

- nativewind 4 现阶段对 Tailwind v3 有完整支持（`nativewind/preset` + 标准 `tailwind.config.js`），对 v4 的 css-first 配置方式还在 staging。强行用 v4 风险大，没有获得任何业务价值。
- 仍遵守"禁止内联样式"的总原则——所有视觉走 `className`；个别需要传动态宽度（如进度条）的地方用 `style={{ width: '${pct}%' }}`，这是 nativewind 当前不支持百分比模板的兜底，写在 ADR 备案。
- web / extension / docs 仍用 Tailwind v4。

### Auth gate

`expo-router` 嵌套布局做条件重定向：

```
app/_layout.tsx       # 启动时 useAuthStore.init()，phase=loading 时显 spinner
app/index.tsx         # phase=authed → /(app)，否则 → /(auth)/login
app/(auth)/_layout.tsx  # 已登录则 redirect 到 /(app)
app/(app)/_layout.tsx   # 未登录则 redirect 到 /(auth)/login
```

token 存 SecureStore（key: `linguoland.access_token` / `linguoland.refresh_token`），axios 拦截器在每个请求头注入 `Bearer`，401 自动尝试 `/auth/refresh` 一次。

### 单击选词（核心交互）

两条渲染路径，单击逻辑独立实现但用户层等价：

**TXT 路径**：服务端 `/documents/:id/file` 返回纯文本 → `splitParagraphs` → `tokenize` → `Pressable` 单击触发 `onWordPress(word, paragraphContext)`。已加入生词本的词按 status 染色高亮（unknown 蓝、learning 黄、known 灰）。

**EPUB 路径**：epub.js 把 spine 渲染进 iframe；通过 `injectedJavascript` 把一段 ~70 行 IIFE 脚本注入到 iframe 内，做：
1. 监听 `click`，用 `caretRangeFromPoint`（或 `caretPositionFromPoint` fallback）拿到点击位置的文本节点 + offset
2. 用 `\p{Letter}/u` 双向扫描出整词
3. 包一个 `<span class="linguoland-tap">` 高亮选中的词
4. 找最近的 `<p|li|h*>` 取段落文本作为 AI enrich 的上下文
5. `window.ReactNativeWebView.postMessage(JSON.stringify({type:'linguoland.tap', word, sentence}))` 回 RN

RN 侧 `onWebViewMessage` 解析消息再转 `onWordPress`。这套思路与 Chrome 扩展 ADR 0012 的 `caretRangeFromPoint` 命中测试一脉相承，是同套技术应用到不同 host 而已。

### 进度同步

`ReadingProgress.locator` 是字符串，由 `Document.fileFormat` 决定语义：

- TXT：`"<chapterIdx>:<charOffset>"`，v1 chapterIdx 恒为 0
- EPUB：epub.js CFI 字符串

阅读器 4 秒节流上报到 `/reading-progress`（POST upsert）。进入文档时先 `GET /reading-progress/by-document/:id`，把 locator 喂回阅读器初始化位置：

- TXT：解析 `charOffset` → FlatList scrollToIndex 到对应段落
- EPUB：`initialLocation` 直接传 CFI 给 `<Reader />`

### AI 流式

后端 `/ai/enrich-stream` / `/ai/translate-stream` 是 SSE（`text/event-stream`，`data: {...}\n\n`）。RN fetch 在新架构下虽然支持 ReadableStream，但 Android 上 Hermes 兼容性不稳定。`src/lib/ai-stream.ts` 采用 **XHR + `onreadystatechange` 读 `responseText` 增量切帧**，比 fetch 路线在更多设备上稳定，且天然支持 `xhr.abort()` 取消（用户关 WordCard 立即停流）。

### 文件下载（EPUB）

`@epubjs-react-native/core` 的 `<Reader src=>` 接受 URL，但我们的下载需要带 `Authorization: Bearer`。最稳的做法是 mobile 自己用 `expo-file-system` 下载到 `Paths.cache` 再把本地 `file://` URI 喂给 reader。

### 文件结构

```
apps/mobile/
  app/                # expo-router file-based 路由
    _layout.tsx
    index.tsx         # auth gate redirect
    (auth)/login.tsx
    (app)/
      _layout.tsx
      index.tsx       # 书架
      upload.tsx      # 文件选择 + 上传
      reader/[id].tsx # 阅读器（按 fileFormat 分流）
      vocab/index.tsx # 生词本列表 + 过滤 + 搜索
      settings.tsx
  src/
    lib/api.ts        # axios + 401 refresh
    lib/api-endpoints.ts
    lib/secure-storage.ts
    lib/ai-stream.ts  # SSE 消费器（XHR）
    stores/auth.ts    # zustand
    components/WordCard.tsx
    components/FamiliarityBar.tsx
    reader/TextReader.tsx
    reader/EpubReader.tsx
    reader/tokenize.ts
    utils/logger.ts
```

## Consequences

**得到**

- 跟扩展 / 后端共享同一份 `shared-types`，类型一处改全链路对齐
- EPUB 原书排版完整（CSS / 字体 / 图片）保留
- 单击选词在 TXT 与 EPUB 体验等价
- 进度跨端同步：扩展只有"刷网页 / 看视频"是无 progress 概念的，但移动端阅读器写到同一个 user × document 唯一约束，未来 web reader / desktop reader 可无缝接同张表

**代价**

- 两条阅读渲染路径要各自维护
- nativewind 4 + Tailwind v3 与项目主体 v4 不一致——后续 nativewind 完整支持 Tailwind v4 时再统一
- iframe 内单击选词依赖 `caretRangeFromPoint`，少数老旧 Android Chromium 内核可能不支持 → fallback `caretPositionFromPoint`，再不济单击就是个 no-op，可接受
- AI 流走 XHR 而非 fetch ReadableStream，没法用 AbortController 优雅链路；用自己维护的 `aborted` flag + `xhr.abort()` 实现

**v1 砍掉**

- 离线缓存（除当前打开 EPUB 的本地下载）
- 主题切换（夜间模式 / 字号）暂只暴露给 EPUB 内置的 `defaultTheme`，TXT 是固定浅色
- 离线生词本（v1 假设有网才能用，offline-first 留 v2）
- 推送通知（生词复习提醒）

## 相关 ADR

- ADR 0008：扩展端词汇本地 mirror —— 移动端可在 v2 借鉴这套 mirror 模式做离线
- ADR 0012：caretRangeFromPoint 命中测试 —— 单击选词 iframe 内复用
- ADR 0017：rule-based lemma —— 移动端 v1 暂不在客户端做 lemma，全部依赖后端 `vocabulary.query` 的 surface form 展开
- ADR 0018：阅读材料数据模型 —— 这份 ADR 的客户端落地
