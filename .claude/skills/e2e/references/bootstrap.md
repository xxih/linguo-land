# E2E 基建初始化（首次给 app 装 e2e）

按 app 装 L1 / L2 / L3。**L1 必装**（验证模式底座），L2 / L3 按需。

## 前置：选要装的 app

| app | E2E 模式 | 特殊事项 |
|---|---|---|
| `apps/docs` | 普通 web app | 按本 doc 主流程走 |
| `apps/extension` | Chrome MV3 扩展 | 必须 persistent context + `--load-extension`，看 [chrome-extension.md](chrome-extension.md) 后再回来照搬本 doc 的目录 / config 模板 |
| `apps/server` | **不在本 skill** | 后端 E2E 用 supertest + Jest（`*.e2e-spec.ts`） |

下面假设 `<app>` = `docs`（extension 自己额外读 chrome-extension.md）。

## L1 · 验证模式底座（必装）

### Step 1 · 装 playwright

```bash
cd apps/<app>
pnpm add -D @playwright/test
pnpm exec playwright install chromium
```

注：playwright-cli 是独立的 global tool，不需要 per-app 装；不在 PATH 时 `pnpm dlx @playwright/cli` 也可。

### Step 2 · 创建目录骨架

```bash
mkdir -p apps/<app>/tests/.auth apps/<app>/tests/.runs apps/<app>/tests/e2e/.fragile
```

### Step 3 · 首次采集登录态

LinguoLand 后端走 JWT，token 存 cookie / localStorage（看具体实现）。手动采一次：

```bash
# 1. 启动后端 + 前端 dev server
pnpm dev:docs &              # 或对应 app 的命令

# 2. 注册一个测试账号（直接打后端 API，避开 UI）
curl -X POST http://localhost:3000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"e2e-dev@linguo.land","password":"<password>"}'

# 3. 用 playwright-cli 走一次登录把 storageState 落盘
playwright-cli -s=auth-setup open --headed
playwright-cli -s=auth-setup goto http://localhost:3001/<login-route>
# 手动在浏览器里登录 e2e-dev@linguo.land
playwright-cli -s=auth-setup state-save apps/<app>/tests/.auth/dev.json
playwright-cli -s=auth-setup close
```

把账号信息记到 `apps/<app>/tests/SCENARIOS.md` 的「公共默认」段，**不要把密码进 git**。密码放本地 `.env.e2e`（gitignored）或团队私密文档。

### Step 4 · 写 SCENARIOS.md

最小骨架：

```markdown
# E2E Scenarios

本文档登记本 app 的命名外部资源（账号 / 测试页面 / 测试数据）。所有内容非敏感；
真正的 token / cookies 在 `tests/.auth/<alias>.json` 里，已 gitignored。

## 公共默认

- BASE_URL: http://localhost:3001
- 推荐 alias: dev（日常用）
- 测试账号: e2e-dev@linguo.land（密码看私密文档）

## 场景清单

### <scenario-name>

<一句话描述>

- 测试页面: <url>
- 期待行为: <...>
```

### Step 5 · 写 .gitignore

`apps/<app>/tests/.gitignore`（新建）：

```
# auth — 整目录屏蔽（symlink 和真目录两种形态都要 cover）
.auth
.auth/

# run 产物 — 仅 findings.md 进 git
.runs/**/*.png
.runs/**/*.jpg
.runs/**/*.jpeg
.runs/**/*.webm
.runs/**/*.mp4
.runs/**/*.zip
.runs/**/*.har
.runs/**/*.html
.runs/**/snapshots/
.runs/**/trace/
.runs/_adhoc/
```

根 `.gitignore` 顺手补：

```
# playwright-cli 沙盒 / 截图缓存
.playwright-cli/
playwright-report/
test-results/
```

到这里 L1 装完，可以按 [verify.md](verify.md) 跑 AI 驱动验证流程。

---

## L2 · 测试模式（写 spec.ts 跑 runner）

### Step 1 · `playwright.config.ts`

`apps/<app>/playwright.config.ts`：

