# Done Criteria: Architecture Phase 2

**Created:** 2026-03-17
**Author:** Define Done Agent + Chris
**Status:** DRAFT

---

## Feature Summary

Address the top 6 remaining findings from the architecture review (D+/39). Focuses on input validation, rate limiting, cache coherence, external API resilience, circular dependency resolution, and utility consolidation.

**Problem:** 62 mutation routes lack input validation, zero rate limiting, cache key mismatches cause stale UI, external API calls can hang indefinitely, circular imports between eBay modules, and 46 duplicate formatCurrency implementations.
**User:** Chris (sole developer)
**Trigger:** Architecture review Phase 2 recommendations
**Outcome:** Validated inputs, rate-limited auth, correct cache behaviour, resilient external calls, clean dependency graph, single currency formatter.

---

## Success Criteria

### Functional

#### F1: Zod validation on high-risk mutation routes
- **Tag:** AUTO_VERIFY
- **Criterion:** All mutation routes (POST/PUT/PATCH/DELETE) that accept user-submitted request bodies have Zod schema validation. Specifically: routes receiving JSON bodies from dashboard forms or external API callers must parse with a Zod schema before processing. Routes that take no body (action triggers like `/pomodoro/pause`, `/disconnect`, `/sync/*`) are exempt.
- **Evidence:** The following high-risk routes have Zod validation added (import from 'zod' present + `.safeParse()` or `.parse()` call on request body):
  - `ebay/listing/draft/[id]` (PUT)
  - `ebay/listing-refresh/[id]` (PUT)
  - `ebay/listing-refresh/[id]/execute` (POST — validates body if present)
  - `ebay/listing-refresh/eligible/enrich` (POST — validates body if present)
  - `ebay-stock/import` (POST)
  - `platform-stock/amazon/import` (POST)
  - `ebay/business-policies` (POST)
  - `orders/[id]` (DELETE — validate route param)
  - `orders/amazon/[orderId]/rematch` (POST — validate body if present)
  - `repricing` (POST)
  - `cost-modelling/scenarios/[id]/duplicate` (POST)
  - `service/purchases/[id]/photos` (POST)
  - `admin/brickset/import-barcodes-csv` (POST)
  - `arbitrage/vinted` (POST)
  - `arbitrage/vinted/automation/process` (POST)
  - `arbitrage/vinted/automation/heartbeat` (POST)
- **Test:** `grep -rL "from 'zod'\|from \"zod\"" apps/web/src/app/api/ebay/listing/draft/*/route.ts apps/web/src/app/api/ebay/listing-refresh/*/route.ts apps/web/src/app/api/ebay-stock/import/route.ts apps/web/src/app/api/repricing/route.ts apps/web/src/app/api/ebay/business-policies/route.ts` returns 0 unvalidated files

#### F2: Rate limiting on auth endpoints
- **Tag:** AUTO_VERIFY
- **Criterion:** `/api/auth/login` and `/api/auth/register` routes have rate limiting that restricts repeated requests from the same IP. Implementation uses an in-memory store (acceptable for single Vercel instance) or Supabase-backed counter. Limit: max 10 requests per minute per IP on auth routes.
- **Evidence:** Auth route files contain rate limiting logic that checks request count per IP and returns 429 when exceeded
- **Test:** `grep -l 'rate\|429\|Too Many' apps/web/src/app/api/auth/login/route.ts apps/web/src/app/api/auth/register/route.ts` returns 2 matches

#### F3: Cache key mismatches fixed
- **Tag:** AUTO_VERIFY
- **Criterion:** (a) `LinkedInventoryPopover.tsx` uses `inventoryKeys.detail(id)` from the shared key factory instead of inline `['inventory', 'item', id]`. (b) `ConfirmOrdersDialog.tsx` invalidates using the shared `inventoryKeys.lists()` instead of the overly broad `['inventory']` root. (c) `use-orders.ts` defines an `orderKeys` factory and all order-related queries/invalidations use it.
- **Evidence:** No inline query key arrays `['inventory', 'item'` or `['orders',` in the affected files; imports from shared key factories instead
- **Test:** `grep -c "\\['inventory', 'item'" apps/web/src/components/features/orders/LinkedInventoryPopover.tsx` returns 0; `grep -c "inventoryKeys" apps/web/src/components/features/orders/LinkedInventoryPopover.tsx` returns 1+

