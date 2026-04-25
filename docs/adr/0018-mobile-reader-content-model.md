# ADR 0018：移动端阅读器内容模型

## Context

要做手机阅读器（`apps/mobile`），目标是接入现有 `apps/server` 词典/词汇 API，覆盖以下场景：

- 用户上传自己的 `.txt` / `.epub` 文件，多端同步
- 系统预置一份示例文章（首登可读）
- 阅读时**单击**选词 → 查 `/dictionary` → 加 `/vocabulary`（联通现有词族/熟练度体系）
- 阅读进度跨端同步

EPUB 必须**保留原书排版**（CSS / 字体 / 段落布局）。这一条把"服务端把 EPUB 拆解成纯文本章节，移动端原生 RN 渲染"的路线否决——任何重排都会丢格式。剩下两条路：

1. **服务端拆章节存纯文本**：客户端两套渲染都简单，但格式全丢。✗
2. **服务端只存原 `.epub` blob**：客户端用 WebView + epub.js 直渲，原书 CSS 完整保留。✓

进度寻址：EPUB 的事实标准是 [EPUB CFI](https://idpf.org/epub/linking/cfi/epub-cfi.html)，epub.js 原生支持。TXT 没有这种东西，自己定一个 `<chapterIndex>:<charOffset>` 形式即可。两种格式由 `Document.fileFormat` 区分语义，存到一个 `locator: String` 字段里。

服务端是否需要为 EPUB 拆章节、存正文文本？v1 否。chapter 切分、章内文字提取这些事 epub.js 在客户端做得很好；服务端把这套再做一遍只会双重维护。**服务端只在上传时抽出元信息（title / author / TOC）**用于书架显示和章节跳转 UI，正文不入库。

## Decision

### 数据模型

```prisma
model Document {
  id          Int               @id @default(autoincrement())
  ownerId     Int?              // null = 系统预置，所有用户可见
  owner       User?             @relation(...)

  title       String
  author      String?
  fileFormat  DocumentFormat    // TXT | EPUB
  filePath    String            // 服务器盘相对路径
  sizeBytes   Int
  sourceLang  String            @default("en")
  toc         Json?             @db.JsonB  // EPUB TOC：[{ label, href, cfi? }]

  progress    ReadingProgress[]
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt

  @@index([ownerId])
}

model ReadingProgress {
  id         Int      @id @default(autoincrement())
  user       User     @relation(...)
  userId     Int
  document   Document @relation(...)
  documentId Int

  locator    String   // EPUB: CFI；TXT: "<chapterIdx>:<charOffset>"
  percent    Float?   // 0..1，书架进度条用

  updatedAt  DateTime @updatedAt
  @@unique([userId, documentId])
  @@index([userId])
}

enum DocumentFormat { TXT EPUB }
```

### 存储

文件落本地盘 `apps/server/uploads/documents/<uuid>.<ext>`，不入对象存储。原因：v1 单机部署、用户量小，对象存储是**预防过早优化**。等真有多副本/CDN 需求再迁，迁移成本只是把 `filePath` 解释从"本地路径"改成"OSS key"。

### 上传管线

`POST /documents/upload`：multer 收文件，按扩展名分支：

- `.txt`：仅落盘 + 用文件名当 `title`（用户后续可改），`toc = null`
- `.epub`：unzipper 解压到内存 → `META-INF/container.xml` → OPF（fast-xml-parser）→ 抽 `<dc:title>` / `<dc:creator>` / `<spine>` + `nav.xhtml` 或 NCX 拿 TOC → 存 `toc: Json`

### 阅读侧（移动端）

- **EPUB**：`@epubjs-react-native/core`（WebView 包 epub.js）。客户端 `GET /documents/:id/file` 拉 blob 缓存到本地，喂给 reader。
- **TXT**：服务端把全文也通过 `/file` 接口流回；客户端按 `\n\n` 切段落，段内按 `\b\w+\b` 切 token，用 `Pressable` 渲染，单击触发查词。

**单击选词**（核心交互）：

- TXT 路径直接 `Pressable` 单击。
- EPUB 路径在 epub.js `rendition.on('rendered')` 回调里向 iframe 注入脚本，`addEventListener('click')` + `caretRangeFromPoint` 取词（沿用 ADR 0012 扩展的同套技术），`postMessage` 回 RN。

不走系统 long-press 选择，原因：用户明确指定单击；long-press 体验在 EPUB iframe 内还会触发原生选择菜单，二次干扰。

### 进度同步

- 进入文档时 `GET /reading-progress?documentId=<id>` → 用 `locator` 跳转
- 阅读中 epub.js `relocated` 事件 / TXT 翻页时节流（5s 或换章）`POST /reading-progress`（upsert）

## Consequences

**得到**：

- EPUB 原书排版 100% 保留（这条是硬需求）
- 进度寻址用业界标准 CFI，跨设备稳定
- 服务端实现非常薄：只是文件存储 + 元信息抽取 + 进度 KV
- 多端同步天然支持（同 userId 拉到的进度一致）

**代价**：

- 移动端两套渲染分支（TXT 原生、EPUB WebView），单击选词逻辑要在两边各实现一遍
- 依赖 `epub.js` / `@epubjs-react-native/core` 的成熟度；这个库虽维护中但社区不大，未来可能要 fork 改
- 服务端不知道文档正文，未来想做"全文搜索"、"服务端预生成生词卡"之类的功能要回头补 chapter 拆分管线
- 文件存本地盘，多副本部署时要先迁 OSS

**v1 砍掉**：

- 离线阅读（v1 假设有网；本地缓存只做当前打开的那本）
- 图片/字体资源的额外抽取（直接走 epub.js 的内置资源解析）
- TXT 的章节自动切分（v1 整本一章；用户嫌长以后再说）
- 原文件之外的二次产物（搜索索引、阅读统计等）

## 相关 ADR

- ADR 0011：白名单服务端化（同样的"形态学/语言数据下沉后端"思路适用于后续 EPUB 处理）
- ADR 0012：caretRangeFromPoint 命中测试（单击选词复用此技术）
