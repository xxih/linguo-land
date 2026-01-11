-- AlterTable
ALTER TABLE "public"."user_vocabulary" ADD COLUMN     "importSource" TEXT;

-- CreateTable
CREATE TABLE "public"."word_families" (
    "id" SERIAL NOT NULL,
    "rootWord" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "word_families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."words" (
    "id" SERIAL NOT NULL,
    "text" TEXT NOT NULL,
    "familyId" INTEGER NOT NULL,

    CONSTRAINT "words_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_family_status" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'default',
    "familyId" INTEGER NOT NULL,
    "status" "public"."WordFamiliarityStatus" NOT NULL DEFAULT 'KNOWN',
    "familiarityLevel" SMALLINT NOT NULL DEFAULT 5,
    "encounterCount" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_family_status_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "word_families_rootWord_key" ON "public"."word_families"("rootWord");

-- CreateIndex
CREATE UNIQUE INDEX "words_text_key" ON "public"."words"("text");

-- CreateIndex
CREATE INDEX "words_familyId_idx" ON "public"."words"("familyId");

-- CreateIndex
CREATE INDEX "user_family_status_userId_idx" ON "public"."user_family_status"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_family_status_userId_familyId_key" ON "public"."user_family_status"("userId", "familyId");

-- CreateIndex
CREATE INDEX "user_vocabulary_userId_importSource_idx" ON "public"."user_vocabulary"("userId", "importSource");

-- AddForeignKey
ALTER TABLE "public"."words" ADD CONSTRAINT "words_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "public"."word_families"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_family_status" ADD CONSTRAINT "user_family_status_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "public"."word_families"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