#### F4: Timeouts on all external API clients
- **Tag:** AUTO_VERIFY
- **Criterion:** All 4 external API clients use AbortController with a timeout on every fetch call:
  - `lib/ebay/ebay-api.adapter.ts` — 30s timeout
  - `lib/shopify/client.ts` — 30s timeout
  - `lib/keepa/keepa-client.ts` — 30s timeout
  - `lib/brickset/brickset-api.ts` — 30s timeout
- **Evidence:** Each file contains `AbortController` and `setTimeout` or `AbortSignal.timeout()` with a value of 30000ms
- **Test:** `grep -l 'AbortController\|AbortSignal.timeout' apps/web/src/lib/ebay/ebay-api.adapter.ts apps/web/src/lib/shopify/client.ts apps/web/src/lib/keepa/keepa-client.ts apps/web/src/lib/brickset/brickset-api.ts` returns 4 matches

#### F5: Circular dependencies resolved
- **Tag:** AUTO_VERIFY
- **Criterion:** (a) The `lib/ebay ↔ lib/platform-stock` cycle is broken by moving `EbayAuthService` (or its interface) to a shared location that both modules can import without creating a cycle. (b) The `lib/ebay ↔ lib/ai` cycle is broken by moving shared types (`DescriptionStyle`, `QualityReviewResult`, `FullItemDetails`) to `types/` so `lib/ai/prompts/` imports from `types/` instead of `lib/ebay/`.
- **Evidence:** (a) `grep -r "from '@/lib/ebay'" apps/web/src/lib/platform-stock/` returns 0 matches. (b) `grep -r "from '@/lib/ebay'" apps/web/src/lib/ai/` returns 0 matches AND `grep -r "from '@/lib/platform-stock'" apps/web/src/lib/ai/` returns 0 matches.
- **Test:** Run the grep commands above — both return 0 matches

#### F6: formatCurrency consolidated to single source
- **Tag:** AUTO_VERIFY
- **Criterion:** (a) All 44 local `function formatCurrency` definitions in page/component files are removed and replaced with imports from `@/lib/utils`. (b) `packages/shared` is deleted (dead code — 0 consumers). (c) `formatCurrencyGBP` from `@/lib/arbitrage/calculations` is moved to `@/lib/utils` alongside `formatCurrency` so both live in one place. (d) Total `function formatCurrency` definitions in `apps/web/src/` is exactly 2: one in `lib/utils.ts` and one in `lib/arbitrage/calculations.ts` (or merged into utils).
- **Evidence:** `grep -r "function formatCurrency" apps/web/src/app/ apps/web/src/components/` returns 0 matches (no more local definitions)
- **Test:** `grep -rc "function formatCurrency" apps/web/src/app/ apps/web/src/components/ | grep -v ':0$' | wc -l` returns 0

---

### Error Handling

#### E1: Rate limiter returns 429 with Retry-After header
- **Tag:** AUTO_VERIFY
- **Criterion:** When rate limit is exceeded on auth endpoints, the response is HTTP 429 with a `Retry-After` header indicating seconds until the limit resets
- **Evidence:** Auth route code returns `NextResponse.json({ error: 'Too many requests' }, { status: 429 })` with `Retry-After` header
- **Test:** Read auth route file and verify 429 response with Retry-After header

#### E2: Timed-out external API calls throw descriptive errors
- **Tag:** AUTO_VERIFY
- **Criterion:** When an external API call times out (AbortController), the error is caught and wrapped with context (e.g., "eBay API request timed out after 30s") rather than an opaque AbortError
- **Evidence:** Each client has a try/catch around fetch that handles `AbortError` or `TimeoutError` with a descriptive message
- **Test:** Read each client file and verify the timeout error handling pattern

---

### Integration

#### I1: No downstream consumers broken by Zod validation
- **Tag:** AUTO_VERIFY
- **Criterion:** Existing frontend components that call the newly-validated routes continue to work — their request payloads already match the new schemas (schemas are derived from what the frontend already sends, not invented)
- **Evidence:** `npm run typecheck` passes; `npm run build` passes
- **Test:** `npm run typecheck` exits 0 (excluding pre-existing untracked file)

