# ADR 0003 — Drop UserVocabulary legacy table

**Status:** Accepted — 2026-04-25

## Context

`UserVocabulary` was the original per-user word table — string `userId` (legacy), surface-form `word` strings, no concept of word families. It was superseded by `UserFamilyStatus` when word families landed (`migrations/20251011174252_add_word_families`), but kept around "for migration safety."

In practice the two tables drifted. New writes (status updates, preset additions, family-aware tracking) only go through `UserFamilyStatus`. Three stale code paths still touched the old table:

- `VocabularyService.updateWordEncounter` — only invoked from a commented-out block in `VocabularyController.queryWords`. Effectively dead.
- `VocabularyService.seedSampleData` — only used by `POST /seed`, a dev-time sample-data convenience.
- `VocabularyService.getVocabularySources` — used by `GET /sources` to list import sources for the UI. Wrong table — the new `importSource` lives on `UserFamilyStatus`.

The product has no users yet. There is no migration safety to preserve.

## Decision

Delete the `UserVocabulary` table and all its references:

- `prisma/schema.prisma` — remove the `UserVocabulary` model and its legacy section header
- `prisma/migrations/20260425170000_drop_user_vocabulary/migration.sql` — `DROP TABLE IF EXISTS "user_vocabulary"`
- `vocabulary.service.ts`:
  - delete `updateWordEncounter` (dead)
  - delete `seedSampleData` (dev-only; `POST /add-preset/<key>` covers the same need)
  - rewrite `getVocabularySources` to query `UserFamilyStatus.importSource` (semantically what the old query *was* trying to express)
- `vocabulary.controller.ts` — drop `POST /seed` and the commented-out encounter-tracking block

## Consequences

- Single source of truth for user vocabulary state — no more accidental dual writes drifting apart.
- The dev-time `/seed` endpoint is gone; populate dev data via `POST /add-preset/cet_4_6` (or any other preset key).
- One redundant index goes away with the table — `user_vocabulary_userId_importSource_idx` was already covered by `user_family_status_userId_importSource_idx`.
- Anyone with an old DB needs the migration applied: `prisma migrate dev` (local) or via the deploy pipeline.
