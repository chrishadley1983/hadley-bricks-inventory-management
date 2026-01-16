# Performance Agent Specification

**Version:** 1.0  
**Type:** Analyser (Initializer Agent)  
**Command:** `/performance <mode>`  
**Project:** Hadley Bricks Inventory Management System

---

## Table of Contents

1. [Overview](#1-overview)
2. [Design Principles](#2-design-principles)
3. [Modes](#3-modes)
4. [Standard Boot Sequence](#4-standard-boot-sequence)
5. [Phase 1: UI Performance Analysis](#5-phase-1-ui-performance-analysis)
6. [Phase 2: Query Performance Analysis](#6-phase-2-query-performance-analysis)
7. [Phase 3: Bundle Analysis](#7-phase-3-bundle-analysis)
8. [Phase 4: API Performance Analysis](#8-phase-4-api-performance-analysis)
9. [Phase 5: Memory & Runtime Analysis](#9-phase-5-memory--runtime-analysis)
10. [Phase 6: Report Generation](#10-phase-6-report-generation)
11. [State Management](#11-state-management)
12. [Error Handling](#12-error-handling)
13. [Hadley Bricks Specific Concerns](#13-hadley-bricks-specific-concerns)
14. [Output Templates](#14-output-templates)
15. [Handoffs to Other Agents](#15-handoffs-to-other-agents)

---

## 1. Overview

### 1.1 Purpose

The Performance Agent analyses application performance across multiple dimensions: UI rendering, database queries, API response times, bundle sizes, and runtime behaviour. It produces actionable reports with specific recommendations, severity ratings, and estimated impact.

### 1.2 Why an Agent?

Performance analysis requires:
- Scanning entire codebase for patterns
- Running profiling tools and interpreting results
- Correlating multiple data sources (Supabase, Vercel, bundle stats)
- Making prioritised recommendations
- Tracking performance over time (regression detection)

This is too complex for a single prompt and benefits from persistent state tracking.

### 1.3 Agent Classification

| Property | Value |
|----------|-------|
| Type | Analyser (Initializer) |
| Modifies Code | No (reports only) |
| Requires Running App | Yes (for some modes) |
| State Tracking | Yes |
| Human Approval | Not required |

### 1.4 Interactions

| Agent | Direction | When |
|-------|-----------|------|
| **Code Review Agent** | ← reads from | Check if performance issues flagged |
| **Test Plan Agent** | → outputs to | Recommend performance tests |
| **Test Build Agent** | → outputs to | Generate performance test specs |

---

## 2. Design Principles

This agent follows the **Domain Memory Pattern** 5 Rules:

1. **Externalise the Goal** - Performance baselines and thresholds in config
2. **Atomic Progress** - Analyse one mode fully before moving to next
3. **Clean Campsite** - Leave comprehensive reports, not partial analysis
4. **Standard Boot-up** - Always check what changed since last run
5. **Tests as Truth** - Link recommendations to measurable metrics

---

## 3. Modes

| Mode | Scope | Description | App Required |
|------|-------|-------------|--------------|
| `full` | Comprehensive | All analysis phases | Yes |
| `ui` | UI Only | React rendering, component perf | Yes |
| `query` | Database Only | Supabase queries, indexes | No |
| `bundle` | Build Only | Bundle size, code splitting | No |
| `api` | API Only | Route response times, N+1 detection | Yes |
| `memory` | Runtime Only | Memory leaks, GC pressure | Yes |
| `quick` | Fast Scan | Static analysis only, no runtime | No |
| `compare` | Regression | Compare current vs baseline | Yes |
| `focus:<path>` | Targeted | Analyse specific file/directory | Depends |

### Mode Selection Guide

```
Need to investigate specific slowness? → focus:<path>
Pre-merge check? → quick
Comprehensive audit? → full
User reporting slow pages? → ui
Dashboard queries slow? → query
Build times increasing? → bundle
API timeouts occurring? → api
Memory warnings in production? → memory
After optimisation work? → compare
```

---

## 4. Standard Boot Sequence

**MANDATORY: Execute before any analysis.**

### 4.0 Read Agent Spec
```powershell
cat docs/agents/performance/spec.md
```
Confirm operating parameters.

### 4.1 Read Core Context
```powershell
cat CLAUDE.md
```
Extract: Performance baselines, known issues, critical paths.

### 4.2 Read Agent State
```powershell
cat docs/agents/performance/state.json
```
Extract: lastRun, lastCommit, previousMetrics, knownIssues, baselines.

### 4.3 Detect Changes Since Last Run
```powershell
# Get commits since last run
git log <lastCommit>..HEAD --oneline

# Get changed files
git diff --name-only <lastCommit>..HEAD
```

### 4.4 Identify Affected Areas

Map changed files to performance domains:

| File Pattern | Performance Domain |
|--------------|-------------------|
| `app/**/page.tsx` | UI rendering |
| `components/**` | UI rendering |
| `lib/repositories/**` | Query performance |
| `lib/services/**` | API/business logic |
| `app/api/**` | API performance |
| `package.json` | Bundle size |
| `*.sql`, `migrations/**` | Database performance |

### 4.5 Read Performance Config
```powershell
cat docs/agents/performance/config.json
```
Load: thresholds, baselines, exclusions, focus areas.

### 4.6 Report Boot Status

```markdown
## Performance Agent - Boot Complete

**Last run:** [X days ago / never]
**Mode:** [selected mode]
**Commits since:** [N]

### Changed Domains
- UI: [N files changed]
- Queries: [N files changed]
- API: [N files changed]

### Previous Issues (Unresolved)
1. [Issue from last run if still present]

### Focus Areas (from config)
- [Critical paths configured for monitoring]

**Proceeding with analysis...**
```

---

## 5. Phase 1: UI Performance Analysis

**Trigger:** Modes `full`, `ui`, `focus:<ui-path>`

### 5.1 Static Analysis

Scan for known performance anti-patterns:

```powershell
# Find all page and component files
Get-ChildItem -Path "apps/web" -Recurse -Include "*.tsx","*.ts" | Select-Object FullName
```

#### Anti-Pattern Detection

| Pattern | Severity | Detection Method |
|---------|----------|-----------------|
| Missing `React.memo()` on list items | HIGH | AST scan for map() without memo |
| Inline function props | MEDIUM | Regex for `onClick={() =>` in JSX |
| Missing `key` prop in lists | HIGH | ESLint rule check |
| Large component files (>500 lines) | MEDIUM | Line count |
| Unnecessary re-renders | HIGH | Check for objects/arrays in deps |
| Missing `useMemo`/`useCallback` | MEDIUM | Expensive ops without memoization |
| Synchronous state updates in loops | CRITICAL | Pattern detection |
| Missing loading states | MEDIUM | Check for Suspense/loading.tsx |
| Unoptimised images | MEDIUM | Check for `next/image` usage |
| Client components with server data | HIGH | 'use client' with direct Supabase |

### 5.2 Runtime Profiling (if app running)

```powershell
# Check if dev server is running
$webCheck = Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing -TimeoutSec 5 -ErrorAction SilentlyContinue
```

If running, profile key pages:

| Page | Expected Load Time | Check |
|------|-------------------|-------|
| `/dashboard` | < 2s | Initial render time |
| `/inventory` | < 3s | With 650+ items |
| `/purchases` | < 2s | Table rendering |
| `/listings` | < 3s | eBay/BrickLink data |

### 5.3 TanStack Query Analysis

Check for query performance patterns:

```typescript
// Look for these patterns in hooks
const query = useQuery({
  queryKey: [...],
  staleTime: ???,        // Should be defined
  gcTime: ???,           // Should be defined  
  refetchOnWindowFocus: ???, // Often should be false
  enabled: ???,          // Should prevent unnecessary fetches
})
```

#### TanStack Query Issues to Flag

| Issue | Severity | Detection |
|-------|----------|-----------|
| Missing `staleTime` | MEDIUM | Default causes refetches |
| `refetchOnWindowFocus: true` for static data | LOW | Unnecessary requests |
| Missing `enabled` condition | MEDIUM | Queries fire prematurely |
| No error boundaries | MEDIUM | Crashes on query failure |
| Duplicate query keys | HIGH | Cache misses |
| Overly broad invalidation | MEDIUM | `invalidateQueries([''])` |

### 5.4 Zustand Store Analysis

Check client state management:

| Issue | Severity | Detection |
|-------|----------|-----------|
| Large store slices | MEDIUM | Store size > 100KB |
| Missing selectors | HIGH | Components subscribing to entire store |
| Derived state not memoized | MEDIUM | Computations in render |
| Persist middleware on large stores | MEDIUM | localStorage bloat |

### 5.5 Output: UI Performance Report

```markdown
## UI Performance Analysis

**Scan completed:** [timestamp]
**Files analysed:** [N]
**Issues found:** [N]

### Critical Issues (Fix Immediately)
| Location | Issue | Impact | Recommendation |
|----------|-------|--------|----------------|
| `components/inventory/InventoryTable.tsx:145` | 650 rows rendering without virtualisation | Severe lag on inventory page | Implement `@tanstack/react-virtual` |

### High Priority Issues
...

### Medium Priority Issues
...

### Performance Scores
| Metric | Current | Baseline | Status |
|--------|---------|----------|--------|
| Largest Contentful Paint | 3.2s | 2.5s | ⚠️ DEGRADED |
| Time to Interactive | 4.1s | 3.0s | 🔴 CRITICAL |
| Component Count | 89 | 75 | ℹ️ INFO |
```

---

## 6. Phase 2: Query Performance Analysis

**Trigger:** Modes `full`, `query`, `focus:<repository-path>`

### 6.1 Repository Pattern Scan

Hadley Bricks uses repository pattern. Scan all repositories:

```powershell
Get-ChildItem -Path "apps/web/lib/repositories" -Recurse -Include "*.ts"
```

#### Query Anti-Patterns

| Pattern | Severity | Detection |
|---------|----------|-----------|
| N+1 queries | CRITICAL | Loop containing await supabase |
| Missing `.select()` columns | HIGH | `select('*')` on large tables |
| No pagination | HIGH | Missing `.range()` on list queries |
| Missing indexes (inferred) | HIGH | Filter on non-indexed column |
| Unnecessary joins | MEDIUM | `.select('*, table(*)') ` when not needed |
| No `.single()` for unique lookups | LOW | `.eq('id', x)` without `.single()` |
| RPC without caching | MEDIUM | Complex RPC called repeatedly |

### 6.2 Supabase Query Extraction

Extract all Supabase queries and analyse:

```typescript
// Pattern to find
supabase
  .from('table_name')
  .select('columns')
  .eq/filter/match(...)
  .order(...)
  .range(...)
```

Build query inventory:

| Repository | Method | Table(s) | Estimated Rows | Has Index | Pagination |
|------------|--------|----------|----------------|-----------|------------|
| `inventoryRepository` | `getAll()` | inventory_items | 650+ | ⚠️ Check | ❌ No |
| `purchaseRepository` | `getByMonth()` | purchases | 1000+ | ✅ Yes | ✅ Yes |

### 6.3 Slow Query Detection

For each query, estimate performance:

| Factor | Weight | Check |
|--------|--------|-------|
| Table size | HIGH | > 1000 rows without pagination |
| Join complexity | HIGH | > 2 joins |
| Filter on non-indexed | HIGH | Check schema for indexes |
| ORDER BY on non-indexed | MEDIUM | Check schema |
| SELECT * | MEDIUM | Fetching unnecessary columns |

### 6.4 Google Sheets Integration Analysis

**Hadley Bricks Specific:** Currently uses Sheets-primary architecture.

```powershell
# Find all Google Sheets service calls
Select-String -Path "apps/web/**/*.ts" -Pattern "sheetsService|googleSheets|spreadsheetId" -Recurse
```

| Issue | Severity | Detection |
|-------|----------|-----------|
| No caching of Sheets data | CRITICAL | Direct reads without TTL |
| Synchronous Sheets writes blocking UI | HIGH | await sheets.update in handlers |
| Full sheet reads instead of ranges | MEDIUM | getValues() without range |
| Missing retry logic | MEDIUM | No exponential backoff |

### 6.5 Output: Query Performance Report

```markdown
## Query Performance Analysis

**Repositories scanned:** [N]
**Queries analysed:** [N]
**Issues found:** [N]

### Critical: N+1 Query Detected
**Location:** `lib/repositories/inventoryRepository.ts:78`
**Pattern:**
```typescript
// Current (N+1)
const items = await getInventoryItems();
for (const item of items) {
  const platform = await getPlatformData(item.platformId); // ❌ N queries!
}
```
**Recommendation:**
```typescript
// Fixed (single query with join)
const items = await supabase
  .from('inventory_items')
  .select('*, platforms(*)') // ✅ Single query
```
**Estimated Impact:** 650 queries → 1 query

### Slow Queries (> 500ms estimated)
| Query | Table | Est. Time | Issue |
|-------|-------|-----------|-------|
| `getInventoryItems()` | inventory_items | ~2s | No pagination, 650 rows |
| `getListings()` | listings | ~1.5s | SELECT *, joins |

### Missing Indexes (Inferred)
| Table | Column | Query Using It |
|-------|--------|----------------|
| `purchases` | `date` | `getByDateRange()` |
| `inventory_items` | `bricklink_id` | `findByBricklinkId()` |

### Google Sheets Performance
| Operation | Current Latency | Recommendation |
|-----------|----------------|----------------|
| Inventory sync | ~5s | Add 5-min cache TTL |
| Purchase write | Blocking | Make async with queue |
```

---

## 7. Phase 3: Bundle Analysis

**Trigger:** Modes `full`, `bundle`, `quick`

### 7.1 Build Analysis

```powershell
cd apps/web
npm run build
```

Parse build output for:
- Total bundle size
- Per-route sizes
- Shared chunks
- Dynamic imports

### 7.2 Dependency Analysis

```powershell
# Check for heavy dependencies
npx @next/bundle-analyzer

# Or manual check
cat package.json | Select-String "dependencies" -Context 0,50
```

#### Heavy Dependency Detection

| Package | Typical Size | Check |
|---------|-------------|-------|
| `moment` | 300KB | Recommend `date-fns` or `dayjs` |
| `lodash` | 70KB | Use specific imports `lodash/get` |
| Full icon libraries | 500KB+ | Tree-shake or use specific icons |
| `xlsx` | 400KB | Consider lazy loading |
| Unused dependencies | Varies | Check imports vs package.json |

### 7.3 Code Splitting Analysis

Check for proper dynamic imports:

```typescript
// Good - dynamic import
const HeavyComponent = dynamic(() => import('./HeavyComponent'))

// Bad - static import of heavy module
import { HeavyComponent } from './HeavyComponent'
```

#### Pages to Check for Splitting

| Page | Heavy Dependencies | Should Lazy Load |
|------|-------------------|------------------|
| `/reports` | Chart libraries | ✅ Yes |
| `/import` | CSV/XLSX parsers | ✅ Yes |
| `/listings/[id]/edit` | Rich text editor | ✅ Yes |

### 7.4 Output: Bundle Analysis Report

```markdown
## Bundle Analysis

**Build completed:** [timestamp]
**Total size:** [X] KB (gzipped)
**Baseline:** [Y] KB
**Status:** [🟢 OK | ⚠️ WARNING | 🔴 CRITICAL]

### Route Sizes
| Route | Size | Status |
|-------|------|--------|
| `/` | 85KB | 🟢 OK |
| `/inventory` | 250KB | ⚠️ Large |
| `/reports` | 180KB | 🟢 OK |

### Heavy Dependencies
| Package | Size | Used In | Recommendation |
|---------|------|---------|----------------|
| `xlsx` | 412KB | /import | Lazy load |
| `recharts` | 180KB | /reports | Lazy load |

### Code Splitting Opportunities
1. `apps/web/app/import/page.tsx` - XLSX parser not dynamically imported
2. `apps/web/components/charts/*` - Could be lazy loaded

### Tree Shaking Issues
- `lodash` imported as full package (use `lodash-es` or specific imports)
```

---

## 8. Phase 4: API Performance Analysis

**Trigger:** Modes `full`, `api`, `focus:<api-path>`

### 8.1 API Route Inventory

```powershell
Get-ChildItem -Path "apps/web/app/api" -Recurse -Include "route.ts" | Measure-Object
# Result: 182 API routes
```

### 8.2 Static Analysis of Routes

For each API route, check:

| Check | Severity | Detection |
|-------|----------|-----------|
| No error handling | HIGH | Missing try/catch |
| No input validation | HIGH | Missing Zod schema |
| N+1 in handler | CRITICAL | Loop with await |
| No response caching | MEDIUM | GET without cache headers |
| Large response payloads | MEDIUM | No pagination, no field selection |
| Sequential external calls | HIGH | Multiple await without Promise.all |
| Missing timeout handling | MEDIUM | External API calls without timeout |

### 8.3 Runtime Profiling (if app running)

Test critical API endpoints:

```powershell
# Measure response times
$endpoints = @(
  "/api/inventory",
  "/api/purchases",
  "/api/listings",
  "/api/ebay/orders",
  "/api/sheets/sync"
)

foreach ($endpoint in $endpoints) {
  $time = Measure-Command { 
    Invoke-WebRequest -Uri "http://localhost:3000$endpoint" -UseBasicParsing 
  }
  Write-Output "$endpoint : $($time.TotalMilliseconds)ms"
}
```

#### Performance Thresholds

| Endpoint Type | Target | Warning | Critical |
|---------------|--------|---------|----------|
| Simple CRUD | < 200ms | < 500ms | > 1s |
| List with pagination | < 500ms | < 1s | > 2s |
| External API integration | < 2s | < 5s | > 10s |
| Report generation | < 5s | < 10s | > 30s |

### 8.4 External Integration Analysis

**Hadley Bricks Specific:** Multiple external APIs.

| Integration | File Pattern | Performance Concerns |
|-------------|-------------|---------------------|
| eBay API | `lib/services/ebay*` | OAuth refresh, rate limits |
| BrickLink API | `lib/services/bricklink*` | OAuth 1.0a overhead |
| Amazon | `lib/services/amazon*` | CSV processing time |
| Google Sheets | `lib/services/sheets*` | API quota, latency |
| PayPal/Monzo | `lib/services/payment*` | Reconciliation time |

### 8.5 Output: API Performance Report

```markdown
## API Performance Analysis

**Routes analysed:** 182
**Runtime tests:** [N endpoints]
**Issues found:** [N]

### Critical: Slow Endpoints (> 2s)
| Endpoint | Avg Response | Issue |
|----------|-------------|-------|
| `GET /api/inventory` | 3.2s | No pagination, 650 items |
| `POST /api/sheets/sync` | 8.5s | Synchronous full sync |
| `GET /api/ebay/orders` | 4.1s | Sequential API calls |

### N+1 Patterns Detected
| Route | Pattern | Estimated Extra Queries |
|-------|---------|------------------------|
| `/api/listings/[id]` | Loop fetching platform data | 5-10 |

### External API Concerns
| Service | Issue | Recommendation |
|---------|-------|----------------|
| Google Sheets | No request batching | Batch reads/writes |
| eBay | Sequential order fetches | Use bulk endpoints |

### Caching Opportunities
| Endpoint | Current | Recommendation |
|----------|---------|----------------|
| `/api/brickset/sets` | No cache | Cache 24h (static data) |
| `/api/ebay/categories` | No cache | Cache 1h |
```

---

## 9. Phase 5: Memory & Runtime Analysis

**Trigger:** Modes `full`, `memory`

### 9.1 Memory Leak Detection Patterns

Scan for common leak sources:

| Pattern | Severity | Detection |
|---------|----------|-----------|
| Event listeners not removed | HIGH | addEventListener without cleanup |
| Intervals not cleared | HIGH | setInterval without clearInterval |
| Subscriptions not unsubscribed | HIGH | Supabase realtime without cleanup |
| Large arrays accumulated | MEDIUM | Array push without bounds |
| Closures retaining references | MEDIUM | Complex closure analysis |

### 9.2 React-Specific Memory Issues

| Issue | Detection |
|-------|-----------|
| Missing useEffect cleanup | useEffect without return function |
| Stale closure in callbacks | Deps array issues |
| Refs not nullified | useRef retaining DOM |

### 9.3 Zustand Store Memory

Check store sizes and persistence:

```typescript
// Check for large persisted stores
const useStore = create(
  persist(
    (set) => ({
      // Large data here?
      items: [], // Could grow unbounded
    }),
    { name: 'store-name' }
  )
)
```

### 9.4 Output: Memory Analysis Report

```markdown
## Memory & Runtime Analysis

**Files scanned:** [N]
**Potential leaks:** [N]

### Memory Leak Risks
| Location | Pattern | Severity |
|----------|---------|----------|
| `components/RealtimeInventory.tsx` | Supabase subscription without cleanup | HIGH |
| `hooks/usePolling.ts` | setInterval without clear on unmount | HIGH |

### Store Analysis
| Store | Estimated Size | Persisted | Risk |
|-------|---------------|-----------|------|
| `inventoryStore` | ~500KB | Yes | ⚠️ Large persist |
| `uiStore` | ~5KB | No | 🟢 OK |

### Recommendations
1. Add cleanup function to RealtimeInventory useEffect
2. Consider IndexedDB for large persisted data instead of localStorage
```

---

## 10. Phase 6: Report Generation

### 10.1 Aggregate Findings

Combine all phase outputs into single report.

### 10.2 Prioritisation Matrix

Score each issue:

| Factor | Weight |
|--------|--------|
| User impact | 40% |
| Fix complexity | 20% |
| Frequency of occurrence | 20% |
| Risk of regression | 20% |

### 10.3 Generate Action Plan

```markdown
## Performance Action Plan

### Immediate Actions (This Sprint)
| # | Issue | Location | Est. Effort | Impact |
|---|-------|----------|-------------|--------|
| 1 | Add virtualisation to inventory table | InventoryTable.tsx | 4h | HIGH |
| 2 | Implement query pagination | inventoryRepository.ts | 2h | HIGH |
| 3 | Add Sheets caching | sheetsService.ts | 3h | HIGH |

### Short Term (Next 2 Sprints)
...

### Long Term (Backlog)
...

### Metrics to Track
| Metric | Current | Target | Measure |
|--------|---------|--------|---------|
| Inventory page load | 4.2s | < 2s | Lighthouse |
| API avg response | 1.8s | < 500ms | Custom logging |
| Bundle size | 1.2MB | < 800KB | Build output |
```

### 10.4 Write Report

```powershell
# Write to standard location
$reportPath = "docs/agents/performance/reports/$(Get-Date -Format 'yyyy-MM-dd-HHmm')-performance-report.md"
```

---

## 11. State Management

### 11.1 Directory Structure

```
docs/
└── agents/
    └── performance/
        ├── spec.md                 # This document
        ├── state.json              # Agent state
        ├── config.json             # Thresholds and baselines
        └── reports/
            ├── 2026-01-16-1400-performance-report.md
            └── baselines/
                └── baseline-2026-01-01.json
```

### 11.2 State File Schema

```json
{
  "agent": "performance",
  "lastRun": "2026-01-16T14:00:00Z",
  "lastCommit": "abc123",
  "lastMode": "full",
  "status": "success",
  "metrics": {
    "filesAnalysed": 668,
    "issuesFound": 23,
    "criticalIssues": 5,
    "estimatedDebt": "40 hours"
  },
  "baselines": {
    "bundleSize": 850000,
    "lcpTarget": 2500,
    "apiAvgResponse": 500
  },
  "knownIssues": [
    {
      "id": "PERF-001",
      "description": "Inventory table lacks virtualisation",
      "severity": "CRITICAL",
      "firstDetected": "2026-01-10",
      "status": "OPEN"
    }
  ],
  "previousReports": [
    "docs/agents/performance/reports/2026-01-10-performance-report.md"
  ]
}
```

### 11.3 Config File Schema

```json
{
  "thresholds": {
    "bundleSizeWarning": 800000,
    "bundleSizeCritical": 1200000,
    "apiResponseWarning": 1000,
    "apiResponseCritical": 3000,
    "queryRowsWarning": 100,
    "queryRowsCritical": 500,
    "componentLinesWarning": 300,
    "componentLinesCritical": 500
  },
  "exclusions": {
    "paths": ["node_modules", ".next", "dist"],
    "files": ["*.test.ts", "*.spec.ts"]
  },
  "focusAreas": [
    "apps/web/app/(dashboard)/inventory/**",
    "apps/web/lib/repositories/**",
    "apps/web/app/api/sheets/**"
  ],
  "criticalPaths": [
    "/dashboard",
    "/inventory",
    "/purchases"
  ]
}
```

---

## 12. Error Handling

| Error | Action |
|-------|--------|
| Build fails | Report build errors, suggest `/code-review` |
| App not running (for runtime modes) | Switch to static-only analysis, warn user |
| Supabase connection fails | Skip query profiling, note in report |
| Previous state missing | Run as first-time (no baseline comparison) |
| Config missing | Use defaults, create template config |
| Git not clean | Warn but proceed |

---

## 13. Hadley Bricks Specific Concerns

### 13.1 Known Performance Pain Points

Based on project analysis:

| Area | Issue | Priority |
|------|-------|----------|
| **Inventory Table** | 650+ items rendering without virtualisation | CRITICAL |
| **Google Sheets Sync** | Blocking operations, no caching | CRITICAL |
| **eBay API Integration** | Sequential calls, no batching | HIGH |
| **Dashboard** | Multiple queries on page load | HIGH |
| **45+ Supabase Tables** | Complex joins, missing indexes | MEDIUM |

### 13.2 Architecture-Specific Checks

**Sheets-Primary Pattern:**
- Check TTL on Supabase cache (should be 5 min)
- Verify dual-write is non-blocking for Supabase
- Ensure Sheets → Supabase sync is efficient

**Monorepo Considerations:**
- Check `packages/database` type generation isn't slow
- Verify `packages/shared` isn't bloating bundles
- Check workspace dependency hoisting

### 13.3 External Integration Performance

| Integration | Typical Latency | Concern |
|-------------|----------------|---------|
| eBay OAuth refresh | 500ms-2s | Cache tokens properly |
| BrickLink OAuth 1.0a | 300ms-1s | Signature computation overhead |
| Google Sheets read | 1-5s | Batch and cache |
| Supabase Cloud | 50-200ms | Check RLS policy overhead |

---

## 14. Output Templates

### 14.1 Summary Format (for quick mode)

```markdown
## Performance Quick Scan - [Date]

**Status:** 🔴 CRITICAL / ⚠️ WARNING / 🟢 OK

### Top 3 Issues
1. [Critical issue 1]
2. [Critical issue 2]  
3. [High priority issue]

### Metrics vs Baseline
| Metric | Current | Baseline | Δ |
|--------|---------|----------|---|
| Bundle | X KB | Y KB | +Z% |

**Run `/performance full` for detailed analysis.**
```

### 14.2 Full Report Format

See Phase 6 for complete structure.

---

## 15. Handoffs to Other Agents

### 15.1 To Test Plan Agent

When performance analysis reveals areas needing performance tests:

```markdown
## Performance → Test Plan Handoff

The following areas require performance test coverage:

### Recommended Performance Tests
1. **Inventory Load Test**
   - Scenario: Load 1000 inventory items
   - Target: < 2s render time
   - File: `apps/web/app/(dashboard)/inventory/page.tsx`

2. **API Response Time Test**
   - Endpoints: /api/inventory, /api/purchases
   - Target: < 500ms p95
   - Pattern: Use k6 or similar

Include in: `docs/testing/analysis/coverage-analysis.md`
```

### 15.2 To Code Review Agent

Flag performance concerns for code review:

```markdown
## Performance Concerns for Code Review

The Performance Agent has identified these patterns to watch for:

### Block on Review
- [ ] New queries without pagination
- [ ] Static imports of heavy libraries
- [ ] Missing cleanup in useEffect

### Warn on Review
- [ ] Components > 300 lines
- [ ] Inline function props
- [ ] Object literals in dependency arrays
```

---

## Appendix A: Commands Reference

```powershell
# Full analysis
/performance full

# Quick static scan
/performance quick

# Focus on specific area
/performance focus:apps/web/app/(dashboard)/inventory

# UI only
/performance ui

# Query analysis only
/performance query

# Compare to baseline
/performance compare

# Generate baseline
/performance baseline
```

---

## Appendix B: Tool Requirements

| Tool | Purpose | Installation |
|------|---------|--------------|
| Node.js | Build analysis | Required |
| npm | Dependency analysis | Required |
| Git | Change detection | Required |
| PowerShell | Script execution | Windows default |
| @next/bundle-analyzer | Bundle analysis | Optional |
| Lighthouse CI | Web vitals | Optional |

---

## Appendix C: Integration with Vercel/Sentry

If production monitoring is configured:

```powershell
# Pull Vercel Analytics (if configured)
# Pull Sentry performance data (if configured)
```

These can supplement local analysis with real-world data.

---

**End of Performance Agent Specification**
