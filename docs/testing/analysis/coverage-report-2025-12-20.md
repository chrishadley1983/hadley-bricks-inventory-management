# Test Coverage Analysis Report

**Generated:** 2025-12-20
**Mode:** Full Analysis
**Agent:** Test Plan Agent

---

## Executive Summary

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Overall Coverage | 36.8% | 80% | ❌ Significant Gap |
| Critical Features | ~50% | 85% | ❌ Below Target |
| High Features | ~10% | 75% | ❌ Critical Gap |
| Medium Features | 0% | 70% | ❌ Not Tested |

**Total Test Files:** 8
**Total Tests:** 88 passing

---

## Current Test Coverage

### Files with Coverage

| File | Statements | Branches | Functions | Lines | Status |
|------|------------|----------|-----------|-------|--------|
| `lib/utils.ts` | 100% | 100% | 100% | 100% | ✅ Complete |
| `components/ui/widget.tsx` | 100% | 84.6% | 100% | 100% | ✅ Good |
| `components/ui/card.tsx` | 94.4% | 100% | 83.3% | 94.4% | ✅ Good |
| `app/api/auth/login/route.ts` | 85.7% | 75% | 100% | 85.7% | ✅ Target |
| `app/api/inventory/route.ts` | 82.5% | 81.3% | 100% | 82.5% | ⚠️ Near Target |
| `app/api/auth/register/route.ts` | 81.3% | 70% | 100% | 81.3% | ⚠️ Near Target |
| `lib/migration/sheet-mappings.ts` | 78.8% | 78.6% | 64.3% | 80% | ⚠️ Needs Work |
| `lib/repositories/inventory.repository.ts` | 68.6% | 57.4% | 63.6% | 69.4% | ⚠️ Below Target |
| `hooks/use-inventory.ts` | 55.6% | 100% | 68.4% | 55.6% | ⚠️ Below Target |
| `lib/repositories/purchase.repository.ts` | 29.3% | 23.5% | 22.2% | 29.3% | ❌ Critical Gap |
| `lib/repositories/base.repository.ts` | 20% | 11.5% | 28.6% | 20% | ❌ Critical Gap |
| `lib/migration/dual-write.service.ts` | 2.1% | 0% | 0% | 2.2% | ❌ Not Tested |
| `lib/google/sheets-client.ts` | 0.9% | 0% | 0% | 1% | ❌ Not Tested |
| `lib/migration/migration-service.ts` | 0% | 0% | 0% | 0% | ❌ Not Tested |

---

## Coverage by Feature

### CRITICAL Priority Features

| Feature | Files | Tested Files | Coverage | Target | Gap |
|---------|-------|--------------|----------|--------|-----|
| Authentication | 3 | 2 | ~83% | 85% | 2% |
| Inventory API | 3 | 1 | ~55% | 85% | 30% |
| Purchases API | 2 | 0 | 0% | 85% | 85% |
| Orders API | 6 | 0 | 0% | 85% | 85% |

**Authentication Files:**
- `app/api/auth/login/route.ts` - 85.7% ✅
- `app/api/auth/register/route.ts` - 81.3% ⚠️
- `app/api/auth/callback/route.ts` - 0% ❌

**Inventory Files:**
- `app/api/inventory/route.ts` - 82.5% ⚠️
- `app/api/inventory/[id]/route.ts` - 0% ❌
- `app/api/inventory/summary/route.ts` - 0% ❌
- `lib/repositories/inventory.repository.ts` - 68.6% ⚠️
- `lib/services/inventory.service.ts` - 0% ❌

**Purchases Files (NO TESTS):**
- `app/api/purchases/route.ts` - 0% ❌
- `app/api/purchases/[id]/route.ts` - 0% ❌
- `lib/repositories/purchase.repository.ts` - 29.3% ⚠️ (partial from shared code)
- `lib/services/purchase.service.ts` - 0% ❌

**Orders Files (NO TESTS):**
- `app/api/orders/route.ts` - 0% ❌
- `app/api/orders/[id]/route.ts` - 0% ❌
- `app/api/orders/[id]/status/route.ts` - 0% ❌
- `app/api/orders/bulk-status/route.ts` - 0% ❌
- `app/api/orders/stats/route.ts` - 0% ❌
- `app/api/orders/status-summary/route.ts` - 0% ❌
- `lib/repositories/order.repository.ts` - 0% ❌
- `lib/services/order-sync.service.ts` - 0% ❌
- `lib/services/order-status.service.ts` - 0% ❌

### HIGH Priority Features

