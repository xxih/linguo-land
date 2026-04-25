# 默认姿势：并行安全 baseline（所有 E2E 流程的基线规则）

**重要前提**：无法知道用户会不会同时开另一个 AI 在干同样的事。所以 **E2E 所有流程都按"可能有别人在并行"来跑**，这不是可选优化，是基线规则。

本 doc 说明这条基线背后的隔离模型、必须遵守的规则、以及具体场景的姿势。

## 三条铁律（无条件生效）

1. **永远用 `-s=<alias>`（或 `PLAYWRIGHT_CLI_SESSION`）**，不要让命令落在 `default` session
2. **永远不用 `close-all` / `kill-all`**，只用 `playwright-cli -s=<alias> close` 关自己那一个
3. **`state-save` 只在明确采集/刷新 storageState 的流程里用**，日常 verify / test 只 `state-load` 不 save

违反任何一条就可能踩到别人 AI 的浏览器、覆盖别人的 storageState、或被别人的命令干掉。

## playwright-cli 的隔离模型（底层事实）

每个 daemon 进程落在：

```
~/Library/Caches/ms-playwright/daemon/<workspace-hash>/<session>.session
```

其中 `<workspace-hash>` = 当前 `cwd` 的 hash。三层隔离各自独立：

| 维度 | 隔离粒度 | 隔离内容 |
|---|---|---|
| **workspace hash** | cwd 变，hash 变 | daemon 目录、socket 前缀、session 文件 |
| **session name** (`-s=<name>`) | 同 workspace 内 | 独立 Chrome 进程、独立 cookies / localStorage / IndexedDB / cache / tabs |
| **CDP port** | 每个 daemon 动态分配 | 浏览器进程互不干扰 |

**含义**：只要不同 `cwd` 或不同 `-s=<name>`，从 daemon → socket → Chrome 进程 → 浏览器上下文整条链路都是物理隔离的。

多 worktree 天然隔离（不同 cwd），**同 worktree 必须靠 `-s=<alias>` 隔离**，不能依赖"现在就我一个 AI"。

## 默认姿势模板

### verify 流程默认模板

```bash
# 1. 确定本次 session 名（语义化：verify / explore / debug / <feature-name>）
SESSION=verify-highlight
AUTH_JSON="apps/docs/tests/.auth/dev.json"

# 2. open headed session（永远带 -s=）
playwright-cli -s=$SESSION open --headed

# 3. 冷启动：有 storageState 就 load，没有就跳过
[ -f "$AUTH_JSON" ] && playwright-cli -s=$SESSION state-load "$AUTH_JSON"

# 4. goto / 业务操作
playwright-cli -s=$SESSION goto http://localhost:3001
playwright-cli -s=$SESSION snapshot

# 5. 验证完关自己这个 session（不要 close-all）
playwright-cli -s=$SESSION close
```

**替代写法**：把 `-s=$SESSION` 丢进环境变量，命令就不用每次带：

```bash
export PLAYWRIGHT_CLI_SESSION=verify-highlight
playwright-cli open --headed        # 实际跑 -s=verify-highlight
playwright-cli goto http://localhost:3001
playwright-cli close
```

环境变量方式推荐在 shell 启动脚本里设好，避免忘。

### spec.ts runner 默认模板

`pnpm test:e2e` 走 Playwright runner，runner 本身是独立进程（不经 playwright-cli daemon），但 storageState 和 dev server 还是会踩：

- 多 worktree 同时跑 e2e：手动指定不同的 `BASE_URL`（dev server 端口错开）
- storageState 预热一次后只读 —— 走 `projects[].storageState`，不要在 spec 里 `state-save`

## 场景矩阵

| 场景 | 做什么 | 为什么 |
|---|---|---|
| **默认 verify**（单 AI 自己感觉不到别人在跑）| 三条铁律完整执行 | 无法验证"当前没别人"，按并行跑就对了 |
| **多 AI × 多 worktree** | 开箱即用，cwd 隔离 | workspace hash 天然不同 |
| **多 AI × 同 worktree** | 每个 AI 不同 `-s=<alias>` | 同 workspace 共享 daemon，session 名是唯一隔离维度 |
| **单 AI 多 session A/B**（多账号对照）| `-s=variant-a` / `-s=variant-b` 并发 | 官方 pattern |
| **多实例跑 `pnpm test:e2e`** | 独立 `BASE_URL` + storageState 只读 | runner 不走 playwright-cli daemon，但 auth 文件和 dev server 端口会冲 |

## storageState 写 race 的处置

`state-save` 不是原子写（普通 `writeFile`）。多 AI 同时 save 到同一份 `tests/.auth/dev.json` 会互相覆盖。

**所以 `state-save` 只在这两个场景用**：

1. **首次采集**（手动登录后落盘）
2. **登录态过期后刷新**

日常 verify / test 禁止 `state-save`。新 session `state-load` 只读既够用也安全。

## 反模式（无条件禁用）

- **`close-all` / `kill-all`** —— 跨 workspace 核弹，会干掉别人的 daemon；改用 `playwright-cli -s=<alias> close`
- **命令不带 `-s=` 直接裸跑**（落在 `default` session）—— 和其他 AI / 旧 session 共享 default，page/tab 串台
- **日常流程里 `state-save`** —— 会和别人的 save race；save 只留给采集/刷新流程
- **不同 AI 共享同一个 session name** —— 等于没隔离，和不加 `-s=` 一样
- **`playwright-cli close` 不加 `-s=`** —— 关的是当前 workspace 的 default session，可能关掉别人的 browser

## 验证隔离是否生效

```bash
# 查看当前 workspace 的所有 session（只看得到本 workspace 的）
playwright-cli list

# 查看所有 daemon 进程（系统级，全 workspace）
ps -ef | grep cliDaemon | grep -v grep

# 查看各 daemon 对应的 workspace 和端口
cat ~/Library/Caches/ms-playwright/daemon/*/*.session | jq '{name, workspaceDir, cdpPort: .browser.launchOptions.cdpPort}'
```

每个 daemon 有独立的 `workspaceDir` + `cdpPort` 就说明隔离成功。
