# Done Criteria: Architecture Hardening

**Created:** 2026-03-17
**Author:** Define Done Agent + Chris
**Status:** DRAFT

---

## Feature Summary

Harden the codebase against the top 3 findings from the architecture review (2026-03-17). Deep investigation downgraded 2 of 3 "Critical" findings — the real work is adding CI, tightening auth on a handful of routes, and correcting the review report.

**Problem:** No automated quality checks on PRs, optional cron auth that silently degrades, and 6 dashboard routes with hardcoded user IDs instead of session auth.
**User:** Chris (sole developer)
**Trigger:** Architecture review graded codebase D (34/100)
**Outcome:** CI blocks broken PRs, all routes have appropriate auth, review report reflects actual state.

### Downstream Impact Assessment

| Consumer | Routes Used | Auth Method | Impact of These Changes |
|----------|------------|-------------|------------------------|
| **Peter Bot** (Discord Messenger) | `/api/service/*` | `withServiceAuth()` (x-api-key) | **None** — untouched |
| **Vinted Windows Scanner** | `/api/arbitrage/vinted/automation/*` | `withApiKeyAuth()` (X-Api-Key) | **None** — untouched |
| **Vercel Cron** | `/api/cron/*` | `CRON_SECRET` bearer token | **None** — Vercel always injects CRON_SECRET; hardening only blocks missing env var |
| **GitHub Actions Cron** | `/api/cron/*` | `CRON_SECRET` bearer token | **None** — workflows already pass the secret |
| **Browser Dashboard** | `/api/ebay-auctions/*`, `/api/markdown/*` | Session cookies (already present) | **None** — user is already logged in; adding getUser() just reads the existing session |

---

## Success Criteria

### Functional

#### F1: CI workflow runs on pull requests
- **Tag:** AUTO_VERIFY
- **Criterion:** `.github/workflows/ci.yml` exists and triggers on `pull_request` events targeting `main`
- **Evidence:** File exists with correct `on.pull_request.branches: [main]` trigger
- **Test:** `cat .github/workflows/ci.yml | grep -A2 'pull_request'` shows main branch target

#### F2: CI runs typecheck, lint, and tests
- **Tag:** AUTO_VERIFY
- **Criterion:** CI workflow executes `npm run typecheck`, `npm run lint`, and `npm run test -- --run` in sequence
- **Evidence:** Workflow YAML contains all 3 run steps
- **Test:** `grep -c 'npm run typecheck\|npm run lint\|npm run test' .github/workflows/ci.yml` returns 3

#### F3: CI uses proper caching and pinned versions
- **Tag:** AUTO_VERIFY
- **Criterion:** Workflow uses `actions/checkout@v4`, `actions/setup-node@v4` with Node 20.x, and npm cache enabled
- **Evidence:** Workflow YAML contains pinned action versions and `cache: 'npm'`
- **Test:** Read `.github/workflows/ci.yml` and verify action versions, node-version, and cache config

#### F4: CRON_SECRET is mandatory on all 27 cron routes
- **Tag:** AUTO_VERIFY
- **Criterion:** Every route file in `app/api/cron/` rejects requests when `CRON_SECRET` env var is not set, using pattern `if (!cronSecret || authHeader !== ...)`
- **Evidence:** `grep -r 'cronSecret &&' apps/web/src/app/api/cron/` returns 0 matches (old optional pattern eliminated); `grep -r '!cronSecret' apps/web/src/app/api/cron/` returns matches in all cron files that check auth
- **Test:** `grep -rl 'cronSecret &&' apps/web/src/app/api/cron/ | wc -l` equals 0

#### F5: Session auth added to 6 dashboard-only routes
- **Tag:** AUTO_VERIFY
- **Criterion:** All 6 routes below call `getUser()` and return 401 if no session, replacing hardcoded `DEFAULT_USER_ID` with authenticated `user.id`:
  - `app/api/ebay-auctions/config/route.ts`
  - `app/api/ebay-auctions/alerts/route.ts`
  - `app/api/ebay-auctions/status/route.ts`
  - `app/api/ebay-auctions/scan/route.ts`
  - `app/api/markdown/config/route.ts`
  - `app/api/markdown/proposals/route.ts`
