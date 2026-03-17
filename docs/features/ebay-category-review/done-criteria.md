# Done Criteria: ebay-category-review

**Created:** 2026-03-17
**Author:** Define Done Agent + Chris
**Status:** APPROVED

---

## Feature Summary

Build a service that fetches eBay item categories and store categories from the Inventory API for all listings, stores them in a persistent database table linked to inventory, and provides comparison/update capabilities via API routes.

**Problem:** No visibility into what eBay item categories and store categories are assigned to listings. Can't audit whether listings are in the right categories or missing store categories.
**User:** Chris (business owner)
**Trigger:** API route call (scriptable / callable from UI later)
**Outcome:** All eBay listing categories fetched, stored persistently, with comparison and update capabilities.

---

## Success Criteria

### Functional

#### F1: Category Storage Table Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** A migration creates `ebay_listing_categories` table with columns: `id` (UUID PK), `inventory_item_id` (FK to inventory_items), `ebay_item_id` (text), `offer_id` (text), `sku` (text), `category_id` (text), `category_name` (text), `store_category_names` (text[]), `last_synced_at` (timestamptz), `created_at`, `updated_at`. Has unique constraint on `offer_id`.
- **Evidence:** Migration file exists in `supabase/migrations/` and table is queryable after `npm run db:push`
- **Test:** `SELECT * FROM ebay_listing_categories LIMIT 1` returns valid schema

#### F2: EbayOfferResponse Type Updated
- **Tag:** AUTO_VERIFY
- **Criterion:** `EbayOfferResponse` interface in `apps/web/src/lib/ebay/types.ts` includes `storeCategoryNames?: string[]` field
- **Evidence:** Grep for `storeCategoryNames` in the types file
- **Test:** `grep 'storeCategoryNames' apps/web/src/lib/ebay/types.ts`

#### F3: Bulk Offer Fetch Method
- **Tag:** AUTO_VERIFY
- **Criterion:** `EbayApiAdapter` has a `getOffers(params: { limit?: number; offset?: number })` method that calls `GET /sell/inventory/v1/offer` and returns paginated offers with `categoryId` and `storeCategoryNames`
- **Evidence:** Method exists in adapter, returns typed response with pagination metadata (total, size, offset)
- **Test:** Grep for `getOffers` method in adapter file

#### F4: Sync Service Fetches and Stores Categories
- **Tag:** AUTO_VERIFY
- **Criterion:** `EbayCategoryReviewService` has a `syncCategories(userId: string)` method that: (a) fetches all offers via paginated `getOffers`, (b) matches offers to inventory items by SKU, (c) upserts category data into `ebay_listing_categories` table
- **Evidence:** Service file exists at `apps/web/src/lib/ebay/ebay-category-review.service.ts` with `syncCategories` method
- **Test:** Service file exists and exports `syncCategories`

#### F5: Comparison Report
- **Tag:** AUTO_VERIFY
- **Criterion:** Service has `getComparisonReport(userId: string)` method that returns: (a) listings missing store categories, (b) listings where `platform_listings.ebay_data.category_id` differs from `ebay_listing_categories.category_id`, (c) eBay listings not yet in the categories table
- **Evidence:** Method returns typed report object with `missingStoreCategory`, `categoryMismatch`, `notSynced` arrays
- **Test:** Method exists and returns expected shape

#### F6: Update eBay Categories
- **Tag:** AUTO_VERIFY
- **Criterion:** Service has `updateEbayCategory(userId: string, offerId: string, changes: { categoryId?: string; storeCategoryNames?: string[] })` method that calls `updateOffer` on the eBay API
- **Evidence:** Method exists and calls adapter's `updateOffer`
- **Test:** Grep for `updateEbayCategory` in service file

#### F7: Update DB Categories
- **Tag:** AUTO_VERIFY
- **Criterion:** After sync, `platform_listings.ebay_data` is updated with `category_id` and `store_category` values from the fetched offer data for matching listings
- **Evidence:** Sync method includes Supabase update to `platform_listings` table
- **Test:** Code path exists in syncCategories that updates platform_listings

---

### Error Handling

