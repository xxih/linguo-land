-- CreateEnum
CREATE TYPE "public"."WordFamiliarityStatus" AS ENUM ('UNKNOWN', 'LEARNING', 'KNOWN');

-- CreateTable
CREATE TABLE "public"."user_vocabulary" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'default',
    "word" TEXT NOT NULL,
    "status" "public"."WordFamiliarityStatus" NOT NULL DEFAULT 'UNKNOWN',
    "familiarityLevel" SMALLINT NOT NULL DEFAULT 0,
    "encounterCount" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_vocabulary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_vocabulary_userId_word_key" ON "public"."user_vocabulary"("userId", "word");
