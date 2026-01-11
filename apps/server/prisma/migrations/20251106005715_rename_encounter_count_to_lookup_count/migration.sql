-- Rename encounterCount to lookupCount in user_family_status
ALTER TABLE "user_family_status" RENAME COLUMN "encounterCount" TO "lookupCount";

-- Rename encounterCount to lookupCount in user_vocabulary  
ALTER TABLE "user_vocabulary" RENAME COLUMN "encounterCount" TO "lookupCount";
