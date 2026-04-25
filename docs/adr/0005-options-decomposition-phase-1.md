# ADR 0005 — Options.tsx 拆分（第一阶段）

**状态：** 已接受 — 2026-04-25

## 背景

`apps/extension/src/options/Options.tsx` 是一个 2290 行的单组件，里面塞着：

- 5 个内联 interface 声明
- 一套自定义的 URL 状态同步层（约 60 行）
- 鉴权流程（登录 / 登出 / 拉用户，约 30 行）
- `formatDate` 工具函数
- 6 个 tab 的 render 块：overview（约 180 行）、vocabulary-list（约 410）、vocabulary-import（约 170）、vocabulary-ignored（约 75）、features（约 250）、article-analysis（约 255）
- 大约 22 个负责拉数据 / 改数据 / 导入导出的 handler 函数
- 一个侧边栏 render（约 90 行）

改任何一个 tab 都有殃及其他 tab 的风险，找一个具体功能要在 2000+ 行里滚屏。一次完整拆解大概要 6 轮认真工作，所以拆成多个阶段做。

## 决策

### 第一阶段（本 ADR — 已完成）

抽出横切的基础设施：

- `src/options/types.ts` —— 5 个 interface + `ActiveTab` 联合类型
- `src/options/utils/formatDate.ts` —— `formatDate(dateString)`
- `src/options/hooks/useUrlState.ts` —— URL 参数状态、`setUrlState(updates)`、`handleTabChange(tab)`，以及一组派生的强类型字段（`currentPage`、`pageSize`、`sortBy`、`sortOrder`、`statusFilter`、`importSourceFilter`、`searchTerm`、`activeTab`）
- `src/options/hooks/useAuth.ts` —— `isLoggedIn`、`currentUser`、`handleLoginSuccess`、`handleLogout`。组件再包一层 `handleLogout` 顺便清掉 `vocabularyData`（保持 hook 只关心鉴权这一件事）

`Options.tsx` 改成 import 这些，行数从 **2290 → 2143**。

### 第二阶段（推迟）

`src/options/tabs/` 下抽 6 个 tab 组件：

- `OverviewTab.tsx`、`VocabularyListTab.tsx`、`VocabularyImportTab.tsx`、`VocabularyIgnoredTab.tsx`、`FeaturesTab.tsx`、`ArticleAnalysisTab.tsx`
- `components/Sidebar.tsx` 用于左侧导航
- 数据相关 hooks：`useVocabularyData`（list + stats + 行展开）、`useSettings`、`useIgnoredWords`、`usePresets`、`useArticleAnalysis`、`useExport`

第二阶段做完后 `Options.tsx` 会变成约 150 行的编排层 —— hook 调用 + tab 路由。

## 影响

- 拆分的接缝清晰可见。第二阶段是机械活：每个 tab 直接绑定到现成的 `./types` 和 `./hooks/*` 上即可。
- 第一阶段后 TypeScript 和 popup+options build 都通过，运行时行为零变化。
- 测试推迟到第二阶段：每个 tab 组件单测才是合理粒度；针对当前还是单文件状态的 `Options.tsx` 写测试就是凑覆盖率（参考 memory `feedback_tests_core_only`）。

## 后续

- 第二阶段 tab 抽取（同上）。
- 考虑把 `content-ui/main.dev.tsx` 这个 dev 变体也从 MUI / Emotion 迁走 —— 生产 content-ui 已经不依赖它们了，留着这俩 dep 任何文件不小心 import 一下 `@mui/*` 就多 ~150 KB。
