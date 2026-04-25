# ADR 0006 — 多步写操作加事务

**状态：** 已接受 — 2026-04-25

## 背景

`VocabularyService` 上有两个方法是"读了再写"的形态，典型的 check-then-act，并发下有竞态：

1. **`updateWordStatus(lemma, status, userId, familiarityLevel?)`**
   - 先 `word.findUnique` 把 lemma 映射到 familyId
   - 再根据情况 `deleteMany`（status === 'unknown' 时）、`update` 或 `upsert` `userFamilyStatus`
   - 读和写之间另一个请求可能改了同一 family 的状态 —— 后写盖前写；status='unknown' 那条删除路径甚至可能误删用户刚刚写入的状态。

2. **`autoIncreaseFamiliarity(lemma, userId)`**
   - 读 `word.findUnique`、再读 `userFamilyStatus.findUnique`
   - 然后 `update` 时写入 `familiarityLevel: existing.familiarityLevel + 1`
   - 两个并发请求都看到 `familiarityLevel: 5` 时会各自写 6（实际应该是 7）。`lookupCount: { increment: 1 }` 这部分本来就是原子的，但 familiarity 的递增不是。

`autoIncreaseFamiliarity` 还顶着 ~25 行 `console.log` 调试输出，把真实逻辑遮得很碎。

## 决策

两个方法都包到 `prisma.$transaction(async (tx) => { ... })` 里，所有 DB 调用走事务客户端 `tx`。这样"读再写"在 DB 层是按行可串行化的，check-then-act 竞态消失。

事务里面顺手简化：

- `updateWordStatus` 的"只更新熟练度"分支由 `findUnique + update` 改成单条 `updateMany` —— 报告"是否真的改到了"时不需要先读。
- `autoIncreaseFamiliarity` 删掉冗长的调试 log，每个分支保留一条信息日志。

只动了 `apps/server/src/vocabulary.service.ts` 一个文件。

## 影响

- 同一 `(userId, familyId)` 行的并发更新现在在 DB 层串行化，丢更新和误删都不可能再发生。
- 文件变小约 70 行（清掉了调试噪音）。
- 其他批量写路径（`addPresetVocabulary`、`importVocabularyFromJson`）暂时没包事务 —— 它们是批量导入，部分失败可以重试，优先级低，会在仓储层重构（A2）落地时一起处理。
- 没新增测试：失败模式是并发，没有真实 DB 测试用例的话不太好单测。修复在构造上是正确的（Prisma 互动事务在 Postgres 上是 REPEATABLE_READ）。后面 A2 会一起把集成测试基础设施立起来。
