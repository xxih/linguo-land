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

## 运维 / 部署

线上部署、发布、回滚、服务器布局、DB 位置、SSL 证书等信息 → **见 `docs/operations.md`**。

数据库迁移历史（schema 从旧版升级到当前版本） → 见 `DEPLOYMENT_GUIDE.md`。

## 相关

- 运维手册：[`docs/operations.md`](docs/operations.md)
- DB 升级指南：[`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md)
- CI/CD workflow：[`.github/workflows/deploy-server.yml`](.github/workflows/deploy-server.yml)
