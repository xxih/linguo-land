-- Drop the legacy UserVocabulary table. Its responsibilities have been fully
-- absorbed by user_family_status (family-aware tracking with importSource).
-- See docs/adr/0003-drop-user-vocabulary-table.md.

DROP TABLE IF EXISTS "user_vocabulary";