#### I2: No downstream consumers broken by formatCurrency consolidation
- **Tag:** AUTO_VERIFY
- **Criterion:** All files that previously used a local `formatCurrency` now import from `@/lib/utils` and produce identical output
- **Evidence:** `npm run typecheck` passes; `npm run build` passes
- **Test:** `npm run typecheck` exits 0

#### I3: Circular dependency fix doesn't break imports
- **Tag:** AUTO_VERIFY
- **Criterion:** Moving types to `types/` and auth service to shared location doesn't break any existing imports — `npm run typecheck` passes
- **Evidence:** `npm run typecheck` exits 0
- **Test:** `npm run typecheck` exits 0

---

## Out of Scope

- Adding Zod to action-trigger routes with no body (pomodoro, disconnect, sync triggers)
- Adding Zod to cron routes (internal, no user input)
- Rate limiting on all API routes (only auth endpoints for now)
- Rate limiting using external stores (Redis/KV) — in-memory is sufficient for single-instance
- Fixing the 298 layer-bypass routes (separate quarter-long effort)
- Adding retry logic to Brickset API (only timeout for now)
- Migrating inline query keys in all 42 component files (only fixing the 3 known-broken ones)
- Deleting `formatCurrencyGBP` (too many consumers — consolidate location only)

---

## Dependencies

```
F1 (Zod validation)       → no blockers
F2 (Rate limiting)        → no blockers
F3 (Cache keys)           → no blockers
F4 (Timeouts)             → no blockers
F5 (Circular deps)        → no blockers
F6 (formatCurrency)       → no blockers (but do after F5 to avoid merge conflicts)
```

All items are independent. F5 and F6 should go in separate commits to keep diffs clean.

---

## Iteration Budget

- **Max iterations:** 5
- **Escalation:** If Zod schemas are complex to derive from existing frontend code, pause for review

---

## Verification Summary

| ID | Criterion | Tag | Status |
|----|-----------|-----|--------|
| F1 | Zod validation on 16 high-risk routes | AUTO_VERIFY | PENDING |
| F2 | Rate limiting on auth endpoints | AUTO_VERIFY | PENDING |
| F3 | Cache key mismatches fixed | AUTO_VERIFY | PENDING |
| F4 | Timeouts on 4 external API clients | AUTO_VERIFY | PENDING |
| F5 | Circular dependencies resolved | AUTO_VERIFY | PENDING |
| F6 | formatCurrency consolidated | AUTO_VERIFY | PENDING |
| E1 | Rate limiter returns 429 + Retry-After | AUTO_VERIFY | PENDING |
| E2 | Timeout errors are descriptive | AUTO_VERIFY | PENDING |
| I1 | No breakage from Zod validation | AUTO_VERIFY | PENDING |
| I2 | No breakage from formatCurrency consolidation | AUTO_VERIFY | PENDING |
| I3 | No breakage from circular dep fix | AUTO_VERIFY | PENDING |

**Total:** 11 criteria (11 AUTO_VERIFY, 0 HUMAN_VERIFY, 0 TOOL_VERIFY)

---

## Handoff

Ready for: `/build-feature architecture-phase2`

**Key files affected:**
- 16 API route files (Zod schemas added)
- `apps/web/src/app/api/auth/login/route.ts` (rate limiting)
- `apps/web/src/app/api/auth/register/route.ts` (rate limiting)
- `apps/web/src/components/features/orders/LinkedInventoryPopover.tsx` (cache keys)
- `apps/web/src/components/features/orders/ConfirmOrdersDialog.tsx` (cache keys)
- `apps/web/src/hooks/use-orders.ts` (query key factory)
- `apps/web/src/lib/ebay/ebay-api.adapter.ts` (timeout)
- `apps/web/src/lib/shopify/client.ts` (timeout)
- `apps/web/src/lib/keepa/keepa-client.ts` (timeout)
- `apps/web/src/lib/brickset/brickset-api.ts` (timeout)
- `apps/web/src/lib/ebay/listing-creation.types.ts` → `types/ebay-listing.ts` (moved types)
- `apps/web/src/lib/platform-stock/ebay/ebay-stock.service.ts` (import fix)
- `apps/web/src/lib/ai/prompts/*.ts` (import fix)
- `apps/web/src/lib/utils.ts` (formatCurrencyGBP added)
- ~44 page/component files (local formatCurrency removed, import added)
- `packages/shared/` (deleted)