```ts
import { defineConfig, devices } from '@playwright/test';

const RUN_DIR = process.env.RUN_DIR || 'tests/.runs/_adhoc';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: ['**/.fragile/**'],         // 脆弱 spec 只手动复跑，不进默认套件
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: `${RUN_DIR}/report` }],
  ],
  outputDir: `${RUN_DIR}/result`,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    storageState: process.env.AUTH_ALIAS
      ? `tests/.auth/${process.env.AUTH_ALIAS}.json`
      : undefined,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.CI ? undefined : {
    command: 'pnpm dev',                  // 或具体 dev 命令
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
```

### Step 2 · package.json scripts

```json
{
  "scripts": {
    "test:e2e": "AUTH_ALIAS=dev playwright test",
    "test:e2e:headed": "AUTH_ALIAS=dev playwright test --headed",
    "test:e2e:ui": "AUTH_ALIAS=dev playwright test --ui",
    "test:e2e:report": "playwright show-report tests/.runs/_adhoc/report"
  }
}
```

### Step 3 · 共享 fixture（可选，case 多了再加）

`apps/<app>/tests/e2e/_fixtures/initialize-page.ts`：

```ts
import type { BrowserContext, Page } from '@playwright/test';

export async function initializeTestPage(page: Page, _context: BrowserContext): Promise<boolean> {
  try {
    await page.goto('');
    await page.waitForLoadState('domcontentloaded', { timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    return true;
  } catch (e) {
    console.error('[e2e] initializeTestPage 失败:', e);
    return false;
  }
}
```

`apps/<app>/tests/e2e/base-test.ts`：

```ts
import { expect, test as base } from '@playwright/test';
import { initializeTestPage } from './_fixtures/initialize-page';

export const test = base.extend({
  page: async ({ page, context }, use) => {
    const ok = await initializeTestPage(page, context);
    if (!ok) test.skip(true, '页面初始化失败');
    await use(page);
  },
});

export { expect };
```

spec 里：

```ts
import { test, expect } from '../base-test';
// 业务断言
```

下划线前缀 `_fixtures/` 避免被 `testMatch` 当成 spec 跑。

---

## L3 · CI 集成（写到 GitHub Actions）

### Step 1 · 决定 CI 怎么拿登录态

两种方案：

- **方案 A · 跑前注册测试账号**：CI 起后端 + DB → 调注册 API 创账号 → 走登录流程拿 token → 注 cookie
- **方案 B · GitHub secret 存 storageState JSON**：把本地 `tests/.auth/dev.json` base64 后存 secret，CI 还原

A 更稳但 setup 长；B 快但 token 过期要重刷 secret。LinguoLand 默认走 **A**（后端 setup 不复杂，避免 secret 维护）。

### Step 2 · workflow 模板（参考）

`.github/workflows/e2e-<app>.yml`：

```yaml
name: e2e (<app>)
on:
  pull_request:
    paths:
      - 'apps/<app>/**'
      - 'apps/server/**'              # 后端改了也跑（A 方案依赖后端）
  workflow_dispatch:

jobs:
  e2e:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_PASSWORD: postgres }
        ports: ['5432:5432']
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install chromium --with-deps
      - run: pnpm --filter server prisma migrate deploy
      - run: pnpm --filter server start &
      - run: pnpm --filter <app> test:e2e
        env:
          BASE_URL: http://localhost:3001
          AUTH_ALIAS: ci
```

具体 secret / 数据库 URL / 启动命令按本仓库实际情况补。

### Step 3 · 上传 report artifact

```yaml
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-report-<app>
          path: apps/<app>/tests/.runs/_adhoc/report
          retention-days: 7
```

---

## 装完检查清单

```bash
# L1
test -d apps/<app>/tests/.auth                          # 目录在
test -f apps/<app>/tests/.gitignore                     # gitignore 配
grep -q '^\.auth$' apps/<app>/tests/.gitignore          # auth 屏蔽
test -f apps/<app>/tests/SCENARIOS.md                   # 场景清单

# L2
test -f apps/<app>/playwright.config.ts                 # config 在
grep -q "testIgnore.*\.fragile" apps/<app>/playwright.config.ts   # fragile 屏蔽
grep -q '"test:e2e"' apps/<app>/package.json            # script 在

# L3
test -f .github/workflows/e2e-<app>.yml                 # workflow 在
```
