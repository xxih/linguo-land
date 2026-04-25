# Chrome 扩展（apps/extension）E2E 特殊事项

LinguoLand 扩展是 MV3 + WXT 构建。**普通 web app 的 e2e 流程不能直接套**，必须走 persistent context + `--load-extension`。本 doc 列扩展专属的事项；通用的 verify / test 流程仍然走 [verify.md](verify.md) / [promote-to-test.md](promote-to-test.md)。

## 必读：扩展跟普通 web app 的差异

| 维度 | 普通 web app | Chrome 扩展 |
|---|---|---|
| **浏览器启动** | `chromium.launch()` / `playwright-cli open` | `chromium.launchPersistentContext()` / `playwright-cli open --persistent --browser=chrome` + `--load-extension` |
| **headless** | 支持 | MV3 在 headless 下加载受限；建议 `--headless=new` 或 headed |
| **storageState** | cookies / localStorage 走 web context | 扩展自己 storage 走 `chrome.storage.local`，跟 storageState **不互通** |
| **入口 URL** | dev server URL | `chrome-extension://<id>/popup.html` 等内部页 |
| **service worker** | n/a | MV3 service worker 会休眠；调试时偶尔需要主动唤醒 |
| **content script** | n/a | 注入到第三方页面，验证时要先 goto 一个真实页面 |

## Step 0 · 先 build 出扩展产物

WXT 构建出 `apps/extension/.output/chrome-mv3/`（dev 模式）或 `apps/extension/.output/chrome-mv3-prod/`（release 模式）。e2e 加载的是这个目录。

```bash
# dev 模式 build（带 source map，文件较大但定位方便）
cd apps/extension
pnpm build:dev
# 产物在 apps/extension/.output/chrome-mv3/

# release 模式（CI 用）
pnpm build
# 产物在 apps/extension/.output/chrome-mv3-prod/
```

dev 模式的 WXT 自带 hot reload server（默认端口 3010 —— 见仓库 commit `bfb8cde`），跟 e2e 同时跑要注意端口不冲突。

## Step 1 · 用 playwright-cli 加载扩展

```bash
EXT_DIR="$(pwd)/apps/extension/.output/chrome-mv3"

# persistent profile 必须用真实 chrome 通道（chromium 不行，缺扩展 API）
playwright-cli -s=ext-verify open \
  --browser=chrome \
  --persistent \
  --headed \
  --args="--disable-extensions-except=$EXT_DIR" \
  --args="--load-extension=$EXT_DIR"
```

> ⚠️ playwright-cli 不一定支持 `--args` 透传；如果命令报错，落到 spec.ts 用 `chromium.launchPersistentContext({ args: [...] })` 写测试（见 Step 4 模板）。**这条限制时不时变化，先 `playwright-cli open --help` 确认当前版本支持哪些参数**。

## Step 2 · 拿到扩展 ID

每次 build 出来的 ID 不同（除非配了 `key`）。从已加载扩展拿到：

```bash
# spec.ts 里
const [worker] = context.serviceWorkers();
const extensionId = worker.url().split('/')[2];
// chrome-extension://abcdef.../service-worker.js → abcdef...

# 或主动等 service worker
const sw = await context.waitForEvent('serviceworker');
const extensionId = sw.url().split('/')[2];
```

playwright-cli 里没法直接拿 service workers，但可以用 `eval` 间接拿：

```bash
# 先 goto 一个会被 content script 注入的页面
playwright-cli goto https://example.com
# 检查注入的扩展资源 URL（如果 content script 有 inject CSS）
playwright-cli eval "() => Array.from(document.querySelectorAll('link[href^=chrome-extension]')).map(l => l.href)"
```

或者用 `chrome://extensions` 这条路（要先开 Developer mode）：

```bash
playwright-cli goto chrome://extensions
playwright-cli snapshot                # 找到扩展卡片，里面写了 ID
```

## Step 3 · 各类页面的访问方式

```bash
EXT_ID=<上一步拿到的 ID>

# popup（点扩展图标弹的）—— playwright 不能模拟点工具栏图标，直接 goto popup URL
playwright-cli goto chrome-extension://$EXT_ID/popup.html

# options page
playwright-cli goto chrome-extension://$EXT_ID/options.html

# content script —— goto 真实英文页验证注入
playwright-cli goto https://www.bbc.com/news
playwright-cli snapshot                # 看 <linguo-mark> 有没有被注入
```

