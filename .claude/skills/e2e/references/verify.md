# E2E 验证 流程（dev-time AI 驱浏览器 · 录制 + 默认沉淀 spec）

E2E 验证 = AI 用 playwright-cli 交互式驱浏览器，**确认刚改的代码按预期工作**，**并在结束时把这次 verify 沉淀成一份 spec**。

对比测试：没有 CI、没有断言成套，但 verify 的操作序列本身就是很好的"同账号 / 同数据下可重复跑"的烟雾测试素材。改完代码再跑一遍 spec = 快速回归，就算 selector 脆弱也值得留。

## 并行安全 baseline（必读）

所有命令**必须带 `-s=<session-name>`**（或 `export PLAYWRIGHT_CLI_SESSION=<name>`）。完整规则见 [parallel.md](parallel.md)。

日常 verify 步骤只 `state-load` 不 `state-save`；`state-save` 仅限**登录态刷新**这个合规场景。

## 何时用

- 改了一段代码，想确认浏览器里看起来对
- 修了个 bug，想 reproduce 一下确认修掉了
- 加了个新组件 / 路由 / 弹窗，想看交互是否符合设计
- 探索某个未知页面的 selector / DOM 结构，准备写 case
- 接手陌生模块 / 回归前扫一圈 / 拿到新需求先摸底

## Charter：先写 findings.md 的 `## 目标`（必做）

