# Test Coverage Analysis Report

**Generated:** 2026-01-15 23:30
**Mode:** Full Analysis
**Test Framework:** Vitest v4.0.16
**Agent:** Test Plan Agent

---

## Executive Summary

| Metric | Previous (Jan 14) | Current | Change | Status |
|--------|-------------------|---------|--------|--------|
| Test Suites | 65 | 80 | +15 | Improved |
| Total Tests | 1,467 | 2,487 | +1,020 | Improved |
| Passing Tests | 1,418 | 2,487 | +1,069 | 100% passing |
| Failing Tests | 49 | 0 | -49 | All fixed |
| Todo Tests | 22 | 0 | -22 | All implemented |
| Statement Coverage | ~60% | 64.63% | +4.63% | Improved |

### Test Health Summary

| Category | Count | Percentage |
|----------|-------|------------|
| :white_check_mark: Passing | 2,487 | 100% |
| :x: Failing | 0 | 0% |
| :construction: Todo/Skipped | 0 | 0% |
| **Total** | 2,487 | - |

---

## Coverage by Module

### Overall Coverage

| Metric | Value | Target | Gap |
|--------|-------|--------|-----|
| Statements | 64.63% | 80% | 15.37% |
| Branches | 56.72% | 75% | 18.28% |
| Functions | 65.94% | 80% | 14.06% |
| Lines | 65.12% | 80% | 14.88% |

---

## Coverage by Feature Area

### CRITICAL Priority (Core Business Features)

| Module | Statements | Branches | Functions | Status |
|--------|------------|----------|-----------|--------|
| **lib/services** | 79.56% | 63.07% | 79.34% | :white_check_mark: Good |
| **lib/repositories** | 51.32% | 41.52% | 60.00% | :warning: Below target |
| **lib/sync** | 88.75% | 82.06% | 96.55% | :white_check_mark: Excellent |
| **lib/migration** | 92.52% | 89.61% | 85.29% | :white_check_mark: Excellent |
| **hooks** | 68.46% | 73.33% | 68.14% | :warning: Below target |

### HIGH Priority (Platform Integrations)

| Module | Statements | Branches | Functions | Status |
|--------|------------|----------|-----------|--------|
| **lib/amazon** | 23.14% | 20.66% | 23.42% | :x: Critical gap |
| **lib/ebay** | 46.86% | 41.71% | 46.90% | :warning: Below target |
| **lib/bricklink** | 100.00% | 95.65% | 100.00% | :white_check_mark: Excellent |
| **lib/brickowl** | 100.00% | 97.29% | 100.00% | :white_check_mark: Excellent |
| **lib/bricqer** | 89.59% | 72.35% | 90.62% | :white_check_mark: Good |
| **lib/paypal** | 93.50% | 82.89% | 92.00% | :white_check_mark: Excellent |
| **lib/monzo** | 95.21% | 82.78% | 93.33% | :white_check_mark: Excellent |

### MEDIUM Priority (Supporting Features)

| Module | Statements | Branches | Functions | Status |
|--------|------------|----------|-----------|--------|
| **lib/listing-assistant** | 97.83% | 94.00% | 100.00% | :white_check_mark: Excellent |
| **lib/platform-stock** | 92.00%+ | 80.00%+ | 90.00%+ | :white_check_mark: Good |
| **lib/arbitrage** | 58.76% | 55.26% | 75.00% | :warning: Below target |
| **lib/purchase-evaluator** | 64.40% | 66.12% | 62.30% | :warning: Below target |
| **lib/ai** | 97.22% | 88.05% | 100.00% | :white_check_mark: Excellent |
| **lib/google** | 97.41% | 77.10% | 100.00% | :white_check_mark: Excellent |

### LOW Priority (Infrastructure)

| Module | Statements | Branches | Functions | Status |
|--------|------------|----------|-----------|--------|
| **lib/brickset** | 1.11% | 0.00% | 0.00% | :x: Critical gap |
| **lib/crypto** | 20.51% | 0.00% | 0.00% | :x: Critical gap |
| **components/ui** | 95.65% | 84.61% | 90.90% | :white_check_mark: Excellent |

---

## Detailed Gap Analysis

### CRITICAL Gaps (Require Immediate Attention)

#### GAP-001: Amazon Core Services (23.14% coverage)

**Files affected:**
- `amazon-catalog.client.ts` - 6.18%
- `amazon-feeds.client.ts` - 6.08%
- `amazon-reports.client.ts` - 3.81%
- `amazon-listings.client.ts` - 4.04%
- `order-sync.service.ts` - 0%

**Impact:** Core Amazon integration functionality is untested
**Tests needed:** ~45 tests
**Priority:** CRITICAL

#### GAP-002: Brickset API (1.11% coverage)

**Files affected:**
- `brickset-api.ts` - 1.40%
- `brickset-cache.service.ts` - 0.97%

**Impact:** Set data lookup and caching untested
**Tests needed:** ~25 tests
**Priority:** CRITICAL

---

### HIGH Gaps

#### GAP-003: eBay Services (46.86% coverage)