| Feature | Files | Tested Files | Coverage | Target | Gap |
|---------|-------|--------------|----------|--------|-----|
| BrickLink | 4 | 0 | 0% | 75% | 75% |
| Brick Owl | 4 | 0 | 0% | 75% | 75% |
| Bricqer | 4 | 0 | 0% | 75% | 75% |
| Google Sheets | 3 | 0 | ~1% | 75% | 74% |
| Dual-Write | 2 | 0 | ~2% | 75% | 73% |
| Repositories | 7 | 2 | ~35% | 75% | 40% |

**Platform Adapter Files (NO TESTS):**
- `lib/bricklink/client.ts` - 0% ❌
- `lib/bricklink/adapter.ts` - 0% ❌
- `lib/brickowl/client.ts` - 0% ❌
- `lib/brickowl/adapter.ts` - 0% ❌
- `lib/bricqer/client.ts` - 0% ❌
- `lib/bricqer/adapter.ts` - 0% ❌

**Data Layer Files:**
- `lib/google/sheets-client.ts` - ~1% ❌
- `lib/sync/cache.service.ts` - 0% ❌
- `lib/sync/sheets-write.service.ts` - 0% ❌
- `lib/migration/dual-write.service.ts` - ~2% ❌

**Repository Files:**
- `lib/repositories/inventory.repository.ts` - 68.6% ⚠️
- `lib/repositories/purchase.repository.ts` - 29.3% ❌
- `lib/repositories/order.repository.ts` - 0% ❌
- `lib/repositories/sales.repository.ts` - 0% ❌
- `lib/repositories/credentials.repository.ts` - 0% ❌
- `lib/repositories/user.repository.ts` - 0% ❌
- `lib/repositories/base.repository.ts` - 20% ❌

### MEDIUM Priority Features

| Feature | Files | Tested Files | Coverage | Target | Gap |
|---------|-------|--------------|----------|--------|-----|
| Reporting API | 9 | 0 | 0% | 70% | 70% |
| Sales API | 4 | 0 | 0% | 70% | 70% |
| AI Features | 4 | 0 | 0% | 70% | 70% |
| Services | 10 | 0 | 0% | 70% | 70% |

---

## Prioritised Test Gaps

### CRITICAL Gaps (Address Immediately)

| # | Feature | File | Current | Target | Tests Needed | Priority |
|---|---------|------|---------|--------|--------------|----------|
| 1 | Orders | `app/api/orders/route.ts` | 0% | 85% | 6 unit, 4 api | CRITICAL |
| 2 | Orders | `lib/services/order-sync.service.ts` | 0% | 85% | 8 unit, 2 integration | CRITICAL |
| 3 | Orders | `lib/services/order-status.service.ts` | 0% | 85% | 6 unit | CRITICAL |
| 4 | Orders | `lib/repositories/order.repository.ts` | 0% | 85% | 8 unit | CRITICAL |
| 5 | Purchases | `app/api/purchases/route.ts` | 0% | 85% | 6 unit, 4 api | CRITICAL |
| 6 | Purchases | `lib/services/purchase.service.ts` | 0% | 85% | 6 unit | CRITICAL |
| 7 | Inventory | `app/api/inventory/[id]/route.ts` | 0% | 85% | 4 unit, 3 api | CRITICAL |
| 8 | Inventory | `lib/services/inventory.service.ts` | 0% | 85% | 6 unit | CRITICAL |

### HIGH Gaps (Address Next)

| # | Feature | File | Current | Target | Tests Needed | Priority |
|---|---------|------|---------|--------|--------------|----------|
| 9 | BrickLink | `lib/bricklink/client.ts` | 0% | 75% | 8 unit | HIGH |
| 10 | BrickLink | `lib/bricklink/adapter.ts` | 0% | 75% | 6 unit | HIGH |
| 11 | Brick Owl | `lib/brickowl/client.ts` | 0% | 75% | 8 unit | HIGH |
| 12 | Brick Owl | `lib/brickowl/adapter.ts` | 0% | 75% | 6 unit | HIGH |
| 13 | Bricqer | `lib/bricqer/client.ts` | 0% | 75% | 10 unit | HIGH |
| 14 | Bricqer | `lib/bricqer/adapter.ts` | 0% | 75% | 8 unit | HIGH |
| 15 | Sheets | `lib/google/sheets-client.ts` | ~1% | 75% | 10 unit, 2 integration | HIGH |
| 16 | Dual-Write | `lib/migration/dual-write.service.ts` | ~2% | 75% | 8 unit, 3 integration | HIGH |
| 17 | Sync | `lib/sync/cache.service.ts` | 0% | 75% | 6 unit | HIGH |
| 18 | Repositories | `lib/repositories/base.repository.ts` | 20% | 75% | 6 unit | HIGH |

### MEDIUM Gaps (Address in Backlog)

