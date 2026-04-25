# ADR 0003 — 删除 UserVocabulary 旧表

**状态：** 已接受 — 2026-04-25

## 背景

`UserVocabulary` 是最早的"用户单词表" —— string 类型的 `userId`（历史包袱）、保留单词的表面形式、没有词族概念。词族功能上线后（`migrations/20251011174252_add_word_families`）它就被 `UserFamilyStatus` 替代了，但当时为了"迁移安全"把旧表保留了下来。

时间一长两张表已经飘开了。新写入（状态更新、预设词库添加、词族级追踪）只走 `UserFamilyStatus`。但还有三处仍在碰旧表：

- `VocabularyService.updateWordEncounter` —— 只在 controller 里被一段已经注释掉的代码调用，是死代码
- `VocabularyService.seedSampleData` —— 只用于 dev `POST /seed` 的样例数据
- `VocabularyService.getVocabularySources` —— `GET /sources` 用它返回导入来源列表，但查的是错的表（新的 `importSource` 字段在 `UserFamilyStatus` 上）

产品现在没有用户，没什么"迁移安全"需要保留。

## 决策

把 `UserVocabulary` 表和所有引用一次性删掉：

- `prisma/schema.prisma` —— 删掉 model 和遗留区段头注释
- `prisma/migrations/20260425170000_drop_user_vocabulary/migration.sql` —— `DROP TABLE IF EXISTS "user_vocabulary"`
- `vocabulary.service.ts`：
  - 删掉 `updateWordEncounter`（死代码）
  - 删掉 `seedSampleData`（dev 专用，`POST /add-preset/<key>` 完全覆盖这个用途）
  - 重写 `getVocabularySources` 改查 `UserFamilyStatus.importSource`（这才是该字段当前的位置）
- `vocabulary.controller.ts` —— 删掉 `POST /seed` endpoint 和那段注释掉的 encounter 追踪代码

## 影响

- 用户词汇状态从此只有一个真值源，不会再有双写飘移的风险。
- dev 时初始化数据走 `POST /add-preset/cet_4_6`（或别的 preset key），不再有 `/seed` 这条快捷路径。
- `user_vocabulary_userId_importSource_idx` 索引随表一起没了 —— 反正 `user_family_status_userId_importSource_idx` 已经覆盖。
- 任何还在跑旧 schema 的 DB 都需要 apply 新 migration：本地 `prisma migrate dev`，线上走部署流水线。
