# LinguoLand 数据库升级部署指南

> 本文档详细说明了如何从线上当前版本（migration: 20251015163410）升级到最新版本

## 📋 变更概览

### 1. Schema 主要变更

#### 新增功能

- **标签系统 (Tag Model)**：支持为词族打标签（如CET4、CET6、TOEFL等）
- **词汇来源追踪**：在 `UserFamilyStatus` 表中新增 `importSource` 字段，用于追踪词汇来源

#### 字段调整

- **熟练度范围扩展**：`familiarityLevel` 从 0-5 扩展到 0-7
  - 旧版默认值：5
  - 新版默认值：7
- **字段重命名**：`encounterCount` → `lookupCount`（更准确地反映"查词次数"的语义）

### 2. 详细对比

#### 2.1 WordFamily 表变更

```prisma
// 线上版本
model WordFamily {
  id         Int                  @id @default(autoincrement())
  rootWord   String               @unique
  words      Word[]
  userStatus UserFamilyStatus[]
  createdAt  DateTime             @default(now())
}

// 新版本（新增 tags 字段）
model WordFamily {
  id         Int                  @id @default(autoincrement())
  rootWord   String               @unique
  words      Word[]
  userStatus UserFamilyStatus[]
  tags       Tag[]                // ← 新增：多对多关系
  createdAt  DateTime             @default(now())
}
```

#### 2.2 UserFamilyStatus 表变更

```prisma
// 线上版本
model UserFamilyStatus {
  id               Int                     @id @default(autoincrement())
  user             User                    @relation(fields: [userId], references: [id])
  userId           Int
  family           WordFamily              @relation(fields: [familyId], references: [id])
  familyId         Int
  status           WordFamiliarityStatus   @default(KNOWN)
  familiarityLevel Int                     @default(5) @db.SmallInt  // 0-5
  encounterCount   Int                     @default(0)
  lastSeenAt       DateTime?
  createdAt        DateTime                @default(now())
  updatedAt        DateTime                @updatedAt

  @@unique([userId, familyId])
  @@index([userId])
}

// 新版本
model UserFamilyStatus {
  id               Int                     @id @default(autoincrement())
  user             User                    @relation(fields: [userId], references: [id])
  userId           Int
  family           WordFamily              @relation(fields: [familyId], references: [id])
  familyId         Int
  status           WordFamiliarityStatus   @default(KNOWN)
  familiarityLevel Int                     @default(7) @db.SmallInt  // ← 改为 0-7，默认值改为 7
  lookupCount      Int                     @default(0)               // ← 重命名：encounterCount → lookupCount
  lastSeenAt       DateTime?
  importSource     String?                 // ← 新增：词汇来源字段
  createdAt        DateTime                @default(now())
  updatedAt        DateTime                @updatedAt

  @@unique([userId, familyId])
  @@index([userId])
  @@index([userId, importSource])         // ← 新增：索引
}
```

#### 2.3 新增 Tag 表

```prisma
model Tag {
  id           Int          @id @default(autoincrement())
  key          String       @unique        // 唯一键，如 "cet4"
  name         String                      // 显示名称，如 "四级"
  description  String?                     // 标签描述
  wordFamilies WordFamily[]                // 多对多关系
  createdAt    DateTime     @default(now())

  @@map("tags")
}
```

## 🚀 部署步骤

### 前置准备

#### 1. 备份数据库

```bash
# 方案1：使用 pg_dump（推荐）
pg_dump -h <your-host> -U <your-user> -d <your-database> -F c -b -v -f "backup_$(date +%Y%m%d_%H%M%S).dump"

# 方案2：如果使用云服务（如 Supabase、Railway），使用其提供的备份功能
```

#### 2. 检查当前迁移状态

```bash
cd apps/server
npx prisma migrate status
```

预期输出应显示最后一个迁移是 `20251015163410_add_dictionary_models`

### 执行迁移

#### 步骤 1: 更新本地代码

```bash
git pull origin main  # 或相应的分支名
```

#### 步骤 2: 安装依赖