| # | Feature | File | Current | Target | Tests Needed | Priority |
|---|---------|------|---------|--------|--------------|----------|
| 19 | Reports | `lib/services/reporting.service.ts` | 0% | 70% | 10 unit | MEDIUM |
| 20 | Reports | `lib/services/profit.service.ts` | 0% | 70% | 8 unit | MEDIUM |
| 21 | Sales | `lib/services/sales.service.ts` | 0% | 70% | 6 unit | MEDIUM |
| 22 | Sales | `lib/repositories/sales.repository.ts` | 0% | 70% | 6 unit | MEDIUM |
| 23 | AI | `lib/ai/claude-client.ts` | 0% | 70% | 4 unit | MEDIUM |
| 24 | Hooks | `hooks/use-orders.ts` | 0% | 70% | 4 unit | MEDIUM |
| 25 | Hooks | `hooks/use-purchases.ts` | 0% | 70% | 4 unit | MEDIUM |
| 26 | Hooks | `hooks/use-reports.ts` | 0% | 70% | 4 unit | MEDIUM |

---

## Missing Test Types by Feature

| Feature | Unit Tests | API Tests | Integration Tests | E2E Tests |
|---------|------------|-----------|-------------------|-----------|
| Authentication | ⚠️ Partial | ✅ Have | ❌ Missing | ❌ Missing |
| Inventory | ⚠️ Partial | ⚠️ Partial | ❌ Missing | ❌ Missing |
| Purchases | ❌ Missing | ❌ Missing | ❌ Missing | ❌ Missing |
| Orders | ❌ Missing | ❌ Missing | ❌ Missing | ❌ Missing |
| Platform Adapters | ❌ Missing | ❌ Missing | ❌ Missing | N/A |
| Google Sheets | ❌ Missing | N/A | ❌ Missing | N/A |
| Repositories | ⚠️ Partial | N/A | ❌ Missing | N/A |
| Services | ❌ Missing | N/A | ❌ Missing | N/A |
| Reports | ❌ Missing | ❌ Missing | ❌ Missing | ❌ Missing |

---

## Recommendations

### Immediate Actions (This Week)

1. **Add Order Tests** - Orders feature has 0% coverage and is business-critical
   - Start with `order-sync.service.ts` - the core sync logic
   - Add API route tests for all 6 endpoints
   - Create mocks for platform adapters

2. **Add Purchase Tests** - Purchases feature has 0% coverage
   - Add unit tests for `purchase.service.ts`
   - Add API tests for CRUD operations

3. **Improve Inventory Coverage** - Currently at ~55%
   - Add tests for `[id]/route.ts` (individual item operations)
   - Complete `inventory.service.ts` testing

### Short-Term Actions (Next Sprint)

4. **Platform Adapter Tests** - All at 0%
   - Create mock responses for each platform API
   - Test OAuth flow for BrickLink
   - Test order fetching and mapping

5. **Dual-Write Tests** - Critical for data integrity
   - Test Sheets → Supabase sync
   - Test error handling and rollback
   - Test cache invalidation

6. **Repository Layer Tests** - Base at 20%
   - Complete `base.repository.ts` testing
   - Add `order.repository.ts` tests
   - Add `sales.repository.ts` tests

### Technical Debt

1. **Create Shared Test Fixtures**
   - LEGO set fixtures (75192 Millennium Falcon, etc.)
   - Order fixtures for each platform
   - Purchase fixtures with various conditions

2. **Set Up Platform API Mocks**
   - MSW (Mock Service Worker) for API mocking
   - Mock data generators for each platform
   - Recorded API response fixtures

3. **Add Integration Test Infrastructure**
   - Test database setup/teardown
   - Supabase test client configuration
   - Google Sheets test spreadsheet

---

## Test Manifest Generated

Manifest saved to: `docs/testing/registry/test-manifest-2025-12-20.json`

Use `/test-build critical` to generate tests for critical gaps.

---

## Summary

| Priority | Gaps | Unit Tests Needed | API Tests Needed | Integration Tests Needed |
|----------|------|-------------------|------------------|--------------------------|
| CRITICAL | 8 | 50 | 11 | 2 |
| HIGH | 10 | 76 | 0 | 5 |
| MEDIUM | 8 | 46 | 0 | 0 |
| **Total** | **26** | **172** | **11** | **7** |

**Estimated Total Tests Needed:** ~190 tests to reach target coverage

### Next Steps

1. Run `/test-build critical` to generate tests for critical gaps
2. Address Orders feature first (highest business impact, 0% coverage)
3. Create platform adapter mocks before testing integrations
4. Set up integration test infrastructure for dual-write testing

---

*Report generated by Test Plan Agent*
*2025-12-20*
