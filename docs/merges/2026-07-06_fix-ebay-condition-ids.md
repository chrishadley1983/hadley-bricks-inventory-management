# Merge Report — fix/ebay-condition-ids (PR #511)

**Merged:** 2026-07-06, squash commit `2490b036` (previous main `46114ed5`)
**Track:** FIX

## What shipped

The listing-preview Quality Review flagged "Verify Condition ID 4000" on a used-set draft.
Verified against eBay's Metadata API (`getItemConditionPolicies`, EBAY_GB): LEGO categories
accept only a subset of condition IDs —

- **19006** Complete Sets & Packs: 1000 (New), 1500 (New: Other), 3000 (Used)
- **263012** Minifigures: 1000, 3000 only (no 1500)
- **183449** Pieces & Parts: 1000, 2750, 4000, 5000, 6000 — notably NOT 3000

Rule applied: **all used LEGO grades → 3000**, grade expressed in `conditionDescription`.

- `generate-listing.ts` prompt: used grades → 3000; never emit 4000–7000; minifig 1500 caveat
- `listing-generation.service.ts` `mapConditionToId`: same
- `review-listing-quality.ts` prompt: valid-ID ground truth added so the AI reviewer flags
  genuine violations and does not flag 3000-with-grade-in-description as a mismatch
- `EbayFieldsSection.tsx` (minifig review UI): options trimmed to New / Used — the graded
  enums flowed straight to the Inventory API and would fail at publish in 263012
- Data: 3 `NOT_LISTED` `minifig_sync_items` rows realigned USED_VERY_GOOD → USED_EXCELLENT

The set publish path (`listing-creation.service.ts mapConditionToEbayEnum`) was already
clamped to NEW/USED_EXCELLENT for LEGO, so live listings were never at risk — the AI
draft/review layer was the inconsistency.

## Verification

| Check | Status |
|-------|--------|
| TypeScript | ✅ Pass |
| ESLint (changed files) | ✅ Pass |
| Vitest `src/lib/ebay` | ✅ 381/381 |
| Vercel production deploy | ✅ Ready, GitHub deployment SHA = `2490b036` |
| Prod HTTP smoke | ✅ `/` `/inventory` `/orders` 307 (auth), `/login` 200, `/api/ebay/listing/confirm` 405 |
| Local production server | ✅ rebuilt + restarted via `scripts/redeploy-local.ps1` |

**Note:** Playwright critical-path tests could not run authenticated — `auth.refresh.ts`
depends on `/api/auth/dev-signin`, which no longer exists in `src` (removed in the
deprecation audit). Unauthenticated failures were login-page redirects, not app errors.
HTTP smoke used instead (same as PR #510). Follow-up: fix or replace the e2e auth refresh.

## Cleanup

- Local + remote branch deleted (via `gh pr merge --delete-branch`), refs pruned
- Temp spec copy `tests/e2e/critical-paths-prod.spec.ts` removed

## Rollback

Revert squash commit `2490b036` — no migrations. The 3-row `minifig_sync_items` data fix
is independent and safe to leave (descriptions already carried the grade).
