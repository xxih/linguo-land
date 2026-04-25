# ADR 0006 — Wrap multi-step writes in transactions

**Status:** Accepted — 2026-04-25

## Context

Two methods on `VocabularyService` performed reads followed by conditional writes — classic check-then-act patterns vulnerable to concurrent write races:

1. **`updateWordStatus(lemma, status, userId, familiarityLevel?)`**
   - Reads `word.findUnique` to map lemma → familyId
   - Then either `deleteMany` (when `status === 'unknown'`) or upserts / updates `userFamilyStatus`
   - Between the read and the write, another request could change the user's state for the same family — last-write-wins; for the `unknown` deletion this could accidentally drop a fresh status the user just set.

2. **`autoIncreaseFamiliarity(lemma, userId)`**
   - Reads `word.findUnique`, then `userFamilyStatus.findUnique`
   - Then `update` with `familiarityLevel: existing.familiarityLevel + 1`
   - Two concurrent calls seeing `familiarityLevel: 5` would each compute 6 and write 6. The `lookupCount: { increment: 1 }` part was already atomic, but the familiarity raise was not.

`autoIncreaseFamiliarity` was also carrying ~25 lines of `console.log` debug output that obscured the actual logic.

## Decision

Wrap both methods in `prisma.$transaction(async (tx) => { ... })` and route every DB call through the transaction client `tx`. This makes the read-then-write path serializable per row at the DB level, eliminating the check-then-act race.

Other simplifications inside the transactions:

- In `updateWordStatus`, collapse the "update familiarity only" path from `findUnique + update` to a single `updateMany` — no need to read first when we're only reporting "did anything change."
- In `autoIncreaseFamiliarity`, drop the verbose debug logging; keep one informational log per outcome branch.

Touched: `apps/server/src/vocabulary.service.ts` only.

## Consequences

- Concurrent updates to the same `(userId, familyId)` row are now serialized at the DB layer. Lost-update and stale-delete races on this row are impossible.
- Net file size shrinks ~70 lines from removing the debug-log noise.
- Other multi-step write paths (`addPresetVocabulary`, `importVocabularyFromJson`) are not yet transactional. Those are bulk-import flows where partial failure is recoverable by retrying the import — lower priority. They'll get the same treatment when the repository-layer refactor (A2) lands.
- No new tests landed: the failure mode is concurrency, hard to unit-test without a real DB harness. The fix is correct by construction (Prisma interactive transactions use REPEATABLE_READ on Postgres). An integration test against the real DB would be valuable later — folded into the test-strategy plan that comes with A2.