- **Evidence:** Each file imports `createClient` from supabase/server, calls `getUser()`, checks for user, and uses `user.id` instead of `DEFAULT_USER_ID`
- **Test:** `grep -l 'DEFAULT_USER_ID' apps/web/src/app/api/ebay-auctions/*/route.ts apps/web/src/app/api/markdown/*/route.ts` returns 0 matches; `grep -l 'getUser' <same files>` returns 6 matches

#### F6: Test/debug routes guarded in production
- **Tag:** AUTO_VERIFY
- **Criterion:** All 11 routes under `/api/test/*` (9 files) and `/api/debug/*` (2 files) return 404 when `NODE_ENV === 'production'`
- **Evidence:** Each file contains an environment guard at the top of the handler
- **Test:** `grep -rL 'NODE_ENV' apps/web/src/app/api/test/*/route.ts apps/web/src/app/api/debug/*/route.ts` returns 0 unguarded files

#### F7: Architecture review report corrected
- **Tag:** AUTO_VERIFY
- **Criterion:** `docs/reviews/2026-03-17_architecture-review.md` contains a "Corrections" section documenting that (a) unauthenticated routes finding is downgraded to Low, (b) zero-policy RLS finding is a false positive, and (c) overall grade is revised to D+ (39/100)
- **Evidence:** File contains string "Corrections" and revised grade
- **Test:** `grep -c 'Corrections\|False Positive\|D+ (39' docs/reviews/2026-03-17_architecture-review.md` returns 3+

---

### Error Handling

#### E1: Cron routes return 401 with clear error when CRON_SECRET missing
- **Tag:** AUTO_VERIFY
- **Criterion:** When `CRON_SECRET` env var is unset and a request hits any cron route, the response is `{ error: 'Unauthorized' }` with HTTP 401
- **Evidence:** Code path: `if (!cronSecret || ...)` returns 401
- **Test:** Read any cron route and verify the guard returns `{ error: 'Unauthorized' }` with status 401

#### E2: Dashboard routes return 401 with clear error when not authenticated
- **Tag:** AUTO_VERIFY
- **Criterion:** When an unauthenticated request hits any of the 6 dashboard routes (F5), the response is `{ error: 'Unauthorized' }` with HTTP 401
- **Evidence:** Code path: `if (!user)` returns 401
- **Test:** Read route files and verify the auth guard pattern

#### E3: CI workflow fails on type errors
- **Tag:** AUTO_VERIFY
- **Criterion:** `npm run typecheck` currently passes on main branch (0 errors) so CI will catch regressions
- **Evidence:** Run `npm run typecheck` locally and confirm exit code 0
- **Test:** `cd apps/web && npx tsc --noEmit; echo $?` returns 0

---

### Performance

#### P1: CI completes in under 5 minutes
- **Tag:** AUTO_VERIFY
- **Criterion:** The CI workflow completes all steps (install, typecheck, lint, test) in under 5 minutes on GitHub Actions ubuntu-latest runner
- **Evidence:** First workflow run duration visible in GitHub Actions UI
- **Test:** Check workflow run duration after first PR triggers it

---

### Integration

#### I1: No downstream consumer broken
- **Tag:** AUTO_VERIFY
- **Criterion:** Peter bot proxy (`/hb/*`), Vinted scanner, Vercel cron, and GitHub Actions cron workflows continue to function after changes. Specifically: (a) `/api/service/*` routes remain unchanged, (b) `/api/arbitrage/vinted/automation/*` routes remain unchanged, (c) cron routes accept valid `CRON_SECRET` bearer tokens as before
- **Evidence:** No changes made to service auth middleware, Vinted API key auth, or the `CRON_SECRET` success path — only the missing-secret failure path is modified
- **Test:** `git diff apps/web/src/lib/middleware/service-auth.ts` shows no changes; `git diff apps/web/src/app/api/arbitrage/vinted/automation/` shows no changes; cron routes only differ in the `cronSecret &&` → `!cronSecret ||` guard

