---
name: e2e
description: 用 playwright-cli 做 E2E 验证（AI 驱浏览器确认刚改的代码按预期工作）和 E2E 测试（沉淀成 *.spec.ts 跑 CI 的回归套件）的统一基建与流程。两种模式共用 tests/.auth/ storageState 底座。改完代码想浏览器看一眼对不对、写新 spec、跑 e2e、处理登录态，都用本 skill。Chrome 扩展（apps/extension）的 E2E 走 [chrome-extension.md](references/chrome-extension.md) 单独章节。
allowed-tools: Bash(playwright-cli:*) Bash(npx:*) Bash(pnpm:*) Bash(node:*) Bash(git:*) Bash(mkdir:*) Bash(lsof:*) Bash(grep:*) Bash(jq:*)
---

# E2E 基建（验证 + 测试）

LinguoLand 的 E2E 统一入口，覆盖 **E2E 验证** 和 **E2E 测试** 两种模式以及共享基建。playwright-cli 的命令语法去看 `playwright-cli` skill；本 skill 只管流程、约定、产物。

## 适用范围

- `apps/docs`（Docusaurus 文档站）—— 普通 web app，按本 skill 主流程走
- `apps/extension`（Chrome MV3 扩展）—— 必须 persistent context + `--load-extension`，走 [chrome-extension.md](references/chrome-extension.md)
- `apps/server`（NestJS 后端）—— **不在本 skill 范围**。后端 E2E 是 supertest + Jest（`*.e2e-spec.ts`），不用 playwright

## 定位：E2E 验证 vs E2E 测试

|  | E2E 验证 | E2E 测试 |
|---|---|---|
| **谁驱动** | AI 用 playwright-cli 交互式驱浏览器 | `*.spec.ts` 脚本 + playwright test runner |
| **断言** | 没有，靠 AI 看 snapshot 判断 | `expect(...).toX()` 显式断言 |
| **沉淀** | 跑完即弃 | 进 git，长期回归资产 |
| **CI** | 不进 | 跑在 CI |
| **何时用** | 开发中确认刚改的代码按预期工作 | 完成的功能 / 关键路径 / 容易回归的地方 |
| **关系** | 一次 验证 → 可选地沉淀成一条 测试 case | 来自有价值的 验证 |

**E2E 测试是沉淀下来的资产，E2E 验证是当下的判断**。不要混。

本仓库 CLAUDE.md 的「Tests only for core code, no filler」原则在 e2e 也适用：**不为覆盖率写测试**，只在以下场景沉淀 robust spec：核心业务流（登录、生词高亮、词库同步）、出过 bug 的路径、改动周边代码会影响它的脆弱点。其他默认留 fragile spec 就够。

## 决策树：你要做什么？

| 你的状况 | 去看 |
|---|---|
| 改完代码 / 修完 bug / 加完新组件，想浏览器里确认 | [verify.md](references/verify.md) |
| 把 fragile spec 升级成 CI 回归资产 / 已有 case 跑挂 debug | [promote-to-test.md](references/promote-to-test.md) |
| 第一次给 `apps/docs` 或 `apps/extension` 装 e2e 基建 / 换机器 | [bootstrap.md](references/bootstrap.md) |
| 给 Chrome 扩展（apps/extension）做 e2e —— popup / content script / service worker / 扩展 ID | [chrome-extension.md](references/chrome-extension.md) |
| 多 AI 同机 / 多 worktree 并行 / 为什么要带 `-s=<alias>` | [parallel.md](references/parallel.md) |
| 词汇（verify/run/scenario）/ 产物落点 / findings.md 模板 | [conventions.md](references/conventions.md) |

应用可以**只装 验证 模式**（L1），未来需要 测试 再补 L2。

## 三层基建（按需启用）

| 层 | 装什么 | 用途 |
|---|---|---|
| **L1** | `tests/.auth/` 目录 + 可选 `auth.setup.ts` | AI 用 playwright-cli 做验证的 storageState 底座 |
| **L2** | `tests/e2e/<feature>/<scenario>.spec.ts` + `playwright.config.ts` + 共享 fixture | 长期回归 case 跑在本地 / CI |
| **L3** | CI 工作流 + GitHub Actions secret | spec 跑在 CI 无人值守 |

L1 是必装的底座。L2 在 L1 之上加测试套件。L3 是 L2 的 CI 集成。

## 默认姿势：按"可能有别人在并行"跑

无法判断当前是否有另一个 AI / 实例在同机跑 E2E。所有流程**默认按并行安全跑**，不是可选优化，是基线规则。