```bash
pnpm install
```

#### 步骤 3: 查看迁移历史

从基线版本 `20251015163410_add_dictionary_models` 到当前版本，共有以下迁移：

1. **20251102_add_import_source**: 添加词汇来源追踪
2. **20251103051517_add_word_tags**: 添加标签系统
3. **20251106005715_rename_encounter_count_to_lookup_count**: 字段重命名

#### 步骤 4: 检查迁移文件内容

这些迁移已经存在于代码库中，以下是完整的 SQL 变更内容：

**迁移 1: 添加 importSource 字段**

```sql
-- AlterTable
ALTER TABLE "public"."user_family_status" ADD COLUMN "importSource" TEXT;

-- CreateIndex
CREATE INDEX "user_family_status_userId_importSource_idx" ON "public"."user_family_status"("userId", "importSource");
```

**迁移 2: 添加标签系统**

```sql
-- CreateTable
CREATE TABLE "public"."tags" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable - 多对多关系表
CREATE TABLE "public"."_TagToWordFamily" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_TagToWordFamily_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "tags_key_key" ON "public"."tags"("key");

-- CreateIndex
CREATE INDEX "_TagToWordFamily_B_index" ON "public"."_TagToWordFamily"("B");

-- AddForeignKey
ALTER TABLE "public"."_TagToWordFamily" ADD CONSTRAINT "_TagToWordFamily_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_TagToWordFamily" ADD CONSTRAINT "_TagToWordFamily_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."word_families"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

**迁移 3: 字段重命名**

```sql
-- Rename encounterCount to lookupCount in user_family_status
ALTER TABLE "user_family_status" RENAME COLUMN "encounterCount" TO "lookupCount";

-- Rename encounterCount to lookupCount in user_vocabulary
ALTER TABLE "user_vocabulary" RENAME COLUMN "encounterCount" TO "lookupCount";
```

**关键注意事项**：

1. **familiarityLevel 默认值变更**：
   - 新创建的记录会使用新的默认值 7
   - **现有记录不会被自动修改**（这是为了保护用户现有数据）
   - Schema 中默认值已更新，但现有数据保持原值

2. **importSource 字段**：
   - 为可空字段，不会影响现有数据
   - 现有记录的 `importSource` 将为 `NULL`，表示手动添加

3. **字段重命名（encounterCount → lookupCount）**：
   - 这是一个 DDL 操作，会重命名列但**不影响数据**
   - 现有的计数值会完整保留
   - 应用代码需要同步更新以使用新的字段名

#### 步骤 5: 在测试环境验证

**强烈建议先在测试环境执行！**

```bash
# 方法1：使用测试数据库
# 1. 创建测试数据库的副本
# 2. 修改 .env 文件指向测试数据库
DATABASE_URL="postgresql://user:password@localhost:5432/linguo_test"

# 3. 执行迁移
npx prisma migrate deploy

# 4. 验证
npx prisma studio  # 检查表结构和数据
```

#### 步骤 6: 部署到生产环境

确保测试无误后，部署到生产环境：

```bash
# 1. 设置生产数据库连接
export DATABASE_URL="your-production-database-url"

# 2. 执行迁移（不要使用 migrate dev）
npx prisma migrate deploy

# 3. 生成 Prisma Client
npx prisma generate
```

#### 步骤 7: 导入标签数据

迁移完成后，需要为词族打标签：

```bash
# 确保 apps/server/src/data/ 目录下有标签数据文件（cet4.json, cet6.json 等）

# 执行标签导入脚本
cd apps/server
pnpm ts-node src/seed-tags.ts
```

预期输出：

```
[START] 开始为词族打标签...
  [TAG] Tag "四级" 已确认.
  [INFO] 找到 4500 个单词，关联到 3200 个唯一词族.
  [SUCCESS] 成功为 3200 个词族打上 "四级" 标签.
  ...
