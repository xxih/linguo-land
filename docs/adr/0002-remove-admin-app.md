# ADR 0002 — Remove admin app and admin-only endpoints

**Status:** Accepted — 2026-04-25

## Context

`apps/admin` was a Next.js 15 maintenance UI for word-family management (list, remove word, move word, stats). It was:

- Not in any CI workflow, not deployed, not referenced by `apps/extension` (verified via grep — zero hits)
- On Tailwind v3.4 while the rest of the frontend has moved to v4 — every passing day made the styling layer more divergent
- Backed by `apps/server/src/admin.controller.ts` and three "admin-only" endpoints in `vocabulary.controller.ts` (`/word/:wordText/remove`, `/move`, `/create-family`) — none of which the extension calls

The product has no users yet; carrying unused tooling now is pure cost.

## Decision

Delete the entire stack:

- `apps/admin/` directory
- `apps/server/src/admin.controller.ts`
- The three admin-only endpoints in `vocabulary.controller.ts` and their backing service methods (`removeWordFromFamily`, `moveWordToFamily`, `createFamilyFromWord` in `vocabulary.service.ts`)
- `AdminController` removed from `app.module.ts`
- `apps/admin` removed from `CLAUDE.md` project overview

The Prisma schema is unchanged — word-family data still exists, just no longer has a UI.

## Consequences

- Less code, less drift, no Tailwind version split, smaller mental surface for the upcoming refactor passes (repository layer, schema cleanup, etc.).
- If word-family corpus needs editorial cleanup later, write a one-off CLI script or stand up a fresh, properly-scoped admin app. Starting from a clean slate beats inheriting a stale React app.
