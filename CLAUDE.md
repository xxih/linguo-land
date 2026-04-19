# LinguoLand — AI 协作规则

本文件是 AI 编码助手（Claude Code 等）在本仓库工作时的规则与上下文来源。**所有规则在此处唯一维护**，不再分发到各 agent 专属配置。

## 项目概览

pnpm workspaces + Turbo 的 monorepo：

- `apps/server` — NestJS 后端，Prisma + Postgres，部署到阿里云 ECS（详见 `docs/operations.md`）
- `apps/extension` — Chrome 浏览器扩展（TypeScript + Vite + Tailwind v4 + shadcn）
- `apps/admin` — 管理后台
- `apps/docs` — Docusaurus 用户文档站
- `packages/shared-types` — 跨应用共享的 TS 类型

## 通用规则

### 样式 / 组件（前端）

1. **优先用 Tailwind 写样式**，本项目用 **Tailwind v4**。**禁止内联样式**（`style={{}}` / `style=""`）。
2. **组件用 shadcn**。需要的组件如未引入，按 shadcn 规范自行引入。

### 日志

后端应用代码的日志不受限制（NestJS logger / pino 即可）。

**扩展（apps/extension）里的日志必须使用 `apps/extension/src/utils/logger.ts` 中的 logger**，不要直接 `console.log` / `console.error`。

## Spec-driven 开发

本仓库用 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 做 spec-driven 开发。规范都落在 `openspec/` 目录：

- `openspec/specs/<capability>/spec.md` — 每个 capability 的**当前基线** spec（用户可见行为 / API contract）
- `openspec/changes/<change-name>/` — 一次 change proposal，`archive` 后合并回 specs
- `openspec/changes/archive/` — 已归档的历史 change

### 工作流

动一个 capability 时，用 slash commands：

- `/opsx:propose "描述"` — 创建 change proposal，AI 写 delta（ADDED / MODIFIED / REMOVED）
- `/opsx:apply` — 把 change 翻译成代码改动
- `/opsx:archive` — change 归档，delta 合并进主 spec

### brownfield 注意

项目是边开发边补 spec 的 brownfield 状态：**第一次碰到某个 capability 时，把「当前真实行为 + 本次新增」全部写成 `ADDED`**（因为还没有 source spec 可 MODIFY）。archive 后这块才有基线，下次才能走 MODIFIED/REMOVED。

**不要**一次性逆向生成全部 specs —— 官方反对这种做法，会产生大量无人读的"文档化实现细节"。用到哪补哪。

### 配套文件

- `.claude/commands/opsx/` 和 `.claude/skills/openspec-*/` 由 `openspec init` 生成，**不要手改**。需要升级时跑 `pnpm exec openspec update`。

## 运维 / 部署

线上部署、发布、回滚、服务器布局、DB 位置、SSL 证书等信息 → **见 `docs/operations.md`**。

数据库迁移历史（schema 从旧版升级到当前版本） → 见 `DEPLOYMENT_GUIDE.md`。

## 相关

- 运维手册：[`docs/operations.md`](docs/operations.md)
- DB 升级指南：[`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md)
- CI/CD workflow：[`.github/workflows/deploy-server.yml`](.github/workflows/deploy-server.yml)
