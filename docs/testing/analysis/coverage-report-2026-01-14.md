# Test Coverage Analysis Report

**Generated:** 2026-01-14 (Final Update)
**Mode:** Full Analysis
**Test Framework:** Vitest v4.0.16
**Agent:** Test Plan Agent

---

## Executive Summary

| Metric | Previous (Dec 20) | Current | Change | Status |
|--------|-------------------|---------|--------|--------|
| Test Suites | 8 | 61 | +53 (+663%) | :white_check_mark: Major improvement |
| Total Tests | 88 | 1,298 | +1,210 (+1,375%) | :white_check_mark: Major improvement |
| Statement Coverage | 36.8% | 69.65% | +32.85% | :warning: Below 80% target |
| Branch Coverage | ~30% | 60.9% | +30.9% | :warning: Below 75% target |
| Function Coverage | ~40% | 75.88% | +35.88% | :warning: Near 80% target |
| Line Coverage | 36.8% | 70.65% | +33.85% | :warning: Below 80% target |

### Tests Added This Session

| Test File | Tests Added | Status |
|-----------|-------------|--------|
| lib/amazon/__tests__/adapter.test.ts | 48 | ✅ All passing |
| lib/listing-assistant/__tests__/templates.service.test.ts | 22 | ✅ All passing |
| lib/listing-assistant/__tests__/listings.service.test.ts | 26 | ✅ All passing |
| lib/listing-assistant/__tests__/ai-service.test.ts | 27 | ✅ All passing |
| lib/listing-assistant/__tests__/image-processing.test.ts | 20 (22 skipped) | ✅ Passing |
| lib/bricklink/__tests__/adapter.test.ts | 43 | ✅ All passing |
| **Total** | **186 new tests** | ✅ |

---

## Test Infrastructure Status

### Mock Infrastructure ✅ RESOLVED

All 47 previously failing tests have been fixed. The issues were:

| Issue | Status | Fix Applied |
|-------|--------|-------------|
| Supabase mock missing `.range()` | ✅ Fixed | Updated mock builder pattern |
| Repository mock exports | ✅ Fixed | Used `importOriginal` helper |
| Test assertion mismatches | ✅ Fixed | Updated assertions |

### Known Limitations

| Limitation | Impact | Workaround |
|------------|--------|------------|
| Browser Canvas API unavailable | 22 tests skipped | Tests use `it.skip()` with clear labels |
| E2E tests run separately | Coverage not merged | Playwright tests in separate job |

---

## Coverage by Feature

### CRITICAL Priority (Core Features)

| Feature | Source Files | Test Files | Coverage | Target | Gap | Status |
|---------|--------------|------------|----------|--------|-----|--------|
| **Inventory** | 2 | 2 | ~50% | 85% | 35% | ⚠️ Below Target |
| **Purchases** | 2 | 2 | ~50% | 85% | 35% | ⚠️ Below Target |
| **Orders** | 3 | 3 | ~40% | 85% | 45% | ❌ Significant Gap |
| **Authentication** | 3 | 1 | ~30% | 85% | 55% | ❌ Significant Gap |

#### Inventory
- `inventory.repository.ts` - Has test file with 3 passing tests
- `inventory.service.ts` - Has test file (8 failing due to mock issues)
- **Missing:** Bulk operations, status transitions, dual-write integration

#### Purchases
- `purchase.repository.ts` - Has test file (passing)
- `purchase.service.ts` - Has test file (passing)
- **Missing:** AI parsing integration, cost calculation edge cases

#### Orders
- `order.repository.ts` - Has test file (failing due to mock)
- `order-sync.service.ts` - Has test file (21 failing due to mock)
- `order-status.service.ts` - Has test file (1 failing due to mock)
- **Missing:** Order fulfilment service tests, eBay order sync

---

### HIGH Priority (Platform Integrations)

| Feature | Source Files | Test Files | Coverage | Target | Status |
|---------|--------------|------------|----------|--------|--------|
| **BrickLink** | 6 | 2 | 100% | 75% | ✅ Exceeds target |
| **Amazon** | 6 | 2 | 94.14% | 75% | ✅ Exceeds target |
| **Brick Owl** | 5 | 1 | ~28% | 75% | ❌ Gap remains |
| **Bricqer** | 5 | 1 | ~24% | 75% | ❌ Gap remains |
| **eBay** | 16 | 3 | ~51% | 75% | ⚠️ Partial coverage |
| **PayPal** | 5 | 0 | ~12% | 75% | ❌ No tests |
| **Google Sheets** | 4 | 2 | ~68% | 75% | ⚠️ Close to target |

#### BrickLink ✅ RESOLVED
- `adapter.ts` - 43 tests added covering order normalization, statistics
- `types.ts` - Type definitions (no tests needed)
- `client.ts` - Covered indirectly via adapter tests

#### Amazon ✅ RESOLVED
- `adapter.ts` - 48 tests added covering all order scenarios
- `client.ts` - Basic tests in amazon-client.test.ts
- Coverage: 94.14% statements

