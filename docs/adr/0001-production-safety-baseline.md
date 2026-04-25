# ADR 0001 — Production safety baseline (CORS + JWT secrets)

**Status:** Accepted — 2026-04-25

## Context

`apps/server` had two production red flags:

1. **CORS wide open** — `app.enableCors({ origin: true })` accepted requests from any origin. Any website could call the API with a stolen Bearer token.
2. **JWT secrets fell back to literal strings** — `process.env.JWT_SECRET || 'your-secret-key'` (and the same for `JWT_REFRESH_SECRET`) appeared in `auth.module.ts`, `auth.service.ts`, and `jwt.strategy.ts`. If env vars were ever unset on prod, tokens were signed with a publicly-known string, making forgery trivial.

Both were noted as "to fix in production" comments but never were.

## Decision

1. **CORS**: Replace the wildcard with a callback validator (`src/cors.ts: buildCorsOriginValidator`).
   - Allow any `chrome-extension://*` origin (the extension is the primary client; extension IDs differ per dev/prod build).
   - Allow origins listed in env var `CORS_ORIGINS` (comma-separated).
   - Allow `localhost` only when `NODE_ENV !== 'production'`.
   - Reject everything else.
2. **JWT secrets**: Drop all fallback strings.
   - `JwtModule` switched from `register` to `registerAsync` so the secret is read after `ConfigModule` has loaded `.env`.
   - `JWT_SECRET` and `JWT_REFRESH_SECRET` resolve via `ConfigService` and throw at module/service init if unset (`src/env.util.ts: requireConfig`).
   - `AuthService` and `JwtStrategy` now inject `ConfigService` instead of reading `process.env` directly.

## Consequences

- No more known-secret signing; CORS no longer permits arbitrary origins.
- A single `requireConfig` helper standardizes future required-env enforcement — no more `process.env.X || 'fallback'` patterns.
- Dev environments missing `.env` now crash at startup instead of running with default secrets. This is intentional: silent fallback was the bug.
- Production deployments need `CORS_ORIGINS` set if a non-extension client (e.g. a future web admin) is added. Until then, `chrome-extension://*` is sufficient.

## Test

`apps/server/src/cors.spec.ts` covers the validator branches with security implications: extension scheme always allowed, configured origins allowed, localhost in dev only, unknown origins rejected in prod.