[COMPLETE] 所有词表处理完成！
```

### 验证部署

#### 1. 检查数据库结构

```bash
npx prisma studio
```

验证点：

- ✅ `tags` 表已创建
- ✅ `_TagToWordFamily` 表已创建（多对多关系表）
- ✅ `user_family_status` 表有 `importSource` 字段
- ✅ `user_family_status` 表的字段名为 `lookupCount`（不是 `encounterCount`）
- ✅ `user_vocabulary` 表的字段名也为 `lookupCount`
- ✅ 相关索引已创建

#### 2. 检查应用功能

```bash
# 启动服务器
cd apps/server
pnpm dev
```

测试以下功能：

- ✅ 用户登录正常
- ✅ 词汇查询显示标签信息
- ✅ 预设词库导入功能正常
- ✅ 词汇列表可以按来源筛选
- ✅ 熟练度调整功能正常（0-7 范围）

#### 3. 前端验证

```bash
# 启动扩展开发模式
cd apps/extension
pnpm dev
```

测试：

- ✅ 词汇卡片显示标签信息
- ✅ Options 页面导入功能正常
- ✅ 词汇列表筛选功能正常

## ⚠️ 回滚方案

如果部署后发现问题，可以回滚到之前的版本：

### 方案 1: 使用 Prisma 迁移回滚

```bash
# 查看迁移历史
npx prisma migrate status

# 回滚到指定迁移（需要手动操作）
# Prisma 不直接支持自动回滚，需要手动执行反向操作
```

### 方案 2: 恢复数据库备份

```bash
# 使用之前的备份文件
pg_restore -h <your-host> -U <your-user> -d <your-database> -v "backup_YYYYMMDD_HHMMSS.dump"
```

### 方案 3: 手动回滚 SQL

如果只需要回滚 schema 变更，按相反顺序执行：

```sql
-- 步骤 1: 回滚字段重命名（最后一个迁移）
ALTER TABLE "user_family_status" RENAME COLUMN "lookupCount" TO "encounterCount";
ALTER TABLE "user_vocabulary" RENAME COLUMN "lookupCount" TO "encounterCount";

-- 步骤 2: 删除标签系统
DROP TABLE IF EXISTS "_TagToWordFamily" CASCADE;
DROP TABLE IF EXISTS "tags" CASCADE;

-- 步骤 3: 删除 importSource 字段和索引
DROP INDEX IF EXISTS "user_family_status_userId_importSource_idx";
ALTER TABLE "user_family_status" DROP COLUMN IF EXISTS "importSource";

-- 步骤 4: 恢复 familiarityLevel 默认值（如果需要）
ALTER TABLE "user_family_status"
    ALTER COLUMN "familiarityLevel" SET DEFAULT 5;
