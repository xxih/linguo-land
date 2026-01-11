-- AlterTable
ALTER TABLE "public"."user_family_status" ADD COLUMN "importSource" TEXT;

-- CreateIndex
CREATE INDEX "user_family_status_userId_importSource_idx" ON "public"."user_family_status"("userId", "importSource");

