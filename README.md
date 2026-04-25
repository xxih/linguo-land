# LinguoLand

一个让你边浏览网页边背单词的 Chrome 扩展。把页面上不熟的单词标出来，一键查询；以词族为单位记录学习进度。

## 技术栈

- `apps/extension` —— Chrome MV3 扩展（TypeScript + Vite + Tailwind v4 + shadcn）
- `apps/server` —— NestJS + Prisma + Postgres（部署到阿里云 ECS）
- `apps/docs` —— Docusaurus 用户文档站
- `packages/shared-types` —— 跨应用共享的 TS 类型

## 前置依赖

- Node 22
- pnpm 10（通过 `corepack` 启用）
- Postgres 14+ —— 见下方 DB 选项

## 启动

```bash
pnpm install
cp apps/server/.env.example apps/server/.env   # 然后填好 JWT secrets、DATABASE_URL
(cd apps/server && pnpm exec prisma migrate deploy && pnpm exec prisma generate)
pnpm dev
```

`apps/server/.env` 必填项：
- `DATABASE_URL`
- `JWT_SECRET`、`JWT_REFRESH_SECRET` —— 缺这俩 server 拒绝启动（用 `openssl rand -base64 48` 生成）
- `CORS_ORIGINS`（可选，逗号分隔；`chrome-extension://*` 和 dev 下的 `localhost` 自动放行）
- `DASHSCOPE_API_KEY`（AI 字典回退用）

## DB 选项

**方案 A —— Homebrew 原生 Postgres**（macOS 开发机推荐）：
```bash
brew install postgresql@16
brew services start postgresql@16
createdb lang_lang_land
# DATABASE_URL=postgresql://$USER@localhost:5432/lang_lang_land
```

**方案 B —— Docker Compose**（机器装不了 native Postgres 时用，比如公司锁定的环境）：
```bash
docker-compose up -d
# DATABASE_URL=postgresql://postgres:password@localhost:5433/lang_lang_land
```

## 常用命令

- `pnpm exec prisma studio`（在 `apps/server` 下跑）—— DB 浏览器
- AI 协作规则与项目惯例：[`CLAUDE.md`](./CLAUDE.md)
- DB 迁移历史：[`DEPLOYMENT_GUIDE.md`](./DEPLOYMENT_GUIDE.md)
- 架构决策记录：[`docs/adr/`](./docs/adr/)
