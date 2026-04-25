# LinguoLand

A Chrome extension that helps you learn vocabulary while browsing the web. Underline unfamiliar words on any page, look them up with one click, track progress per word family.

## Stack

- `apps/extension` — Chrome MV3 extension (TypeScript + Vite + Tailwind v4 + shadcn)
- `apps/server` — NestJS + Prisma + Postgres (deployed to Aliyun ECS)
- `apps/docs` — Docusaurus user-facing docs
- `packages/shared-types` — TS types shared across apps

## Prerequisites

- Node 22
- pnpm 10 (via `corepack`)
- Postgres 14+ — see DB options below

## Setup

```bash
pnpm install
cp apps/server/.env.example apps/server/.env   # then edit JWT secrets, DATABASE_URL
(cd apps/server && pnpm exec prisma migrate deploy && pnpm exec prisma generate)
pnpm dev
```

Required env in `apps/server/.env`:
- `DATABASE_URL`
- `JWT_SECRET`, `JWT_REFRESH_SECRET` — server refuses to boot without these (generate via `openssl rand -base64 48`)
- `CORS_ORIGINS` (optional, comma-separated; `chrome-extension://*` and dev `localhost` are always allowed)
- `DASHSCOPE_API_KEY` (for AI dictionary fallback)

## DB options

**Option A — native Postgres via Homebrew (recommended on macOS dev machines):**
```bash
brew install postgresql@16
brew services start postgresql@16
createdb lang_lang_land
# DATABASE_URL=postgresql://$USER@localhost:5432/lang_lang_land
```

**Option B — Docker Compose** (used when native Postgres isn't an option, e.g. corp-locked machines):
```bash
docker-compose up -d
# DATABASE_URL=postgresql://postgres:password@localhost:5433/lang_lang_land
```

## Useful

- `pnpm exec prisma studio` from `apps/server` — DB browser
- AI rules and conventions: [`CLAUDE.md`](./CLAUDE.md)
- DB migration history: [`DEPLOYMENT_GUIDE.md`](./DEPLOYMENT_GUIDE.md)
- Architecture decisions: [`docs/adr/`](./docs/adr/)
