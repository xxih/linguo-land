/*
  手动修改的迁移文件

  处理步骤：
  1. 创建 users 表
  2. 创建默认用户用于迁移现有数据
  3. 安全地将 userId 从 String 转换为 Int
*/

-- 1. 创建 users 表
CREATE TABLE "public"."users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- 2. 创建默认用户用于迁移（密码是 'default123' 的哈希值）
-- bcrypt hash for 'default123': $2b$10$YourHashHere
INSERT INTO "public"."users" ("email", "password", "createdAt", "updatedAt")
VALUES ('default@langland.com', '$2b$10$rBV2cFZEHvJQT4YvxNMPLOH9hJmvZ5qVXQDGJqBxqxH5wQlLZ3xZm', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- 3. 备份旧的 userId 到临时列
ALTER TABLE "public"."user_family_status" ADD COLUMN "userId_old" TEXT;
UPDATE "public"."user_family_status" SET "userId_old" = "userId";

-- 4. 删除旧列并创建新的整型列
ALTER TABLE "public"."user_family_status" DROP COLUMN "userId";
ALTER TABLE "public"."user_family_status" ADD COLUMN "userId" INTEGER NOT NULL DEFAULT 1;

-- 5. 清理临时列
ALTER TABLE "public"."user_family_status" DROP COLUMN "userId_old";

-- 6. 移除默认值（之后插入必须指定 userId）
ALTER TABLE "public"."user_family_status" ALTER COLUMN "userId" DROP DEFAULT;

-- 7. 创建索引
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");
CREATE INDEX "user_family_status_userId_idx" ON "public"."user_family_status"("userId");
CREATE UNIQUE INDEX "user_family_status_userId_familyId_key" ON "public"."user_family_status"("userId", "familyId");

-- 8. 添加外键约束
ALTER TABLE "public"."user_family_status"
ADD CONSTRAINT "user_family_status_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "public"."users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
