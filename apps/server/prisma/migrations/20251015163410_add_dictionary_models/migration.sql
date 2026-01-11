-- CreateTable
CREATE TABLE "public"."dictionary_entries" (
    "id" SERIAL NOT NULL,
    "word" TEXT NOT NULL,
    "phonetics" TEXT[],
    "audio" TEXT[],
    "forms" TEXT[],
    "chineseEntriesShort" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dictionary_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."definition_entries" (
    "id" SERIAL NOT NULL,
    "pos" TEXT NOT NULL,
    "dictionaryEntryId" INTEGER NOT NULL,

    CONSTRAINT "definition_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."senses" (
    "id" SERIAL NOT NULL,
    "glosses" TEXT[],
    "examples" TEXT[],
    "definitionEntryId" INTEGER NOT NULL,

    CONSTRAINT "senses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dictionary_entries_word_key" ON "public"."dictionary_entries"("word");

-- AddForeignKey
ALTER TABLE "public"."definition_entries" ADD CONSTRAINT "definition_entries_dictionaryEntryId_fkey" FOREIGN KEY ("dictionaryEntryId") REFERENCES "public"."dictionary_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."senses" ADD CONSTRAINT "senses_definitionEntryId_fkey" FOREIGN KEY ("definitionEntryId") REFERENCES "public"."definition_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
