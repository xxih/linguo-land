-- CreateTable
CREATE TABLE "public"."tags" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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
