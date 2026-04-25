# 0009 引入 .claude/skills 体系：playwright-cli + e2e

- 日期：2026-04-25
- 相关：用户在对话中提出"playwright-cli 还能让 AI 操作并 debug 吗"

## Context

之前 LinguoLand 没有任何 e2e 基建，AI 想验证扩展或 docs 站的浏览器行为只能让用户手动开浏览器看，反馈环长且容易遗漏视觉类回归。

我有另一处的 e2e + playwright-cli skill 实践（住在用户私有知识库里），但它紧耦合特定业务环境的 SSO 探针、私有组件库 selector、特定项目的 popup 清理 helper、Hash Router 处理、多账号体系、FEATURES.md audit 升级流程等，整体直接搬过来 80% 内容跟本仓库无关。

需求很清晰：**把方法论搬过来，把业务包袱剥干净**，作为 `.claude/skills/` 下的两个本地 skill 进 git。

## Decision

新增两个 Claude Code skill，落 `.claude/skills/`（committed，全仓共享）：

### `playwright-cli/`

直接照搬上游 `playwright-cli` skill —— 它本来就是工具语法手册，没有业务耦合：

- `SKILL.md`：命令矩阵、子命令、locator、snapshot 用法
- `references/`：storage-state / session-management / running-code / playwright-tests / 等 9 份子文档全量带过来

### `e2e/`

按 LinguoLand 实际形态从原 e2e skill 抽象重写。**保留**的核心方法论：

- **verify vs test 二分**：AI 驱浏览器的 verify 跟 spec.ts runner 的 test 是两件事，不要混
- **Charter / findings.md / `tests/.runs/<run>/`** 一致的 run 产物契约
- **fragile spec → robust spec** 两档落点：默认沉淀 fragile（手动复跑、不进 CI），满足判据再清洗成 robust 进 CI
- **并行安全 baseline**：永远带 `-s=<alias>`、禁用 `close-all` / `kill-all`、`state-save` 限定场景
- **alias 概念**：多账号 storageState 隔离

**剥掉**的业务包袱：

- 特定企业 SSO 探针 / `auth.setup.ts` 自动化 SSO（LinguoLand 自有 JWT，登录态采集就是注册账号 + 走一遍登录）
- 上游私有组件库 selector（本仓库走 shadcn + Radix + MUI）
- 上游项目通病弹窗的清理 helper（这里没有）
- Hash Router 处理（本仓库前端用普通路由）
- 上游项目特化的 playwright-cli 包装工具（含 observe / translate / 私有组件 DOM 探针）
- FEATURES.md / audit 体系（用于跨多个老项目升级的需求，本仓库一开始就装最新版不需要）
- 多账号 / 需求 ID / dev-port 多 worktree 协议

**新增**的 LinguoLand 特化：

- `references/chrome-extension.md`：MV3 + WXT 扩展专属事项 —— persistent context、`--load-extension`、扩展 ID 解析、popup / content script / service worker 访问、WXT dev port (3010) 错位

子文档清单：

- `SKILL.md` —— 入口决策树
- `references/verify.md` —— AI 驱浏览器 verify 流程
- `references/promote-to-test.md` —— fragile → robust 升级
- `references/bootstrap.md` —— L1 / L2 / L3 装基建
- `references/conventions.md` —— 词汇 / SCENARIOS.md / tests/.runs/ 契约
- `references/parallel.md` —— 并行安全规则
- `references/chrome-extension.md` —— 扩展专属事项

### 根 .gitignore

补 `.playwright-cli/` / `**/playwright-report/` / `**/test-results/` 三行，防止 AI 一旦开始用 playwright-cli 就在仓库里散落产物。tests/ 目录下的 per-app `.gitignore` 在 bootstrap 实际 app 时再补（本次不动任何 app）。

## Consequences

**好处**：

- AI 接到"浏览器里看一眼对不对"的需求时有标准流程，不再每次重新发明
- verify 默认沉淀 fragile spec → 改完代码至少有"同账号下能跑通"的廉价烟雾
- 扩展 e2e 不再是空白，需要时按 chrome-extension.md 装即可
- skill 跟着仓库走，不依赖用户私有知识库；`.claude/skills/` 已经被 settings.json 接管，新对话自动加载

**代价**：

- 6 份新 markdown，会增加上下文 token；按需懒加载（SKILL.md 是入口、references 按链接跳），实际单次会话只读相关章节
- skill 跟外部那份双线维护：上游后续如果有新方法论改进，需要人工 backport 到这里；不会自动同步
- bootstrap.md 的 L2 / L3 模板是参考性的，第一个真正 bootstrap 的 app（大概率是 docs）跑下来一定会暴露不准的地方，到时候再修

**遗留 / 待办**（已在记忆里，不写 backlog 因为偏 meta）：

- 等真正在 `apps/docs` 或 `apps/extension` 里 bootstrap 一次后，回来用真实经验校准 bootstrap.md / chrome-extension.md
- playwright-cli 全局命令在用户机器上是否可用、`--args` 透传是否生效，跑过一次就知道