**三条铁律（无条件生效）**：

1. **永远带 `-s=<alias>`** —— alias 用语义名（`verify-<feature>` / `explore` / `debug-xxx`），不允许落 `default` session
2. **禁用 `close-all` / `kill-all`** —— 跨 workspace 核弹；只用 `playwright-cli -s=<alias> close` 关自己
3. **`state-save` 只在采集/刷新 storageState 时用** —— 日常 verify / test 只 `state-load` 不 save

底层隔离模型、反模式、storageState race 详情见 [parallel.md](references/parallel.md)。

## alias 规则

所有登录态文件统一落 `tests/<app>/.auth/<alias>.json`（`<app>` = `docs` 或 `extension`）。

- `<alias>` 用语义名 —— 邮箱 / 工号别拿来当 alias，建议 `dev` / `test-user` / `admin`
- LinguoLand 自有账号体系（注册 / 登录走后端 `/auth/login`），没有外部 SSO，登录态采集就是注册个测试账号 + 走一遍登录 → `state-save`
- 每次动手前先问："这次用哪个账号？落到 `tests/<app>/.auth/<?>.json`？"

## 文件契约速查

| 文件 / 目录 | 用途 | 备注 |
|---|---|---|
| `apps/<app>/tests/.auth/` | per-app 登录态 JSON | `.auth` 整个屏蔽，不进 git |
| `apps/<app>/tests/.runs/` | run 产物（findings.md / snapshots / screenshots / report） | 仅 `findings.md` 进 git |
| `apps/<app>/tests/SCENARIOS.md` | 命名场景清单（用哪个账号 / 哪个测试页面 / 哪段词库） | 进 git |
| `apps/<app>/tests/e2e/<feature>/<scenario>.spec.ts` | robust spec，进 CI | 进 git |
| `apps/<app>/tests/e2e/.fragile/<YYYYMMDD>-<slug>.spec.ts` | 默认沉淀的 fragile spec，testIgnore 不进 CI | 进 git |
| `apps/<app>/playwright.config.ts` | runner 配置 | 见 [bootstrap.md](references/bootstrap.md) |

## 不要做的事

- **把 `<alias>.json` 提交到 git** —— `tests/.gitignore` 必须 cover `.auth/`
- **把 `state-save` 路径写到项目外** —— playwright-cli 沙盒只允许 `<cwd>` 和 `<cwd>/.playwright-cli`
- **把 验证 当 测试 用** —— 跑完即弃 ≠ 长期资产，没有断言 ≠ 回归网。值得长期回归就沉淀成 `*.spec.ts`，不是反复跑 verify
- **session expired 时单方面让用户自测** —— 先列 A/B 选项让用户挑（详见 [verify.md](references/verify.md)）
- **给 Chrome 扩展用 `chromium.launch`** —— 扩展只能 persistent context 加载，看 [chrome-extension.md](references/chrome-extension.md)

## 跟 playwright-cli skill 的关系

- 工具语法（命令矩阵、子命令、locator、snapshot 用法、storage-state 子命令） → `playwright-cli` skill
- LinguoLand 的两种 E2E 模式、alias 约定、流程决策树、Chrome 扩展集成 → 本 skill
- 经常同时加载：先看本 skill 决定流程，再用 `playwright-cli` skill 查具体命令怎么写

## verify 沉淀 spec 两档落点

|  | fragile（默认） | robust（升级） |
|---|---|---|
| 路径 | `tests/e2e/.fragile/<YYYYMMDD>-<slug>.spec.ts` | `tests/e2e/<feature>/<scenario>.spec.ts` |
| Selector | actions 里的素材照搬，硬编码账号 / 数据 | 按 [promote-to-test.md](references/promote-to-test.md) 清洗，抗 UI 重构 |
| Fixture | inline afterEach attach aria / url | 项目共享 fixture |
| CI | `testIgnore: ['**/.fragile/**']`，**不进** CI | 进 CI 当回归网 |
| 手动复跑 | `pnpm exec playwright test tests/e2e/.fragile/<...>.spec.ts` | `pnpm test:e2e` 自动覆盖 |
| 何时产出 | **每次 verify 结束都必须至少产一份 fragile** | 满足 [promote-to-test.md 何时该升级到 robust](references/promote-to-test.md#何时该升级到-robust) 时从 fragile 升级 |

**默认姿势**：verify 完 → fragile spec 一定写 → 满足 robust 判据再 mv + 清洗。fragile spec 的价值在"**同账号 + 同条件下可重复跑通**"，是改完代码的廉价回归烟雾。