```

## 📝 迁移后的数据处理

### 处理现有用户的熟练度数据

如果决定将现有用户的熟练度范围从 0-5 迁移到 0-7，可以执行以下策略：

#### 策略 1: 按比例转换（推荐）

```sql
-- 将 0-5 的范围线性映射到 0-7
UPDATE "user_family_status"
SET "familiarityLevel" = ROUND("familiarityLevel" * 7.0 / 5.0)
WHERE "familiarityLevel" <= 5;
```

映射关系：

- 0 → 0
- 1 → 1 (1.4 → 1)
- 2 → 3 (2.8 → 3)
- 3 → 4 (4.2 → 4)
- 4 → 6 (5.6 → 6)
- 5 → 7

#### 策略 2: 保守迁移

```sql
-- 保持原值，仅将原来的最高值 5 映射到 7
UPDATE "user_family_status"
SET "familiarityLevel" = 7
WHERE "familiarityLevel" = 5 AND "status" = 'KNOWN';
```

#### 策略 3: 不做任何处理

保持现有值不变，让用户自然地在新范围内调整。这是最安全的方案。

### 为现有词族添加标签

已通过 `seed-tags.ts` 脚本完成，具体步骤见"步骤 7: 导入标签数据"。

## 🔍 常见问题

### Q1: 迁移失败，提示外键约束错误

**A**: 检查数据完整性，确保：

- 所有 `user_family_status` 记录的 `userId` 都存在于 `users` 表
- 所有 `user_family_status` 记录的 `familyId` 都存在于 `word_families` 表

### Q2: 标签导入脚本找不到词族

**A**: 确认：

- 词族数据已正确导入到 `word_families` 和 `words` 表
- 标签数据文件中的单词拼写正确
- 检查大小写问题（脚本会自动转小写）

### Q3: 现有用户的熟练度显示异常

**A**: 如果前端假设熟练度范围是 0-7，但数据库中仍有 0-5 的值：

- 前端需要兼容处理旧数据
- 或者使用上述迁移策略更新数据

### Q4: 能否跳过标签系统，只升级 importSource 字段？

**A**: 可以，标签系统是可选的。如果不需要标签功能：

1. 从迁移脚本中删除 `tags` 和 `_TagToWordFamily` 相关的 SQL
2. 从 `schema.prisma` 中删除 `Tag` model 和 `WordFamily.tags` 字段
3. 重新生成迁移

### Q5: 字段重命名会影响应用运行吗？

**A**: 会影响，需要注意：

- 数据库迁移会成功执行，数据不会丢失
- **但应用代码必须同步更新**，否则会报错找不到 `encounterCount` 字段
- 确保部署时同时更新：
  1. 后端代码（Prisma Client 使用 `lookupCount`）
  2. 前端代码（API 返回的字段名）
- 建议先部署数据库，立即部署应用代码

## 📊 性能考虑

### 索引优化

新增的索引：

- `user_family_status(userId, importSource)`: 提升按来源筛选查询的性能
- `tags(key)`: 唯一索引，确保标签键不重复
- `_TagToWordFamily`: 多对多关系的双向索引

预期影响：

- ✅ 查询性能提升
- ⚠️ 写入略有影响（需要维护索引）
- 📦 存储空间增加约 5-10%

### 大数据量优化

如果词族数量超过 10 万：

```sql
-- 分批更新，避免锁表时间过长
DO $$
DECLARE
  batch_size INT := 1000;
  offset_val INT := 0;
BEGIN
  LOOP
    UPDATE "user_family_status"
    SET "familiarityLevel" = ROUND("familiarityLevel" * 7.0 / 5.0)
    WHERE ctid IN (
      SELECT ctid FROM "user_family_status"
      WHERE "familiarityLevel" <= 5
      LIMIT batch_size OFFSET offset_val
    );

    IF NOT FOUND THEN EXIT; END IF;
    offset_val := offset_val + batch_size;

    -- 提交并等待一小段时间
    COMMIT;
    PERFORM pg_sleep(0.1);
  END LOOP;
END $$;
```

## 🎯 总结

### 必须操作

1. ✅ 备份数据库
2. ✅ 执行迁移脚本（3 个迁移）
3. ✅ 验证表结构
4. ✅ **同步更新应用代码**（特别是 `lookupCount` 字段）
5. ✅ 测试核心功能

### 推荐操作

1. 📌 在测试环境先验证
2. 📌 导入标签数据
3. 📌 更新前端代码兼容新范围

### 可选操作

1. 🔄 迁移现有熟练度数据
2. 🔄 清理旧的 UserVocabulary 表（如果已完全迁移）

### ⚠️ 重要提醒

**字段重命名影响**：`encounterCount` → `lookupCount` 会导致旧版应用代码无法工作。

- 确保数据库迁移后立即部署更新的应用代码
- 或者采用蓝绿部署、灰度发布等策略
- 避免出现数据库已更新但代码未更新的状态

## 📞 支持

如果在部署过程中遇到问题：

1. 查看 Prisma 迁移日志：`prisma/migrations/migrate.lock`
2. 检查服务器日志
3. 参考 Prisma 官方文档：https://www.prisma.io/docs/

---

**最后更新时间**: 2025-11-07
**适用版本**: 从 20251015163410 迁移到最新版本
**迁移列表**:

- 20251102_add_import_source
- 20251103051517_add_word_tags
- 20251106005715_rename_encounter_count_to_lookup_count
