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

## 架构决策记录（ADR）

非 trivial 的重构、schema 变更、新架构模式落地后，写一份短 ADR：`docs/adr/NNNN-<slug>.md`，结构 **Context / Decision / Consequences**。这是本项目的主要决策档案。

## OpenSpec（可选）

仓库装了 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 用于 spec-driven 开发，规范在 `openspec/`。当前实践是**跳过 `/opsx:propose`**（太重），需要时直接用 `/opsx:apply` / `/opsx:archive`。

`.claude/commands/opsx/` 和 `.claude/skills/openspec-*/` 由 `openspec init` 生成，**不要手改**。需要升级跑 `pnpm exec openspec update`。

## 部署 / 运维

- CI/CD：[`.github/workflows/deploy-server.yml`](.github/workflows/deploy-server.yml)
- DB 升级 / 迁移历史：[`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md)
- 服务器、SSH、PM2、SSL 等敏感信息**不在仓库内**，问 owner 或看私密文档。