#### eBay (Partial Coverage)
Files with tests:
- `ebay-api.adapter.test.ts` - OAuth, request signing ✅
- `ebay-order-sync.service.test.ts` - Order sync ✅
- `ebay-inventory-linking.service.test.ts` - Inventory linking ✅

Files needing tests:
- `ebay-finances.service.ts` - Financial transactions
- `ebay-fulfilment.service.ts` - Order fulfilment
- `ebay-listing-refresh.service.ts` - Listing refresh feature

---

### HIGH Priority (Data Layer)

| Feature | Source Files | Test Files | Coverage | Target | Gap | Status |
|---------|--------------|------------|----------|--------|-----|--------|
| **Repositories** | 7 | 3 | 43% | 75% | 32% | ⚠️ Below Target |
| **Sync/Dual-Write** | 3 | 2 | ~50% | 75% | 25% | ⚠️ Below Target |
| **Cache** | 1 | 1 | ~50% | 75% | 25% | ⚠️ Below Target |

#### Missing Repository Tests
- `base.repository.ts` - No tests
- `credentials.repository.ts` - No tests
- `mileage.repository.ts` - No tests
- `user.repository.ts` - No tests

---

### MEDIUM Priority (Reporting)

| Feature | Source Files | Test Files | Coverage | Target | Gap | Status |
|---------|--------------|------------|----------|--------|-----|--------|
| **Financial Reports** | 2 | 2 | ~60% | 70% | 10% | ⚠️ Close to Target |
| **Profit/Loss** | 1 | 1 | ~70% | 70% | 0% | ✅ At Target |

---

### Listing Assistant ✅ MAJOR PROGRESS

| Component | Files | Test Files | Tests | Coverage | Status |
|-----------|-------|------------|-------|----------|--------|
| Services | 5 | 4 | 95 | 54.62% | ⚠️ Good progress |
| Hooks | 5 | 0 | 0 | 0% | ❌ Gap remains |
| Image Processing | 1 | 1 | 42 | ~60% | ⚠️ Partial (22 skipped) |

#### Tests Added This Session

| File | Tests | Coverage |
|------|-------|----------|
| `templates.service.test.ts` | 22 | CRUD, seeding, defaults |
| `listings.service.test.ts` | 26 | CRUD, filtering, pagination |
| `ai-service.test.ts` | 27 | Claude/Gemini integration |
| `image-processing.test.ts` | 20 (22 skipped) | Utilities, validation |

#### Files Still Needing Tests
- `hooks/listing-assistant/use-templates.ts`
- `hooks/listing-assistant/use-listings.ts`
- `hooks/listing-assistant/use-generator.ts`
- `hooks/listing-assistant/use-settings.ts`
- `hooks/listing-assistant/use-image-processor.ts`

---

## API Routes Coverage

| Category | Routes | Tests | Coverage | Status |
|----------|--------|-------|----------|--------|
| Auth | 4 | 1 | 25% | ❌ |
| Inventory | 6 | 2 | 33% | ⚠️ |
| Purchases | 5 | 1 | 20% | ❌ |
| Orders | 12 | 1 | 8% | ❌ |
| Integrations | 50+ | 0 | 0% | ❌ |
| Reports | 6 | 0 | 0% | ❌ |
| Other | 100+ | 0 | 0% | ❌ |

**Total:** 182 API routes with only 5 test files

---

## Prioritised Test Gaps

### CRITICAL Gaps (Fix First)

1. **Fix Mock Configuration**
   - Files: All test setup files
   - Issue: Supabase mock missing methods (`.range()`, `.eq()` chains)
   - Issue: Repository mocks not exported correctly
   - Action: Update `src/test/setup.ts` and individual mock configurations
   - Impact: 47 tests currently failing

2. **eBay Integration Tests**
   - Files: `lib/ebay/*.ts` (16 files)
   - Current: 0%
   - Target: 75%
   - Scenarios: OAuth flow, order sync, transaction sync, inventory linking
   - Dependencies: Mock eBay API responses

3. **Amazon Integration Tests**
   - Files: `lib/amazon/*.ts` (6 files)
   - Current: 0%
   - Target: 75%
   - Scenarios: SP-API auth, finances sync, fee reconciliation
   - Dependencies: Mock Amazon API responses

4. **Order Fulfilment Service**
   - File: `lib/services/order-fulfilment.service.ts`
   - Current: 0%
   - Target: 85%
   - Scenarios: Fulfil order, mark shipped, tracking updates
   - Dependencies: Platform adapter mocks

### HIGH Gaps (Next Sprint)

5. **Listing Assistant Feature**
   - Files: 11 files in `lib/listing-assistant/` and `hooks/listing-assistant/`
   - Current: 0%
   - Target: 75%
   - Scenarios: Template CRUD, listing generation, image processing
   - Priority: New feature needs tests

6. **Platform Adapters**
   - Files: `lib/bricklink/adapter.ts`, `lib/brickowl/adapter.ts`, etc.
   - Current: 0%
   - Target: 75%
   - Scenarios: Order fetch, inventory sync, API error handling
   - Dependencies: Create API response fixtures

