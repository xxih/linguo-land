# Promote：把一份 fragile spec 升级成 CI 回归资产

E2E 测试是沉淀下来的资产。本文档教你把 [verify.md](verify.md) Step 7 默认沉淀到 `tests/e2e/.fragile/` 的脆弱 spec **升级成** `tests/e2e/<feature>/<scenario>.spec.ts` 的 robust 回归 case。

前置条件：

1. 应用已经装完 L1 + L2 基建（看 [bootstrap.md](bootstrap.md)）
2. **已经按 [verify.md](verify.md) 跑完一次完整 verify**，`tests/.runs/<run>/` 下有 `findings.md`、`snapshots/`
3. **已经按 verify.md Step 7 把这次 verify 沉淀了 fragile spec 到 `tests/e2e/.fragile/<YYYYMMDD>-<slug>.spec.ts`**（verify 的默认动作，不是可选步骤）

⚠️ **没跑过 verify 就直接写 spec 是禁止的。** 不经过 verify 就写 spec = 猜 selector + 猜交互结果，第一次跑大概率挂。verify 环节的目的不只是"确认功能正常"，更是**用 snapshot 抓到真实的 DOM 结构、role、aria-label**，这些是写 robust spec 的输入。

### 从 fragile spec 升级的入口路径

`tests/e2e/.fragile/<YYYYMMDD>-<slug>.spec.ts` 已经是可跑通的脚本骨架（snapshot refs 翻译过来 + afterEach aria dump）。升级 = 在此基础上做"**可回归化**"改造：

1. 读 `findings.md`（业务意图）+ snapshot 文件（真实 DOM）+ fragile spec
2. **Selector 清洗**（见 Step 3）
3. **断言稳化**：硬编码 delta → 参数化 / 基于状态机，不依赖跑时具体数据
4. **切 fixture**：`import { expect, test } from '@playwright/test'` → `import { test, expect } from '../../base-test'`（走项目 fixture）
5. **移位置**：`git mv tests/e2e/.fragile/<...>.spec.ts tests/e2e/<feature>/<scenario>.spec.ts`
6. 跑 `pnpm test:e2e` 全量确认不破坏现有 case 再 commit

## 何时该升级到 robust

默认 verify 完都产 fragile spec。**升级到 robust 不是默认**，要看是否值得维护这份资产：

✅ 关键业务流程（注册 / 登录 / 生词高亮 / 词库同步 / popup 主流程）
✅ 之前出过 bug 的路径（防止 regression）
✅ 改动周边代码会影响它（脆弱点保护）
✅ 有明确预期能写成断言
✅ 步骤稳定，不是探索性

**不要升级到 robust（留在 `.fragile/` 就够）**：

❌ 一次性的探索 / debug
❌ UI 还在频繁改的页面（case 维护成本 > 价值）
❌ 跨系统耦合的端到端（容易 flaky）
❌ 没有稳定预期 / 断言点
❌ 跟 vitest 单测重叠的内容

**留在 `.fragile/` 不是 "丢了"**。它 committed 进 git、可以手动复跑、改完代码还能当烟雾。只是不进 CI、不承诺 UI 重构时同步维护。

## 升级流程

### Step 1 · 在 verify session 里抓真实 selector（fragile 没做 / 想更稳时补）

fragile spec 已经把 snapshot 里的 ref 翻译过来了。常见情况**跳过本 Step**，直接从 Step 2（fixture 接入）+ Step 3（selector 清洗）开始。

真要回 verify session 抓更稳锚点时：

```bash
# 看一下当前 ref 对应的元素是什么
playwright-cli snapshot

# 抓 ref 对应元素的真实属性
playwright-cli eval "el => el.getAttribute('data-testid')" e15
playwright-cli eval "el => el.textContent" e15
playwright-cli eval "el => el.tagName" e15
playwright-cli eval "el => el.getAttribute('aria-label')" e15
```

每步记下：

- **操作**（click / fill / select / press）
- **locator 来源**（role + name / testid / label / text）
- **结束后能验证什么**（断言点 —— 元素出现、URL 变化、表单值、计数）

### Step 2 · 切 fixture + 改 import

Fragile spec 自己 inline 了 afterEach 和 goto。Robust spec 走项目 `base-test.ts`：

```ts
// 之前（fragile）
import { expect, test } from '@playwright/test';

test.describe('fragile · ...', () => {
  test.afterEach(async ({ page }, testInfo) => { /* aria dump */ });
  test('...', async ({ page }) => {
    await page.goto('http://localhost:3001/...');
    // ...
  });
});

// 之后（robust）
import { test, expect } from '../../base-test';

test.describe('<feature 中文名>', () => {
  test('<场景中文名>', async ({ page }) => {
    // base-test 已经 goto + waitForLoadState 了，直接写业务断言
    // ...
  });
});
```

### Step 3 · Selector 清洗（最关键的工作）

**locator 优先级**：`getByRole` > `getByLabel` > `getByTestId` > `getByText` > `locator(css)`

理由：role / label / testid 抗 UI 重构能力强，css selector 是最脆弱的，UI 改一下就挂。

| verify 时拿到的 | spec.ts 里写 |
|---|---|
| 按钮文本"添加" | `getByRole('button', { name: '添加' })` |
| `data-testid="word-input"` | `getByTestId('word-input')` |
| label "新词" 的输入框 | `getByLabel('新词')` |
| 链接文本"详情" | `getByRole('link', { name: '详情' })` |
| 表格行 `<tr>` 包含 "serendipity" | `page.locator('tr', { hasText: 'serendipity' })` |
| 唯一的 `.word-card` | `page.locator('.word-card')`（万不得已） |

