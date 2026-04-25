# LinguoLand — AI 协作规则

本文件是 AI 编码助手（Claude Code 等）在本仓库工作时的规则与上下文来源。**所有规则在此处唯一维护**，不再分发到各 agent 专属配置。

## 项目概览

pnpm workspaces + Turbo 的 monorepo：

- `apps/server` — NestJS 后端，Prisma + Postgres，部署到阿里云 ECS
- `apps/extension` — Chrome 浏览器扩展（TypeScript + Vite + Tailwind v4 + shadcn）
- `apps/docs` — Docusaurus 用户文档站
- `packages/shared-types` — 跨应用共享的 TS 类型

## 通用规则

### 样式 / 组件（前端）

1. **优先用 Tailwind 写样式**，本项目用 **Tailwind v4**。**禁止内联样式**（`style={{}}` / `style=""`）。
2. **组件用 shadcn**。需要的组件如未引入，按 shadcn 规范自行引入。

### 日志

后端应用代码的日志不受限制（NestJS logger / pino 即可）。

**扩展（apps/extension）里的日志必须使用 `apps/extension/src/utils/logger.ts` 中的 logger**，不要直接 `console.log` / `console.error`。

### 环境变量

`apps/server` 启动时强制要求 `JWT_SECRET` 和 `JWT_REFRESH_SECRET`（否则崩溃）。新增需要 env 的功能时复用 `src/env.util.ts: requireConfig`，不要手写 `process.env.X || 'fallback'`。

### 文档语言

仓库内的所有文档（ADR、README、`.env.example` 注释、贡献者指南）一律**用中文撰写**。代码标识符（文件路径、函数名、变量名、环境变量名、npm 包名）保持英文不翻译。引用代码块、错误信息、API 字段名也保持英文原文。

## 架构决策记录（ADR）

非 trivial 的重构、schema 变更、新架构模式落地后，写一份短 ADR：`docs/adr/NNNN-<slug>.md`，结构 **Context / Decision / Consequences**。这是本项目的主要决策档案。

## 设计哲学：以终为始，不背兼容包袱

本项目目前**没有外部用户**，没有需要维护的公开 API 契约。AI 助手在做架构决策、重构、删旧代码时，**默认按"最终最优形态"设计，不要为了兼容旧代码、旧数据、旧文件结构而妥协**。

具体应用：

- **不写 backward-compatibility shims**。要废弃的旧 API、旧字段、旧文件直接删，不留过渡层、不加 deprecated 包装。
- **不做小步迁移 / 双写 / 影子表**之类的稳态过渡方案，除非有明确的运行时数据要保住（如 production DB 里的真实数据）。
- **遇到旧实现碍事直接重写**，不强求最小 diff。结果优先于"diff 整洁"。
- **数据库 schema 变更**：production DB 里的现有用户数据要保（用 Prisma migration），但代码层面的旧调用、旧 Service 方法、旧 DTO 不需要保留。
- 例外：仅在用户明确说"保留兼容性"时才加 shim/双写。

这条规则也意味着：当你拿不准"该重写还是该兼容"时，**默认重写**。

## 改进清单（Backlog）

每当审查代码、讨论中发现"实现得不好"、"应该改进"、"以后要做"的问题，**统一追加到 [`docs/backlog.md`](docs/backlog.md)**，不要散落在对话里、ADR 里或随手新建的笔记里。

- 每条记录至少包含：问题描述、所在文件/位置、改进方向、（可选）优先级
- 已完成的条目用 `~~strikethrough~~` 划掉并在条目后注明落地的 ADR / commit
- **每次迭代开始时翻这份清单挑选要做的事**，做完一项就划掉
- AI 助手发现新问题时，主动追加到清单尾部

## OpenSpec（可选）

仓库装了 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 用于 spec-driven 开发，规范在 `openspec/`。当前实践是**跳过 `/opsx:propose`**（太重），需要时直接用 `/opsx:apply` / `/opsx:archive`。

`.claude/commands/opsx/` 和 `.claude/skills/openspec-*/` 由 `openspec init` 生成，**不要手改**。需要升级跑 `pnpm exec openspec update`。

## 部署 / 运维

- CI/CD：[`.github/workflows/deploy-server.yml`](.github/workflows/deploy-server.yml)
- DB 升级 / 迁移历史：[`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md)
- 服务器、SSH、PM2、SSL 等敏感信息**不在仓库内**，问 owner 或看私密文档。
