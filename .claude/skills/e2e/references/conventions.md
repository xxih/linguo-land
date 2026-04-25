# e2e 约定（词汇 / 场景 / run 产物）

一份 skill 内共享约定的单一真源。覆盖：

- [词汇表](#词汇表)：动词 / 名词 / 命名规则
- [`tests/SCENARIOS.md`](#testsscenariosmd--场景清单)：命名外部资源（账号 / 测试页面 / 词库 ...）的引用清单
- [`tests/.runs/`](#testsruns--run-产物)：一次 run 的产物目录、findings.md 模板、gitignore 策略

所有路径都默认 per-app 落在 `apps/<app>/tests/...`（`<app>` = `docs` 或 `extension`）。

---

## 词汇表

skill 里所有概念用这份词典里的词，不用同义词漂移。

### 动词（AI / 人做什么）

#### 意图动词（run 的目标）

| 动词 | 精确含义 | 产物落点 |
|---|---|---|
| **verify** | 对一组 **claim** 做逐条确认。claim 可以是需求直给的验收项、bug 修复的行为、AI 先把模糊需求翻译出来的 checklist；**有 checklist / charter 就是 verify**，不管是需求给的还是 AI 自列的 | `tests/.runs/<run>/` |
| **repro** | 复现一个已知 bug 的 n 步路径 | `tests/.runs/<run>/` |
| **test** | 跑提交进 git 的 `*.spec.ts` 做回归 | `tests/.runs/<run>/` |

#### 基建动词（不产 run）

| 动词 | 精确含义 |
|---|---|
| **bootstrap** | 首次给 app 铺 e2e 基建（L1 / L2 / L3） |

#### 关于 "explore" / exploratory

**"exploratory" 是执行风格，不是意图**。原教旨里 exploratory 不等于无目标 —— 每个 session 都有明确 charter，exploratory 的定义是**"runtime 边走边决定下一步"**，跟有没有 checklist **正交**。

在本 skill 里：
- **AI 驱浏览器 = exploratory 风格**（恒等，不需要标注）
- **spec.ts 跑 = scripted 风格**（恒等）
- 因此不再把 `explore` 作**独立意图动词**。有 checklist / charter 的一律 **verify**

**`explore` 作 session alias 名仍可用**（例 `-s=explore`、slug `<feature>-explore`），它只是在命名层表达"此 run 无具体 claim"，不改变它内部走 verify 流程。

### 名词（产生了什么）

| 名词 | 含义 |
|---|---|
| **run** | 一次 `verify` / `repro` / `test` 的执行单位。每次 run 对应 `tests/.runs/<yyyymmdd>-<slug>/` 一个子目录 |
| **findings.md** | 每次 run 必产一份，含 "目标 / 发现 / 结论" 三段。唯一 committed 进 git 的 run 产物 |
| **snapshots** | playwright-cli 抓的 DOM markdown。`tests/.runs/<run>/snapshots/`，gitignored |
| **screenshots** | `*.png`。gitignored |
| **result** | playwright `outputDir` 产的失败 trace / video / screenshot。`tests/.runs/<run>/result/`，gitignored |
| **report** | playwright HTML reporter 产物。`tests/.runs/<run>/report/`，gitignored |
| **spec** | `tests/e2e/**/*.spec.ts`，committed 的 robust 回归测试（进 CI）|
| **fragile spec** | `tests/e2e/.fragile/<yyyymmdd>-<slug>.spec.ts`，verify 默认沉淀物，committed 但 testIgnore 不进 CI。同账号 + 同条件下可手动复跑，改完代码的廉价烟雾；满足 [promote-to-test.md 何时该升级到 robust](promote-to-test.md#何时该升级到-robust) 时升级到 `tests/e2e/<feature>/` |
| **scenario** | `tests/SCENARIOS.md` 里的一节。一个场景 = 一组命名外部资源（账号 / 测试页面 / 词库片段 / ...）的引用 |
| **POM** (Page Object Model) | `tests/e2e/pages/*.ts`，跨 spec 复用的页面抽象 |
| **helper** | `tests/e2e/helpers/*.ts`，跨 spec 小工具 |
| **auth** | 登录态持久化，落在 `tests/.auth/<alias>.json`。API 层 playwright 叫 `storageState`，同一样东西 |
| **alias** | 多账号键，`AUTH_ALIAS=test-user` 里的 `test-user`。`<alias>.json` 用它 |

### 命名约定

- **run 目录名**：`<yyyymmdd>-<slug>`。例：`20260425-highlight-verify` / `20260425-popup-explore`
- **scenario 名**：小写 + 短横线，例 `highlight-on-news-site` / `popup-login-flow`
- **alias 名**：用户告诉的语义名（`dev` / `test-user` / `admin`），不要猜
- **spec 文件**（robust / 进 CI）：`tests/e2e/<功能路径>/<主题>.spec.ts`，不要按需求命名（需求在 findings.md 里 back-link）
- **fragile spec 文件**：`tests/e2e/.fragile/<yyyymmdd>-<slug>.spec.ts`，日期前缀 + slug 跟 run 目录保持呼应

---

## `tests/SCENARIOS.md` — 场景清单

AI 做 `verify` / spec 做 `test` 之前，都需要知道**操作哪个账号 / 测试页面 / 测试词条**。这些**命名外部资源的引用清单**统一写在 app 的 `tests/SCENARIOS.md`，AI 直接读 md、不要硬编码、不要每次问用户。

### 文件布局

```
apps/<app>/tests/SCENARIOS.md         # 项目共性，非敏感，committed
apps/<app>/tests/.auth/<alias>.json   # 登录态 JSON（cookies/token），gitignored
```

不拆 per-alias scenarios。账号名 / 测试页面 URL 这些非敏感，没必要拆文件。真正敏感的是 cookies / token，它们本来就落在 `<alias>.json`（被 gitignore）。

### SCENARIOS.md 结构

```markdown
# E2E Scenarios

（开头一段讲文件用途 + "所有内容非敏感，token/cookies 在 .auth/ 里已 gitignored"）

## 公共默认

- BASE_URL: http://localhost:3001
- 推荐 alias: dev（日常用）
- 测试账号注册流程：参考 [bootstrap.md](../../../.claude/skills/e2e/references/bootstrap.md#step-3--首次采集登录态)

## 场景清单

### highlight-on-news-site

验证扩展在英文新闻页注入 content script 并高亮生词。

- 测试页面: https://www.bbc.com/news
- 词库片段: `serendipity`, `ephemeral`, `ubiquitous`（已加入 dev 账号）
- 期待行为: 三个词被高亮成 `<linguo-mark>`
```

### scenario 命名

- 小写 + 短横线：`highlight-on-news-site` / `popup-add-word` / `auth-register-flow`
- 跟 `tests/.runs/<run>/` 的 run 名做呼应（run 可以是 `20260425-highlight-verify`，scenario 是 `highlight-on-news-site`）
- 不带日期 —— 这是**场景**（长期有效的业务场景），不是 run（一次性事件）

### AI 使用协议

**每次 verify 前必读 `tests/SCENARIOS.md`**：

1. 在"场景清单"下找到对应 scenario（找不到就问用户**要不要新建一节 + 补什么字段**）
2. 把该 scenario 的字段直接拿去用
3. 发现 scenario 描述跟实际不一致，**主动改 SCENARIOS.md** 再继续

### 什么时候追加 scenario

- 做一个新需求要 verify，现有场景覆盖不到
- 同一业务的不同配置组合需要独立命名

---

## `tests/.runs/` — run 产物

AI `verify` / `repro` 和 spec `test` 每次执行都叫一次 **run**，产物统一落 `tests/.runs/<run>/`。

### 目录结构

```
apps/<app>/tests/.runs/
├── 20260425-highlight-verify/
│   ├── findings.md          ★ 必产，committed（唯一进 git 的 run 产物）
│   ├── snapshots/           gitignored（DOM markdown 快照）
│   ├── screenshots/         gitignored
│   ├── result/              gitignored（playwright outputDir）
│   └── report/              gitignored（playwright html reporter）
├── 20260425-popup-explore/
│   └── findings.md
└── _adhoc/                  默认 RUN_DIR，整屏蔽
    ├── result/
    └── report/
```

### 命名

```
<yyyymmdd>-<slug>
```

- `yyyymmdd`：run 开始日期
- `<slug>`：简短描述，小写短横线。含意图动词时用 `verify` / `repro`；无具体 claim 的宽 charter run 可写 `explore` / `sweep` / `smoke`

示例：
- `20260425-highlight-verify` —— 对生词高亮做的一次 verify
- `20260425-popup-explore` —— 无具体 claim 的 popup UI 探索
- `20260425-login-flow-repro` —— 复现某登录 bug

### findings.md 模板

每次 run 必产一份。AI 在 run 开始前创建骨架，边跑边填：

```markdown
# <run 名称跟目录一致>

## 目标
<这次 run 想验 / 探 / 复现什么>
<一句话说清楚"跑完这次要回答的问题是什么"。没有明确问题 → 不要跑 run>

## 发现
- 问题 1：<现象> — 证据：<snapshots/xxx.md 行号 / screenshots/yyy.png>
- 问题 2：<...>
- 通过项：<没问题的地方也列出来，方便下次缩小怀疑面>

## 结论
- <要不要开 issue、沉淀 spec、还是直接丢>
- <下一步要做什么；有后续 run 的写 run 名 back-link>
```

`## 目标` 对应 charter、`## 发现` 对应 observations / defects、`## 结论` 是 debrief。**不要拆成三份文件** —— 一次 run 就一份 md。

### gitignore 策略（`apps/<app>/tests/.gitignore`）

按**扩展名**屏蔽二进制 / runner 产物，放行 `*.md`：

```
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

# auth — 整目录屏蔽（symlink 和真目录两种形态都要 cover）
.auth
.auth/
```

**为什么不用 `.runs/*` + `!findings.md` 这种负向 pattern**：git 负向要求逐级 un-ignore（父目录先 un-ignore 才能 un-ignore 子文件），模式很脆易出错。按扩展名正向屏蔽更直观。

### playwright runner 如何落盘到命名 run

`playwright.config.ts` 读 `RUN_DIR` env：

```ts
const RUN_DIR = process.env.RUN_DIR || 'tests/.runs/_adhoc';
export default defineConfig({
  reporter: [['list'], ['html', { open: 'never', outputFolder: `${RUN_DIR}/report` }]],
  outputDir: `${RUN_DIR}/result`,
  // ...
});
```

命名 run 跑法：

```bash
RUN_DIR=tests/.runs/20260425-my-run pnpm test:e2e
```

不设默认 `_adhoc`，整目录屏蔽，不污染仓库。

### playwright-cli（AI verify / repro）如何落盘

playwright-cli 的 `snapshot` / `screenshot` 命令默认产物放在当前工作目录或沙盒允许路径。AI 在 run 开始时**先 `mkdir -p tests/.runs/<run>/{snapshots,screenshots}`**，然后 snapshot 时显式 `--filename=tests/.runs/<run>/snapshots/<name>.md`。

禁止把 snapshot / screenshot 扔到项目根或 `~/`—— 根目录污染，home 又出沙盒。

### AI 流程（新 run）

1. **定 run 名**：`<yyyymmdd>-<slug>`。想清楚这次"要回答什么"
2. **建目录**：`mkdir -p apps/<app>/tests/.runs/<run>/{snapshots,screenshots}`
3. **起 findings.md 骨架**：只填 `## 目标`，剩下空着
4. **读 SCENARIOS.md**：拿到账号 / 测试页面等资源
5. **跑 playwright-cli**：带 `-s=<alias>`，snapshot 落进 `tests/.runs/<run>/snapshots/`
6. **边跑边填 findings.md 的 `## 发现`**
7. **结束时补 `## 结论`**：要开 issue / 沉淀 spec / 丢 的决定
8. **commit**：只 add `findings.md`（其他按 gitignore 自动过滤）