#### 常见踩坑

1. **`getByText('X').click()` 在多处出现的文字** —— scope 到容器后再 filter：

```ts
// ❌ 顶部导航和侧栏都有"设置"，会 strict mode violation
await page.getByText('设置').click();

// ✅ scope 到 dialog
await page.getByRole('dialog').getByText('设置').click();
```

2. **MUI / Radix 组件的 accessible name 容易带空白** —— 用正则匹配：

```ts
// ❌ exact match 偶发挂
await page.getByRole('checkbox', { name: ' serendipity', exact: true }).click();

// ✅ 用 hasText 正则
await page.locator('label').filter({ hasText: /^\s*serendipity\s*$/ }).first().click();
```

3. **没录"读值"** —— snapshot 里 AI 是看 DOM 直接读的，spec 要写断言就得自己补读值 locator：

```ts
// 读 input 当前值
const value = await page.getByLabel('新词').inputValue();

// 读 select 当前选中
const text = await page.locator('[role="combobox"]').textContent();
```

### Step 4 · 常用断言模式

| 场景 | 断言 |
|---|---|
| 元素出现 | `await expect(loc).toBeVisible()` |
| 元素文本 | `await expect(loc).toHaveText('xxx')` |
| 元素文本包含 | `await expect(loc).toContainText('xxx')` |
| 元素数量 | `await expect(loc).toHaveCount(3)` |
| URL | `await expect(page).toHaveURL(/\/detail\//)` |
| 表单值 | `await expect(loc).toHaveValue('xxx')` |
| 元素不存在 | `await expect(loc).toHaveCount(0)` 或 `toBeHidden()` |
| 元素 enabled | `await expect(loc).toBeEnabled()` |
| 元素 disabled | `await expect(loc).toBeDisabled()` |
| 有 attribute | `await expect(loc).toHaveAttribute('disabled', '')` |

`expect` 默认 **auto-retry 到 timeout**（5 秒）—— **不要在断言前手动 `waitFor`**，会重复等待。

### Step 5 · 跑通 + 进 git

```bash
# 单跑这个 case 验证（headed 看一遍）
pnpm exec playwright test tests/e2e/<your-feature>/<your-scenario>.spec.ts --headed

# 通了再跑 headless
pnpm exec playwright test tests/e2e/<your-feature>/<your-scenario>.spec.ts

# 全量跑确保不破坏现有 case
pnpm test:e2e
```

通了就 commit。**case 文件本身进 git，`tests/.auth/` 仍然不进**。

## 维护：case 失败时 debug

case 跑挂了，按这个顺序查：

1. **看 trace** —— `playwright.config.ts` 里 `trace: 'retain-on-failure'` 已开。`pnpm test:e2e:report` 打开 HTML 报告，点失败 case → trace viewer，能看到每步的 DOM、network、console
2. **跑 headed** —— `pnpm exec playwright test <file> --headed` 在浏览器里看一遍
3. **跑 ui mode** —— `pnpm test:e2e:ui` 时间旅行调试，能在任意步骤暂停看页面状态
4. **拆回 verify** —— 把 case 步骤抄到 playwright-cli session 里一步步重放，每步 snapshot 看 selector 还在不在
5. **看是不是登录态过期** —— 重新采集 `tests/.auth/dev.json`

常见挂法：

| 现象 | 修法 |
|---|---|
| selector 找不到（`Locator not found`） | UI 改了，回 verify session 用 snapshot 找新 selector |
| 元素时机不对（`not visible`） | 加 `await expect(...).toBeVisible()` 等元素而不是 `sleep` |
| 登录态过期（跳到登录页） | 删 `tests/.auth/<alias>.json` 重新采 |
| 后端数据污染（上次 case 留下脏数据） | 加 `test.beforeEach` 清理，或用更隔离的 test data，或每个 case 用唯一 ID 命名 |
| 偶发 flaky | **不要**加 `retries`，先找根因 —— 多数是 selector 不稳定或时序假设错 |

## 跟 验证 模式的边界

写完 robust case 后，**还是可以用 verify 模式**做新改动的 dev verification —— 两种模式不互斥。日常 workflow：

1. 改代码
2. 跑 verify（[verify.md](verify.md)） → 结束时默认沉淀 fragile spec 到 `tests/e2e/.fragile/`
3. 看是否值得升级到 robust（按本文档「何时该升级到 robust」判断）
4. 值得 → 按本文档流程 mv + 清洗，跑 `pnpm test:e2e` 确保不破坏现有 case，commit
5. 不值得 → fragile spec 就留在 `.fragile/`；改完代码要烟雾可以 `pnpm exec playwright test tests/e2e/.fragile/<...>` 手动复跑

**三个落点的定位**：
- **verify**（`tests/.runs/<run>/findings.md` + `snapshots/`）：开发中实时反馈、证据存档
- **fragile spec**（`tests/e2e/.fragile/<YYYYMMDD>-<slug>.spec.ts`）：同账号 / 同条件下的手动复跑锚点，改完代码的廉价烟雾
- **robust spec**（`tests/e2e/<feature>/<scenario>.spec.ts`）：已完成功能的长期保护网，UI 重构时同步维护，CI 上跑

一个改动可能既需要 verify（确认刚改完时是对的）又需要 robust spec（确保半年后改其他东西不会破坏它）。fragile spec 是中间的廉价档位 —— 低维护成本，中等回归价值，永远值得留。