## Step 4 · spec.ts 模板（推荐）

```ts
// apps/extension/tests/e2e/_fixtures/extension.ts
import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'path';

const EXT_DIR = path.resolve(__dirname, '../../../.output/chrome-mv3');

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
}>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,           // MV3 在 headless 下加载受限
      args: [
        `--disable-extensions-except=${EXT_DIR}`,
        `--load-extension=${EXT_DIR}`,
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const extensionId = worker.url().split('/')[2];
    await use(extensionId);
  },
});

export const expect = test.expect;
```

```ts
// apps/extension/tests/e2e/popup/login.spec.ts
import { test, expect } from '../_fixtures/extension';

test('popup 登录 → 能看到主界面', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  await page.getByPlaceholder(/邮箱/).fill('e2e-dev@linguo.land');
  await page.getByPlaceholder(/密码/).fill(process.env.E2E_PASSWORD!);
  await page.getByRole('button', { name: /登录/ }).click();

  await expect(page.getByRole('heading', { name: /我的词库/ })).toBeVisible();
});
```

`E2E_PASSWORD` 走环境变量，不进 git。

## Step 5 · service worker 调试

MV3 service worker 会在闲置 ~30s 后休眠，调试时常见症状：

```ts
// 看 sw 状态
const workers = context.serviceWorkers();
console.log(workers.map(w => w.url()));

// 唤醒 sw（最简单：访问任意扩展页面）
const page = await context.newPage();
await page.goto(`chrome-extension://${extensionId}/popup.html`);

// 读 sw 的 console
const sw = workers[0];
sw.on('console', msg => console.log('[sw]', msg.text()));
```

LinguoLand 的扩展 logger（`apps/extension/src/utils/logger.ts`）会写到 sw console。verify 时如果发现 sw 行为怪，先 attach 到 sw console 看日志。

## Step 6 · 跨 origin / fetch 验证

content script 在第三方页面注入，发请求会经过：

1. content script → background sw（`chrome.runtime.sendMessage`）
2. background sw → 后端（`fetch`，走 host_permissions）

verify 时：

```bash
# 在第三方页验证 content script 注入
playwright-cli goto https://www.bbc.com/news
playwright-cli network                   # 看 sw → 后端的请求

# popup 里发请求验证 token
playwright-cli goto chrome-extension://$EXT_ID/popup.html
playwright-cli click <某按钮 ref>
playwright-cli network                   # 看 fetch 是否带 Authorization header
```

注：playwright-cli 的 `network` 拿的是当前 page 的请求，**sw 发的请求要从 sw 自己的 network 拿**。在 spec.ts 里：

```ts
const sw = context.serviceWorkers()[0];
sw.on('request', req => console.log('[sw fetch]', req.url()));
```

## Step 7 · 已知坑

- **WXT dev server 端口和 e2e dev server 撞**：commit `bfb8cde` 把 WXT dev 错位到 3010 避开后端 3000。e2e 启动时如果发现 3010 被占，要么先 `pkill wxt`，要么换 `WXT_PORT`
- **MV3 不支持 `--auto-open-devtools-for-tabs`**：调试要手动 F12
- **persistent context 的 profile 目录**：每次跑都建议用临时目录（`launchPersistentContext('')` 让 playwright 自动管），否则前一次跑残留状态会污染
- **headless 加载扩展**：`--headless=new` 在某些 chrome 版本支持，但行为不一定跟 headed 完全一致。CI 上跑建议直接用 xvfb-run + headed
- **content script 注入时机**：`document_idle` 默认晚于 DOM ready，verify 时如果 snapshot 里看不到 `<linguo-mark>`，先等 1-2s 再 snapshot

## CI 上怎么跑

GitHub Actions runner 没图形界面，用 xvfb 模拟：

```yaml
- run: pnpm --filter extension build
- run: |
    sudo apt-get install -y xvfb
    xvfb-run -a pnpm --filter extension test:e2e
  env:
    E2E_PASSWORD: ${{ secrets.E2E_PASSWORD }}
```

或者用 `playwright-test --headed` 包在 xvfb 里。

## 参考

- WXT 构建产物：`apps/extension/.output/chrome-mv3/`
- 扩展 logger：`apps/extension/src/utils/logger.ts`
- WXT dev port 错位 commit：`bfb8cde`
- Playwright 官方扩展指南：https://playwright.dev/docs/chrome-extensions