**Files below target:**
- `ebay-auth.service.ts` - 10.23%
- `ebay-browse.client.ts` - 9.09%
- `ebay-listing.client.ts` - 2.94%
- `ebay-fulfilment.service.ts` - 1.29%
- `ebay-order-sync.service.ts` - 16.58%

**Tests needed:** ~40 tests
**Priority:** HIGH

#### GAP-004: Crypto Encryption (20.51% coverage)

**File:** `encryption.ts` - 20.51%

**Tests needed:** ~15 tests
**Priority:** HIGH (security-sensitive)

#### GAP-005: Arbitrage Mapping (28.04% coverage)

**File:** `mapping.service.ts` - 28.04%

**Tests needed:** ~20 tests
**Priority:** HIGH

---

### MEDIUM Gaps

#### GAP-006: Inventory Hook (36.95% coverage)

**File:** `use-inventory.ts`

**Tests needed:** ~25 tests
**Priority:** MEDIUM

#### GAP-007: Reports Hook (66.30% coverage)

**File:** `use-reports.ts`

**Tests needed:** ~15 tests
**Priority:** MEDIUM

---

### LOW Gaps

#### GAP-008: Purchase Evaluator Service (31.86% coverage)

**Files:**
- `evaluator.service.ts` - 31.86%
- `pricing.service.ts` - 1.25%

**Tests needed:** ~30 tests
**Priority:** LOW

#### GAP-009: API Integration Routes (0% coverage)

**Files:** `src/app/api/integrations/**/*.ts`, `src/app/api/reports/**/*.ts`

**Tests needed:** ~50 tests
**Priority:** LOW

---

## Test File Coverage

| Area | Source Files | Test Files | Coverage |
|------|--------------|------------|----------|
| Services | 21 | 21 | 100% |
| Repositories | 7 | 7 | 100% |
| Platform Adapters | 6 | 6 | 100% |
| Sync/Migration | 7 | 6 | 86% |
| Hooks | 5 | 1 | 20% |
| AI/Prompts | 8 | 3 | 38% |
| API Routes | 97 | 12 | 12% |
| **Total** | 151 | 80 | 53% |

---

## Recommendations

### Immediate Actions (This Week)

1. **Add Amazon core client tests** (GAP-001)
   - Command: `/test-build feature:amazon`
   - Expected: 45 new tests
   - Impact: +10% overall coverage

2. **Add Brickset API tests** (GAP-002)
   - Command: `/test-build feature:brickset`
   - Expected: 25 new tests
   - Impact: +2% overall coverage

### Short-term Actions (Next 2 Weeks)

3. **Improve eBay service coverage** (GAP-003)
   - Command: `/test-build feature:ebay`
   - Expected: 40 new tests

4. **Add encryption tests** (GAP-004)
   - Command: `/test-build feature:crypto`
   - Expected: 15 new tests

5. **Add arbitrage mapping tests** (GAP-005)
   - Focus on `mapping.service.ts`
   - Expected: 20 new tests

### Medium-term Actions (Next Sprint)

6. **Add React hook tests** (GAP-006, GAP-007)
   - Requires RTL/testing-library setup
   - Expected: 40 new tests

### Backlog

7. **Purchase evaluator tests** (GAP-008)
8. **API integration tests** (GAP-009)

---

## Quick Reference Order

| Step | Command | Fixes | Tests |
|------|---------|-------|-------|
| 1 | `/test-build feature:amazon` | GAP-001 | ~45 |
| 2 | `/test-build feature:brickset` | GAP-002 | ~25 |
| 3 | `/test-execute quick` | Verify | - |
| 4 | `/test-build feature:ebay` | GAP-003 | ~40 |
| 5 | `/test-build feature:crypto` | GAP-004 | ~15 |
| 6 | `/test-build feature:arbitrage` | GAP-005 | ~20 |
| 7 | `/test-execute quick` | Verify | - |
| 8 | `/test-build feature:hooks` | GAP-006, GAP-007 | ~40 |
| 9 | `/test-build feature:purchase-evaluator` | GAP-008 | ~30 |
| 10 | `/test-build feature:api-routes` | GAP-009 | ~50 |
| 11 | `/test-execute pre-merge` | Final validation | - |
| 12 | `/test-plan coverage` | Updated report | - |

Start with step 1 (`/test-build feature:amazon`) to address the largest coverage gap.

---

## Trend Analysis

### Progress Since Jan 14

| Metric | Jan 14 | Jan 15 | Change |
|--------|--------|--------|--------|
| Test Files | 65 | 80 | +15 (+23%) |
| Total Tests | 1,467 | 2,487 | +1,020 (+70%) |
| Failing | 49 | 0 | -49 (-100%) |
| Todo | 22 | 0 | -22 (-100%) |
| Pass Rate | 89.2% | 100% | +10.8% |

**Key Improvements:**
- All 49 previously failing tests now pass
- All 22 todo tests now implemented
- Test count increased by 70%
- 100% pass rate achieved

**Remaining Work:**
- Statement coverage needs to increase from 64.63% to 80% (15.37% gap)
- ~265 additional tests needed across 9 identified gaps

---

## Manifest Generated

Test manifest saved to: `docs/testing/registry/test-manifest-2026-01-15.json`

---

*Report generated by Test Plan Agent - 2026-01-15*
