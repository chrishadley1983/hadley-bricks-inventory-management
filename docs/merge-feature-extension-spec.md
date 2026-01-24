# Merge Feature Agent Extension Spec

## Overview

Extend the existing Merge Feature Agent to include deployment verification capabilities. With Vercel auto-deploy on merge to main, **merge = deploy**, so this agent owns the full "get code to production safely" workflow.

---

## Current State

The agent currently handles:
- Branch merging with `--no-ff`
- Pre-merge verification (commits clean, tests pass, code review done)
- Post-merge verification (TypeScript, lint, tests)
- Branch cleanup
- Merge report generation

---

## What's Being Added

| Capability | Purpose |
|------------|---------|
| **Track detection** | Feature vs Fix — different verification depth |
| **Preview verification** | Test on Vercel preview URL before merge |
| **Post-deploy verification** | Smoke test production after merge |
| **Rollback** | Quick revert if production breaks |
| **Critical path checks** | Business-specific "must work" flows |

---

## New/Modified Modes

### Updated Command Structure

```
/merge-feature <mode> [--track=feature|fix]
```

### Mode Changes

| Mode | Current | Extended |
|------|---------|----------|
| `<branch-name>` | Merge branch | Merge + deploy verification |
| `auto` | Auto-detect branch | Auto-detect branch + track |
| `list` | List unmerged | No change |
| `status` | Merge status | + Last deploy status |
| **`preview`** | — | **NEW: Verify preview URL** |
| **`verify-production`** | — | **NEW: Post-deploy checks** |
| **`rollback`** | — | **NEW: Revert last deploy** |
| **`check`** | — | **NEW: Pre-merge readiness** |

---

## Track Detection

Auto-detect based on branch naming convention:

| Branch Pattern | Track | Verification Level |
|----------------|-------|-------------------|
| `feature/*` | Feature | Full DBT cycle required |
| `fix/*`, `hotfix/*`, `bugfix/*` | Fix | Abbreviated checks |
| `chore/*`, `refactor/*` | Feature | Full cycle (could break things) |
| Other | Feature | Default to full (safer) |

### Track Differences

| Check | Feature Track | Fix Track |
|-------|---------------|-----------|
| Define Done exists | ✅ Required | ❌ Skip |
| Verify Done passed | ✅ Required | ⚡ Verify fix only |
| Test Plan/Build | ✅ Required | ❌ Skip |
| `/test-execute pre-merge` | ✅ Full suite | ⚡ Affected + smoke |
| `/code-review branch` | ✅ Full | ⚡ Quick review |
| Preview verification | ✅ Required | ✅ Required |
| Post-deploy verification | ✅ Required | ✅ Required |

---

## New Mode Specifications

### `/merge-feature check`

**Purpose:** Pre-merge readiness assessment without taking action.

**Process:**
1. Detect track from branch name
2. Check prerequisites based on track
3. Report readiness with clear pass/fail

**Output:**
```
## Merge Readiness: feature/ebay-bulk-listing

Track: FEATURE
Branch: feature/ebay-bulk-listing → main

### Prerequisites
✅ No uncommitted changes
✅ Done criteria exists (docs/done/ebay-bulk-listing.md)
✅ Verify Done passed (2025-01-24)
✅ /test-execute pre-merge passed
✅ /code-review branch completed
✅ Preview URL tested

### Ready to merge
Run: /merge-feature feature/ebay-bulk-listing
```

Or for failures:
```
### Prerequisites
✅ No uncommitted changes
❌ Done criteria missing — run /define-done first
⏭️ Verify Done — blocked by above
✅ /test-execute pre-merge passed
❌ /code-review branch — not found in docs/reviews/

### NOT READY — 2 blockers
```

---

### `/merge-feature preview`

**Purpose:** Verify the Vercel preview deployment before merging.

**Prerequisites:**
- Branch pushed to origin
- Vercel preview URL available

**Process:**
1. Get preview URL from Vercel (pattern: `https://hadley-bricks-inventory-management-git-<branch>.vercel.app`)
2. Wait for deployment ready (poll Vercel or check URL responds)
3. Run critical path checks against preview URL
4. Report results

**Critical Path Checks (Hadley Bricks specific):**