#### E1: Auth Token Handling
- **Tag:** AUTO_VERIFY
- **Criterion:** If eBay auth token is missing or expired, service methods return a structured error `{ error: 'EBAY_AUTH_REQUIRED', message: string }` rather than throwing an unhandled exception
- **Evidence:** Auth check at start of service methods with early return
- **Test:** Code inspection shows auth guard pattern

#### E2: Partial Failure Resilience
- **Tag:** AUTO_VERIFY
- **Criterion:** If individual offer fetches or DB upserts fail, the service continues processing remaining offers and returns a summary with `{ synced: number; failed: number; errors: string[] }`
- **Evidence:** Try/catch within iteration loop, error accumulator
- **Test:** Code inspection shows error accumulation pattern

---

### Integration

#### I1: API Routes Exist
- **Tag:** AUTO_VERIFY
- **Criterion:** `GET /api/ebay/category-review` returns the comparison report. `POST /api/ebay/category-review/sync` triggers a full sync. Both require authentication.
- **Evidence:** Route files exist at `apps/web/src/app/api/ebay/category-review/route.ts` and `apps/web/src/app/api/ebay/category-review/sync/route.ts`
- **Test:** Route files exist with GET and POST handlers

#### I2: Migration Pushable
- **Tag:** AUTO_VERIFY
- **Criterion:** Migration file exists and follows project naming convention `YYYYMMDDHHMMSS_ebay_listing_categories.sql`
- **Evidence:** File exists in `supabase/migrations/`
- **Test:** `ls supabase/migrations/*ebay_listing_categories*`

---

### Performance

#### P1: Handles Full Inventory
- **Tag:** AUTO_VERIFY
- **Criterion:** Sync paginates through offers in batches of 200, with 100ms rate limiting between requests, supporting up to 500 offers
- **Evidence:** Code uses limit=200, offset pagination, and respects adapter rate limiting
- **Test:** Code inspection shows pagination loop with limit=200

---

## Out of Scope

- UI page for browsing/editing categories
- Automatic category correction recommendations
- eBay Store category hierarchy management (Stores API)
- Taxonomy API category suggestion integration
- Scheduled/cron sync

---

## Dependencies

- eBay OAuth credentials configured
- `platform_listings` table populated with eBay listings
- `inventory_items` table with SKUs matching eBay offer SKUs

---

## Iteration Budget

- **Max iterations:** 5
- **Escalation:** If not converged after 5 iterations, pause for human review

---

## Verification Summary

| ID | Criterion | Tag | Status |
|----|-----------|-----|--------|
| F1 | Category storage table | AUTO_VERIFY | PENDING |
| F2 | Type updated | AUTO_VERIFY | PENDING |
| F3 | Bulk offer fetch | AUTO_VERIFY | PENDING |
| F4 | Sync service | AUTO_VERIFY | PENDING |
| F5 | Comparison report | AUTO_VERIFY | PENDING |
| F6 | Update eBay categories | AUTO_VERIFY | PENDING |
| F7 | Update DB categories | AUTO_VERIFY | PENDING |
| E1 | Auth token handling | AUTO_VERIFY | PENDING |
| E2 | Partial failure resilience | AUTO_VERIFY | PENDING |
| I1 | API routes exist | AUTO_VERIFY | PENDING |
| I2 | Migration pushable | AUTO_VERIFY | PENDING |
| P1 | Handles full inventory | AUTO_VERIFY | PENDING |

**Total:** 12 criteria (12 AUTO_VERIFY, 0 HUMAN_VERIFY)

---

## Handoff

Ready for: `/build-feature ebay-category-review`

**Key files likely affected:**
- `apps/web/src/lib/ebay/types.ts` (update)
- `apps/web/src/lib/ebay/ebay-api.adapter.ts` (update)
- `apps/web/src/lib/ebay/ebay-category-review.service.ts` (new)
- `apps/web/src/app/api/ebay/category-review/route.ts` (new)
- `apps/web/src/app/api/ebay/category-review/sync/route.ts` (new)
- `supabase/migrations/YYYYMMDDHHMMSS_ebay_listing_categories.sql` (new)
