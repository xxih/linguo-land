# ADR 0005 — Options.tsx decomposition (phase 1)

**Status:** Accepted — 2026-04-25

## Context

`apps/extension/src/options/Options.tsx` was a 2290-line single component holding:

- 5 inline interface declarations
- A custom URL-state synchronization layer (~60 lines)
- An auth flow (login / logout / user check, ~30 lines)
- A `formatDate` helper
- 6 tab render blocks: overview (~180), vocabulary-list (~410), vocabulary-import (~170), vocabulary-ignored (~75), features (~250), article-analysis (~255 lines)
- ~22 handler functions for fetching, mutating, exporting, importing
- A sidebar render (~90 lines)

Editing any tab risked accidentally breaking another. Finding a specific feature meant scrolling through ~2000 lines. A full decomposition is genuinely ~6 rounds of careful work, so this change is split into phases.

## Decision

### Phase 1 (this ADR — done)

Extract the cross-cutting infrastructure:

- `src/options/types.ts` — 5 interfaces + `ActiveTab` union.
- `src/options/utils/formatDate.ts` — `formatDate(dateString)`.
- `src/options/hooks/useUrlState.ts` — URL params state, `setUrlState(updates)`, `handleTabChange(tab)`, plus derived typed values (`currentPage`, `pageSize`, `sortBy`, `sortOrder`, `statusFilter`, `importSourceFilter`, `searchTerm`, `activeTab`).
- `src/options/hooks/useAuth.ts` — `isLoggedIn`, `currentUser`, `handleLoginSuccess`, `handleLogout`. The component wraps `handleLogout` once to also clear `vocabularyData` after logout (single-concern preservation; the hook stays auth-only).

`Options.tsx` now imports these. Net reduction: **2290 → 2143 lines**.

### Phase 2 (deferred)

Extract per-tab components under `src/options/tabs/`:

- `OverviewTab.tsx`, `VocabularyListTab.tsx`, `VocabularyImportTab.tsx`, `VocabularyIgnoredTab.tsx`, `FeaturesTab.tsx`, `ArticleAnalysisTab.tsx`
- `components/Sidebar.tsx` for the navigation column
- Additional data hooks: `useVocabularyData` (list + stats + expand row), `useSettings`, `useIgnoredWords`, `usePresets`, `useArticleAnalysis`, `useExport`

After phase 2, `Options.tsx` becomes a ~150-line orchestrator: hook calls plus tab routing.

## Consequences

- The seams are now visible. Phase 2 is mechanical — each tab binds against the already-stable contracts in `./types` and `./hooks/*`.
- TypeScript and the popup+options build both pass after phase 1. No runtime behavior change.
- Tests are deferred to phase 2: per-tab component tests are the right granularity; writing tests against the still-monolithic `Options.tsx` would be coverage padding (cf. memory `feedback_tests_core_only`).

## Open follow-ups

- Phase 2 tab extraction (above).
- Consider migrating off MUI/Emotion for the `content-ui/main.dev.tsx` dev variant; the prod content-ui already runs without them, and the deps add ~150 KB to anything that accidentally imports from `@mui/*`.