**写不出 `## 目标` 就不要开始 run**。每次动浏览器之前，先 `mkdir -p apps/<app>/tests/.runs/<run>/{snapshots,screenshots}` 并在 `findings.md` 里写一段 `## 目标`。完整 run 产物契约见 [conventions.md](conventions.md#findingsmd-模板)。

三段式脚手架：

- **对象**：这次要看的 feature / 页面 / 模块是哪一块？
- **资源**：带哪些账号 / 测试页面 / 词库片段？直接引项目 `tests/SCENARIOS.md` 的 scenario 名 + `-s=<alias>`
- **要发现的信息**：安全？可靠性？回归？边界行为？错误处理？——写一行就够，决定 `## 发现` 你会特别盯哪一类证据

例：

```markdown
## 目标
- 对象：扩展 popup 里的"新增生词"按钮交互
- 资源：scenario `popup-add-word`，alias `dev`
- 要发现的信息：空输入 / 重复词 / 已登录但 token 过期三种边界
```

### 两种 charter 宽度（都叫 verify）

| 宽度 | 场景 | 怎么走 | run slug 建议 |
|---|---|---|---|
| **窄 charter** | 有明确 claim：需求验收项 / bug 修复行为 / AI 读需求生成的 checklist | 逐条确认，本 doc 下文流程 | `verify` / `repro` |
| **宽 charter** | 没有具体 claim：接手陌生模块 / 回归扫一圈 / 摸新需求边界 / bug 只有模糊症状 | 自定一个探索清单（可以是"试错点击主界面所有按钮"、"切到中文 + 切回英文 + 试 5 个新页面"等）| `explore` / `sweep` / `smoke` |

两种宽度都产一份 `findings.md`，格式一致。区别只在 `## 目标` 的精确度和 `## 发现` 是"逐条 claim 结果"还是"一次巡游的 observations"。

## 前置条件

1. 应用已经装了 L1 基建（看 [bootstrap.md](bootstrap.md)）
2. **AI 先去读应用的 `CLAUDE.md` / `README.md`** 拿到这几个变量：
   - dev server 启动命令（`pnpm dev:docs` / `cd apps/extension && pnpm dev`）
   - 默认 BASE_URL（docs: `http://localhost:3001`；extension: 走 `chrome-extension://<id>/popup.html` 见 [chrome-extension.md](chrome-extension.md)）

   找不到就问用户拿，并**提醒沉淀回项目文档**（避免下次重复问）
3. dev server 在跑 —— AI 用项目文档里登记的启动命令自行启动，不要让用户手动启动
4. **storageState 准备好**（如果 scenario 需要登录态）—— 没有就先按 [bootstrap.md Step 3](bootstrap.md#step-3--首次采集登录态) 采一次

## 核心姿势：四件套

本路径的思维工具是**四件套**（不是一个工具，是四个手段各司其职）：

| 手段 | 回答的问题 | 典型时机 | token 成本 |
|---|---|---|---|
| **`playwright-cli snapshot`** | 结构化状态对不对？（DOM 树、可点元素、表单值） | 每次 click/fill 后**第一反应** | 几 KB |
| **`playwright-cli screenshot --filename=X.png` + Read PNG** | 视觉行为对不对？（高亮 / loading / 盖没盖 / 字段值） | snapshot 没答上 / 怀疑视觉层 | 图片 |
| **`playwright-cli network`** | API 有没有发 / 返回啥 | click "没反应" / 怀疑后端 | 几 KB |
| **`playwright-cli console`** | 应用有没有 JS 报错 | 上面三个都正常但行为怪 | 几 KB |

**snapshot 是结构维度的完整 dump**，既用于拿 refs、也是状态判断的主要工具。其他三个在 snapshot 看不出问题时升级。

## 标准流程

### Step 1 · 开 run 目录 + session 名

```bash
APP=docs                                      # 或 extension
RUN="$(date -u +%Y%m%d)-<slug>"               # 例如 20260425-highlight-verify
RUN_DIR="apps/$APP/tests/.runs/$RUN"
mkdir -p "$RUN_DIR/snapshots" "$RUN_DIR/screenshots"

export PLAYWRIGHT_CLI_SESSION=verify-<feature>   # 或每次 -s= 带上
```

起 `findings.md` 骨架：`## 目标`（已在 Charter 步骤写好）+ 留空 `## 发现` / `## 结论`。

### Step 2 · 开 session + goto + 关初始弹窗

```bash
ALIAS=dev
AUTH_JSON="apps/$APP/tests/.auth/$ALIAS.json"

# 1. open headed session（普通 web app 不用 --persistent；扩展必须 persistent，看 chrome-extension.md）
playwright-cli open --headed

# 2. 冷启动：有文件就 load，没有就跳过
#    state-load 在文件不存在时会 ENOENT exit 1，必须 shell 层面容错
[ -f "$AUTH_JSON" ] && playwright-cli state-load "$AUTH_JSON"

# 3. load 完必须 goto 让 cookies 对服务端生效
playwright-cli goto http://localhost:3001/<your-route>

# 4. fresh load 完先 snapshot 看有没有 cookie banner / 引导弹窗等挡 UI 的东西
playwright-cli snapshot --filename="$RUN_DIR/snapshots/01-loaded.md"
# 如果有弹窗：
playwright-cli press Escape
# 或 click 关闭按钮的 ref
```

session 名建议用 `verify-<feature>` / `explore-<feature>`，方便区分。不要复用别的工作流的 session，避免污染状态。

### Step 3 · 核心节奏：snapshot → write → snapshot

**每次写操作前后跑 `snapshot`**。这是本路径的核心节奏：

```bash
playwright-cli snapshot --filename="$RUN_DIR/snapshots/02-before-add.md"  # 拿 refs + 看初态

playwright-cli click e15
playwright-cli snapshot --filename="$RUN_DIR/snapshots/03-after-add.md"   # click 生效了吗？

playwright-cli fill e23 "serendipity"
playwright-cli snapshot --filename="$RUN_DIR/snapshots/04-after-fill.md"  # 填进去了吗？错误提示？
```

**snapshot 看不到问题时**，升级到四件套的其他三件：

```bash
playwright-cli screenshot --filename="$RUN_DIR/screenshots/after-click.png"
# 然后用 Read 工具读这张图 —— 90% 视觉类问题一眼看清

playwright-cli network             # 看最近的请求
playwright-cli console             # 看应用报错
```

### Step 4 · 每步 snapshot 后扫异常（必做）

AI 读状态的默认盲区：眼睛只盯要点的按钮 / 要找的 ref，页面上醒目的报错 / toast / 控制台 error / 网络 500 都看不见。这种"看起来对的错"是 verify 最容易漏的一类 bug。

**每步写动作（click / fill / select / press）之后的 snapshot 读完、进下一步之前，按下面清单过一遍**。扫到异常在 `findings.md ## 发现` 记一条 —— **哪怕跟当前 charter 不直接相关也要记**。

#### 扫描清单

- **意外 dialog vs 业务 dialog 判断**：snapshot 里 dialog 节点是否预期靠 AI 判
- **error toast / notification**：snapshot 里 `[role="alert"]` / `.toast` 类节点
- **loading 卡住**：spinner / skeleton / "加载中" 文案超过 ~5s 还在
- **数据异常**：渲染空白 / 截断 / 重复行 / 乱码 / 数字错位 / `Invalid Date`
- **Scope 漂移**：URL / route 切到别的了，侧栏 active 不是你以为的那条
- **console error**：`playwright-cli console` 扫一下，红色 error 必记
- **网络 4xx/5xx**：`playwright-cli network` 看近期请求，业务 API 非 2xx 记一条

#### 找到异常怎么处理

- **跟当前目标相关** → 进 `findings.md ## 发现` 作为偏离项
- **跟当前目标无关但是个真 bug** → 进 `## 发现` 单独一条，前缀 "⚠️ 顺手发现"，不要吞
- **明显环境问题**（dev server 挂了 / 后端没启）→ 不算业务 bug，但 findings.md 里要记一行

### Step 5 · 用 claim 驱动，不是用 UI 流程驱动

每验一个 claim 在 findings.md `## 发现` 标记 `✅ / ❌ / ⏳`，**引证具体 snapshot / screenshot 路径**。

### Step 6 · 关 session

```bash
playwright-cli close
```

### Step 7 · 默认沉淀 spec（必做）

**每次 verify 结束必须出一份 spec**，无论你觉得 verify 多临时。原因：

- 同一账号 / 同一 scenario 下这套操作能跑通 —— 下次改完相关代码复跑一次 = 廉价回归
- 写 spec 的增量成本很低（snapshot 里都是真 selector），删掉成本很高（未来想复跑要从零重建）
- 脆弱 spec 不进 CI、不威胁主测试套件；健壮 spec 升级后进 CI 保护回归

判断**落到哪里**：

```
这份 spec 的 selector / 时序 / 断言 能经得起 UI 小重构吗？
  ├── 能（关键业务 + 稳定 selector + 明确断言）→ 走 robust 路径：tests/e2e/<feature>/<scenario>.spec.ts
  │                                               （按 promote-to-test.md 清洗 selector 后进 CI）
  └── 不能（脆弱 selector / 探索性 / UI 频繁改）→ 走 fragile 路径：tests/e2e/.fragile/<YYYYMMDD>-<slug>.spec.ts
                                                   （committed 但 testIgnore 不进 CI，手动复跑）
```

两条都是**默认动作**。没有"这次 verify 不值得沉淀"的分支 —— 至少也是 fragile，至多是 robust。

例外：本仓库 CLAUDE.md 的「Tests only for core code, no filler」原则下，**纯探索性、无任何回归价值的 verify**（比如帮用户截个图就完了）可以不沉淀，但 `findings.md ## 结论` 必须记一行"未沉淀 spec 原因：<…>"。

#### Fragile spec 模板（默认落点：`tests/e2e/.fragile/`）

脆弱 spec = snapshot 里的动作序列**几乎照搬**进 spec.ts，加一个失败时 attach aria / url / console 的 afterEach。不清洗 selector、不抽 fixture、不参数化、不抗 UI 重构。评价标准只有一个：**在当前账号 + 当前数据下，这个 spec 跑得通**。

```ts
// apps/docs/tests/e2e/.fragile/20260425-search-verify.spec.ts
import { expect, test } from '@playwright/test';

test.describe('fragile · 文档站搜索（verify 沉淀，手动复跑用）', () => {
  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus && !page.isClosed()) {
      try {
        const aria = await page.locator('body').ariaSnapshot({ timeout: 2_000 });
        await testInfo.attach('aria-snapshot.yaml', { body: aria, contentType: 'text/yaml' });
        await testInfo.attach('url.txt', { body: page.url(), contentType: 'text/plain' });
      } catch { /* 页面已关闭 / 跳转 忽略 */ }
    }
  });

  test('搜索关键字命中预期结果', async ({ page }) => {
    await page.goto('http://localhost:3001/');
    await page.getByRole('button', { name: /search/i }).click();
    await page.getByPlaceholder(/搜索/).fill('生词');
    await expect(page.getByRole('link', { name: /生词高亮/ })).toBeVisible();
  });
});
```

落点细节：

- 首字日期前缀帮快速辨识（`<YYYYMMDD>-<slug>.spec.ts`），一眼看得出这个 fragile spec 什么时候沉淀的
- 和 `tests/.runs/$RUN/` 同 slug 保持呼应，未来从 findings.md back-link 到 spec 很容易
- committed 进 git —— 下次改代码回来跑能确认仍然 pass（或发现哪里断了）

#### Fragile 目录的 CI 隔离（首次沉淀时必做）

**项目 `playwright.config.ts` 要屏蔽 `.fragile/`**，否则 `pnpm test:e2e` 会把脆弱 spec 也跑了污染 CI：

```ts
// playwright.config.ts
export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: ['**/.fragile/**'],   // ← 脆弱 spec 只手动复跑，不进默认套件
  // ...
});
```

第一次在项目里沉淀 fragile spec 时，AI 先 `grep testIgnore playwright.config.ts`：
- 已有 → 跳过
- 没有 → 改一次 config，独立 commit，再 commit fragile spec

手动跑 fragile spec：

```bash
pnpm exec playwright test tests/e2e/.fragile/20260425-search-verify.spec.ts --headed
```

#### Robust spec（升级路径 → `tests/e2e/<feature>/<scenario>.spec.ts`）

robust 不是默认。只在满足 [promote-to-test.md 何时该升级到 robust](promote-to-test.md#何时该升级到-robust) 的判据时做。具体清洗步骤见 [promote-to-test.md](promote-to-test.md)。

### Step 8 · 跑通 fragile spec + commit

沉淀完的 fragile spec 至少要**头铁跑一次确认现在能过**，否则就是 dead weight：

```bash
# 第一次 headed 确认
pnpm exec playwright test tests/e2e/.fragile/20260425-search-verify.spec.ts --headed

# 挂了：读 attach 里的 aria / url，改 selector 再跑
# 过了：commit
git add apps/<app>/tests/e2e/.fragile/20260425-search-verify.spec.ts apps/<app>/tests/.runs/$RUN/findings.md
git commit
```

`findings.md` + fragile spec 进 git。其他 run 产物（screenshots / snapshots / report）按 gitignore 自动过滤。

## 关键细节

- **`state-load` 必须在 `goto` 之前** —— load 只写 context cookies / origins，现有 page 不会自动刷新；先 load 再 goto/reload 才会把 cookies 发给服务端
- **`state-load` 文件不存在 = ENOENT exit 1** —— 脚本里必须 `[ -f ... ]` 保护，否则整条链路挂掉
- **`state-save` 覆盖旧文件** —— 无需先删，直接 save 即可
- **`state-save` / `state-load` 路径必须在 playwright-cli 沙盒 allowed roots 内** —— 只有 `<cwd>` 和 `<cwd>/.playwright-cli` 两个根。在 monorepo 根 cwd 下时 `apps/<app>/tests/.auth/<alias>.json` 是合法路径
- **每个验证开新 session** —— 不要复用别的工作流的 session
- **每步 snapshot** —— 不看直接 click 下一步等于盲操作

## 什么时候要重新登录

- `tests/.auth/<alias>.json` 不存在（首次使用 / 被清理过）
- `state-load` 后页面仍弹"未登录"或被 redirect 到 `/auth/login` —— 这是**服务端 token 过期**，本地文件还在但 token 被拒
- 后端 JWT 默认配置 7 天过期（看 `apps/server/src/auth/`），按需调整

### 登录态过期处置 —— 不要单方面让用户自测

遇到 session expired，**先给用户列两个选项**让用户挑：

- **A**：在 headed 窗口手动走一遍登录，拿到新 token 后 `state-save` 覆盖落盘，然后继续把验证链路自动跑完
- **B**：用户自己开浏览器手动验证这个改动，自动化中止

**不要一上来就 "我跑不了，请你自测一下" —— 默认是 A 才对。**

A 的手动登录流程：

```bash
# headed 窗口已经在跑，goto 触发 redirect 到登录页
playwright-cli goto http://localhost:3001/<your-route>

# 用户在窗口里完成登录（注册过的测试账号）
# 跳回应用页面后立即 save 覆盖落盘
playwright-cli state-save apps/<app>/tests/.auth/<alias>.json

# 然后继续验证流程
playwright-cli snapshot
```

## 不要做的事

- **`open --persistent` 在普通 web app 验证里用** —— 走 cache 路径的 profile，跟 `tests/.auth/` 完全脱钩。**Chrome 扩展是例外**，必须 persistent，看 [chrome-extension.md](chrome-extension.md)
- **猜 alias 名** —— 邮箱、"default"、"main" 都不行，等用户告知
- **跳过 snapshot** —— 不看直接 click 下一步等于盲操作
- **复用别人的 session 名** —— 容易污染状态
- **session 不 close** —— 验证完留着会占内存，下次开新 session 名容易混
- **命令不带 `-s=<name>`** —— 默认姿势是并行安全，裸命令落 default session 会和别人串台
- **日常 verify 步骤里跑 `state-save`** —— 只有"登录态刷新"一个点允许 save，其他步骤都是只读
- **只 snapshot 不 screenshot** —— snapshot 看不到视觉问题（CSS 高亮颜色 / loading 动画 / 遮挡），必须升级到视觉维度
- **跳过 Step 7 沉淀** —— verify 结束不产 spec 违反默认；一次性探索也必须至少留份 fragile spec，未来一定后悔今天没留