7. **Missing Repository Tests**
   - Files: `credentials.repository.ts`, `mileage.repository.ts`, `user.repository.ts`
   - Current: 0%
   - Target: 75%
   - Scenarios: CRUD operations, error handling

### MEDIUM Gaps (Backlog)

8. **API Route Integration Tests**
   - Files: 177 untested API routes
   - Focus Areas: Integration routes, report routes, sync routes
   - Approach: Add tests as routes are modified

9. **Hook Tests**
   - Files: 39 untested hooks
   - Focus: Data fetching hooks, mutation hooks
   - Approach: React Testing Library with mock providers

---

## Recommendations

### Immediate Actions (This Week)

1. **Fix Mock Infrastructure** - Priority 1
   - Update Supabase mock to include all chained methods
   - Fix repository mock exports in `vi.mock()` calls
   - Get all 47 failing tests passing

2. **Add eBay Basic Tests** - Priority 2
   - Create mock fixtures for eBay API responses
   - Add unit tests for `ebay-api.adapter.ts`
   - Add integration test for OAuth callback

### Next Sprint

3. **Complete Platform Integration Tests**
   - Create shared mock fixtures directory
   - Add tests for all platform adapters
   - Add tests for transaction sync services

4. **Listing Assistant Coverage**
   - Add unit tests for all service files
   - Add hook tests with React Testing Library
   - Add image processing unit tests

### Technical Debt

5. **Create Test Infrastructure**
   - Shared test fixtures for LEGO sets, orders, transactions
   - Platform API mock factory
   - Database seeding utilities

6. **Improve Test Organisation**
   - Co-locate tests with source files consistently
   - Add test coverage thresholds to CI
   - Set up coverage reporting dashboard

---

## Test Manifest Generated

See: `docs/testing/registry/test-manifest-2026-01-14-updated.json`

Use `/test-build critical` to generate tests for critical gaps.
Use `/test-build high` to generate tests for high priority gaps.

---

## Session Summary

### Tests Added This Session: 186

| Gap ID | Feature | Tests | Status |
|--------|---------|-------|--------|
| GAP-004 | Amazon adapter | 48 | ✅ Resolved |
| GAP-006 | Listing templates.service | 22 | ✅ Resolved |
| GAP-007 | Listing listings.service | 26 | ✅ Resolved |
| GAP-008 | Listing ai-service | 27 | ✅ Resolved |
| GAP-009 | Listing image-processing | 42 (22 skipped) | ⚠️ Partial |
| GAP-011 | BrickLink adapter | 43 | ✅ Resolved |

### Coverage Improvement
- Statement coverage: 55% → 63.99% (+8.99%)
- All 728 tests passing (0 failures)
- Infrastructure issues resolved

---

## Appendix: Test File Locations

### Current Test Files (27 passing)

**Library Tests:**
- `src/lib/__tests__/utils.test.ts`
- `src/lib/migration/__tests__/sheet-mappings.test.ts`
- `src/lib/migration/__tests__/dual-write.service.test.ts`
- `src/lib/repositories/__tests__/purchase.repository.test.ts`
- `src/lib/repositories/__tests__/inventory.repository.test.ts`
- `src/lib/repositories/__tests__/order.repository.test.ts`
- `src/lib/google/__tests__/sheets-client.test.ts`
- `src/lib/services/__tests__/purchase.service.test.ts`
- `src/lib/services/__tests__/bricklink-sync.service.test.ts`
- `src/lib/services/__tests__/brickowl-sync.service.test.ts`
- `src/lib/services/__tests__/bricqer-sync.service.test.ts`
- `src/lib/services/__tests__/reporting.service.test.ts`
- `src/lib/services/__tests__/inventory.service.test.ts`
- `src/lib/services/__tests__/order-status.service.test.ts`
- `src/lib/services/__tests__/order-sync.service.test.ts`
- `src/lib/services/__tests__/profit-loss-report.service.test.ts`
- `src/lib/sync/__tests__/cache.service.test.ts`

**NEW - Added This Session:**
- `src/lib/amazon/__tests__/adapter.test.ts` (48 tests)
- `src/lib/amazon/__tests__/amazon-client.test.ts`
- `src/lib/bricklink/__tests__/adapter.test.ts` (43 tests)
- `src/lib/listing-assistant/__tests__/templates.service.test.ts` (22 tests)
- `src/lib/listing-assistant/__tests__/listings.service.test.ts` (26 tests)
- `src/lib/listing-assistant/__tests__/ai-service.test.ts` (27 tests)
- `src/lib/listing-assistant/__tests__/image-processing.test.ts` (20+22 tests)

**eBay Tests:**
- `src/lib/ebay/__tests__/ebay-api.adapter.test.ts`
- `src/lib/ebay/__tests__/ebay-order-sync.service.test.ts`
- `src/lib/ebay/__tests__/ebay-inventory-linking.service.test.ts`

---

*Report generated by Test Plan Agent - 2026-01-14*