```typescript
// docs/agents/merge-feature/critical-paths.ts
export const criticalPaths = [
  {
    name: 'Dashboard loads',
    path: '/',
    expect: 'page loads without error',
    timeout: 10000,
  },
  {
    name: 'Inventory page loads',
    path: '/inventory',
    expect: 'page loads, data visible',
    timeout: 15000,
  },
  {
    name: 'Orders page loads',
    path: '/orders',
    expect: 'page loads, orders list visible',
    timeout: 15000,
  },
  {
    name: 'Can view single order',
    path: '/orders/[first-order-id]',
    expect: 'order details load',
    timeout: 10000,
  },
];
```

**Output:**
```
## Preview Verification: feature/ebay-bulk-listing

Preview URL: https://hadley-bricks-inventory-management-git-feature-ebay-bulk-listing.vercel.app
Status: ✅ Ready

### Critical Paths
✅ Dashboard loads (1.2s)
✅ Inventory page loads (2.1s)
✅ Orders page loads (1.8s)
✅ Can view single order (0.9s)

### Console Errors
None detected

### Ready for merge
```

---

### `/merge-feature <branch>` (Extended)

**Current behaviour preserved**, with additions:

**Extended Process:**
1. **[NEW]** Detect track (feature/fix)
2. **[NEW]** Run `/merge-feature check` — abort if not ready
3. Pre-merge verification (existing)
4. Fetch latest main (existing)
5. Execute merge with `--no-ff` (existing)
6. Post-merge verification — TypeScript, lint, tests (existing)
7. Push to origin (existing)
8. **[NEW]** Wait for Vercel production deploy
9. **[NEW]** Run post-deploy verification
10. Delete merged branches (existing)
11. Generate merge report (extended)

**Failure Handling:**

If post-deploy verification fails:
```
## ⚠️ POST-DEPLOY VERIFICATION FAILED

Production URL: https://hadley-bricks-inventory-management.vercel.app
Deployment: Successful
Verification: FAILED

### Failures
❌ Orders page loads — timeout after 15s
❌ Can view single order — 500 error

### Recommended Action
Run: /merge-feature rollback

### Manual Recovery
git revert -m 1 HEAD
git push origin main
```

---

### `/merge-feature verify-production`

**Purpose:** Run production verification independently (useful for manual checks).

**Process:**
1. Hit production URL
2. Run all critical path checks
3. Check for console errors
4. Check Sentry for new errors (if configured)
5. Report status

**Output:**
```
## Production Verification

URL: https://hadley-bricks-inventory-management.vercel.app
Checked: 2025-01-24 14:32:00

### Critical Paths
✅ Dashboard loads (0.8s)
✅ Inventory page loads (1.9s)
✅ Orders page loads (1.4s)
✅ Can view single order (0.7s)

### Error Monitoring
No external error monitoring configured

### Status: HEALTHY
```

---

### `/merge-feature rollback`

**Purpose:** Quickly revert the last deployment.

**Process:**
1. Identify last merge commit on main
2. Confirm with user (show what will be reverted)
3. Create revert commit
4. Push to origin (triggers Vercel redeploy)
5. Wait for deploy
6. Run post-deploy verification
7. Report status

**User Confirmation:**
```
## Rollback Confirmation

Last merge: abc1234 "Merge branch 'feature/ebay-bulk-listing'"
Merged: 2025-01-24 14:30:00 (7 minutes ago)
Author: Chris

This will:
1. Create a revert commit on main
2. Push to origin (triggering Vercel redeploy)
3. Verify production after deploy

Type 'confirm' to proceed:
```

**Output after rollback:**
```
## Rollback Complete

Reverted: abc1234 "Merge branch 'feature/ebay-bulk-listing'"
Revert commit: def5678
Production status: ✅ Verified healthy

### Next Steps
1. Investigate what broke on branch feature/ebay-bulk-listing
2. Fix and re-test
3. Merge again when ready
```

---

## Configuration File

Create `docs/agents/merge-feature/config.json`:

```json
{
  "vercel": {
    "productionUrl": "https://hadley-bricks-inventory-management.vercel.app",
    "previewUrlPattern": "https://hadley-bricks-inventory-management-git-{branch}.vercel.app",
    "deployTimeout": 120000
  },
  "verification": {
    "criticalPathsFile": "docs/agents/merge-feature/critical-paths.ts",
    "pageLoadTimeout": 15000,
    "checkConsoleErrors": true,
    "sentryIntegration": false
  },
  "tracks": {
    "feature": {
      "requireDoneCriteria": true,
      "requireVerifyDone": true,
      "requireFullTestSuite": true,
      "requireCodeReview": true
    },
    "fix": {
      "requireDoneCriteria": false,
      "requireVerifyDone": false,
      "requireFullTestSuite": false,
      "requireCodeReview": true
    }
  }
}
```

---

## Updated Output Files

### Merge Report Extension

Current location: `docs/merges/YYYY-MM-DD_<branch>.md`

**Add sections:**

```markdown
## Deployment Verification

### Pre-Merge
- Track: FEATURE
- Preview URL: https://hadley-bricks-inventory-management-git-feature-xxx.vercel.app
- Preview verified: ✅ 2025-01-24 14:25:00

### Post-Merge
- Production URL: https://hadley-bricks-inventory-management.vercel.app
- Deploy completed: 2025-01-24 14:31:00
- Verification: ✅ All critical paths passed

### Critical Path Results
| Path | Status | Time |
|------|--------|------|
| Dashboard | ✅ | 0.8s |
| Inventory | ✅ | 1.9s |
| Orders | ✅ | 1.4s |
| Single Order | ✅ | 0.7s |
```

---

## New Files to Create

| File | Purpose |
|------|---------|
| `docs/agents/merge-feature/config.json` | Agent configuration |
| `docs/agents/merge-feature/critical-paths.ts` | Business-critical paths to verify |
| `docs/agents/merge-feature/last-deploy.json` | Track last deployment for rollback |

### `last-deploy.json` Structure

```json
{
  "commit": "abc1234",
  "branch": "feature/ebay-bulk-listing",
  "mergedAt": "2025-01-24T14:30:00Z",
  "verificationStatus": "passed",
  "criticalPathResults": [
    { "name": "Dashboard loads", "passed": true, "duration": 800 }
  ]
}
```

---

## Implementation Notes

### Preview URL Detection

Options (in order of preference):
1. Vercel CLI: `vercel ls` to get preview URL
2. Construct from pattern: `https://{project}-git-{branch}-{team}.vercel.app`
3. GitHub deployment status API (if connected)

### Waiting for Deploy

Poll strategy:
```typescript
async function waitForDeploy(url: string, timeout: number) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // Not ready yet
    }
    await sleep(5000); // Check every 5 seconds
  }
  throw new Error(`Deploy not ready after ${timeout}ms`);
}
```

### Critical Path Verification

Use Playwright for reliable checks:
```typescript
import { chromium } from 'playwright';

async function verifyCriticalPaths(baseUrl: string, paths: CriticalPath[]) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  const results = [];
  for (const path of paths) {
    const start = Date.now();
    try {
      await page.goto(`${baseUrl}${path.path}`, { timeout: path.timeout });
      // Check for console errors
      // Check page loaded successfully
      results.push({ ...path, passed: true, duration: Date.now() - start });
    } catch (error) {
      results.push({ ...path, passed: false, error: error.message });
    }
  }
  
  await browser.close();
  return results;
}
```

---

## Migration Path

### Phase 1: Add new modes (non-breaking)
- Add `check`, `preview`, `verify-production`, `rollback`
- Existing behaviour unchanged

### Phase 2: Extend merge process
- Add track detection
- Add post-deploy verification
- Update merge report format

### Phase 3: Enforce prerequisites
- Feature track enforces full cycle
- Fix track allows abbreviated path

---

## Summary

This extension adds deployment safety to the existing Merge Feature Agent:

| What | How |
|------|-----|
| **Track detection** | Branch naming (`feature/*` vs `fix/*`) determines verification depth |
| **Preview verification** | Critical paths tested on Vercel preview before merge |
| **Post-deploy verification** | Same checks run against production after merge |
| **Rollback** | One command to revert if something breaks |
| **Code review** | Required for both tracks (fix track needs speed but not at expense of quality) |

The agent keeps the existing merge mechanics but wraps them with production safety appropriate to a business-critical daily-use application.