#### I2: Dashboard pages still function after auth changes
- **Tag:** AUTO_VERIFY
- **Criterion:** The eBay Auctions and Markdown dashboard pages load successfully when the user is logged in — `npm run build` completes without errors
- **Evidence:** Build success confirms no import/type errors from auth changes
- **Test:** `npm run build` exits with code 0

---

## Out of Scope

- Branch protection rules (manual GitHub admin setting, not code)
- Build step in CI (Vercel handles production builds)
- E2E/Playwright tests in CI (future enhancement)
- Dependabot/Renovate setup
- Rate limiting (separate initiative)
- Fixing the 298 layer-bypass routes (separate quarter-long effort)
- Any changes to RLS policies (investigation confirmed all are correct)
- Any changes to `/api/investment/*` routes (confirmed safe — public data)
- Any changes to Peter bot code in Discord-Messenger repo

---

## Dependencies

```
F1, F2 (CI Pipeline)       → no blockers, can start immediately
F3, F4, F5, F6 (Auth)      → no blockers, can start immediately
F7 (Report Correction)     → blocked by F4+F5+F6 (need final auth state)
E3 (Typecheck passes)      → should verify before F1 (if failing, fix first)
```

F1-F6 can all run in parallel. F7 runs last.

---

## Iteration Budget

- **Max iterations:** 3
- **Escalation:** If CI env vars are unclear or typecheck fails on main, pause for human review

---

## Verification Summary

| ID | Criterion | Tag | Status |
|----|-----------|-----|--------|
| F1 | CI workflow triggers on PRs to main | AUTO_VERIFY | PENDING |
| F2 | CI runs typecheck, lint, tests | AUTO_VERIFY | PENDING |
| F3 | CI uses caching and pinned versions | AUTO_VERIFY | PENDING |
| F4 | CRON_SECRET mandatory on 27 cron routes | AUTO_VERIFY | PENDING |
| F5 | Session auth on 6 dashboard routes | AUTO_VERIFY | PENDING |
| F6 | Test/debug routes guarded in production | AUTO_VERIFY | PENDING |
| F7 | Architecture review report corrected | AUTO_VERIFY | PENDING |
| E1 | Cron returns 401 when secret missing | AUTO_VERIFY | PENDING |
| E2 | Dashboard routes return 401 when unauthed | AUTO_VERIFY | PENDING |
| E3 | Typecheck passes on main | AUTO_VERIFY | PENDING |
| P1 | CI completes in < 5 minutes | AUTO_VERIFY | PENDING |
| I1 | No downstream consumers broken | AUTO_VERIFY | PENDING |
| I2 | Dashboard pages still function | AUTO_VERIFY | PENDING |

**Total:** 13 criteria (13 AUTO_VERIFY, 0 HUMAN_VERIFY, 0 TOOL_VERIFY)

---

## Handoff

Ready for: `/build-feature architecture-hardening`

**Key files affected:**
- `.github/workflows/ci.yml` (new)
- `apps/web/src/app/api/cron/*/route.ts` (27 files — mechanical `cronSecret &&` → `!cronSecret ||` change)
- `apps/web/src/app/api/ebay-auctions/config/route.ts` (add getUser)
- `apps/web/src/app/api/ebay-auctions/alerts/route.ts` (add getUser)
- `apps/web/src/app/api/ebay-auctions/status/route.ts` (add getUser)
- `apps/web/src/app/api/ebay-auctions/scan/route.ts` (add getUser)
- `apps/web/src/app/api/markdown/config/route.ts` (add getUser)
- `apps/web/src/app/api/markdown/proposals/route.ts` (add getUser)
- `apps/web/src/app/api/test/*/route.ts` (9 files — add NODE_ENV guard)
- `apps/web/src/app/api/debug/*/route.ts` (2 files — add NODE_ENV guard)
- `docs/reviews/2026-03-17_architecture-review.md` (corrections)
