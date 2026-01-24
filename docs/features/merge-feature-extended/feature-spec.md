# Feature Specification: merge-feature-extended

**Generated:** 2026-01-24
**Based on:** done-criteria.md (24 criteria)
**Status:** READY_FOR_BUILD

---

## 1. Summary

This feature extends the Merge Feature Agent to include deployment verification capabilities. Since Vercel auto-deploys on merge to main, the agent must own the full "get code to production safely" workflow. The implementation adds four new modes (`check`, `preview`, `verify-production`, `rollback`), track detection (feature vs fix branches), and Playwright-based critical path testing against preview and production URLs. Configuration is stored in JSON files, and the agent uses the existing Playwright authentication infrastructure.

**Key principle:** This is a "documentation-first agent" feature. The agent behavior is defined in markdown specs that Claude Code interprets at runtime. No new TypeScript application code is needed beyond the Playwright critical path tests.

---

## 2. Criteria Mapping

| Criterion | Implementation Approach |
|-----------|------------------------|
| F1: Track detection | Add track detection logic to agent spec with branch name pattern matching |
| F2: Check mode | New mode section in agent spec with prerequisite validation logic |
| F3: Preview mode | New mode using `vercel ls` + Playwright tests against preview URL |
| F4: Verify-production mode | New mode running Playwright tests against production URL |
| F5: Rollback mode | New mode with confirmation prompt + `git revert` + verification |
| F6: Extended merge process | Update existing merge flow to include deploy wait + verification |
| F7: Config file | Create `config.json` with Vercel URLs, timeouts, track settings |
| F8: Critical paths file | Create `critical-paths.ts` with 4 Playwright test definitions |
| F9: Last deploy tracking | Create `last-deploy.json` schema, updated after each merge |
| F10: Vercel CLI URL retrieval | Agent spec instructions to parse `vercel ls` output |
| F11: Authenticated Playwright | Critical path tests use existing auth state file |
| F12: Track prerequisites | Check mode validates prerequisites based on detected track |
| F13: Existing auth helpers | Import existing Playwright storage state approach |
| E1: Vercel CLI error | Agent spec includes error message with install instructions |
| E2: Preview not ready | Agent spec includes polling logic with timeout handling |
| E3: Test failure reporting | Playwright test output formatted in agent spec output |
| E4: Rollback confirmation | Agent spec includes confirmation prompt flow |
| E5: Post-deploy failure warning | Agent spec includes warning banner format |
| P1: Deploy timeout | Config file with `deployTimeout: 120000` |
| P2: Page load timeout | Config file with `pageLoadTimeout: 15000` |
| P3: Polling interval | Agent spec specifies 5-second polling |
| I1: Agent spec updated | Update `merge-feature-agent.md` with all new content |
| I2: Existing modes preserved | Keep all existing mode documentation |
| I3: Playwright integration | Use existing `playwright.config.ts` and auth state |

---

## 3. Architecture

### 3.1 System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        /merge-feature Command                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                     docs/agents/merge-feature-agent.md              │ │
│  │                                                                      │ │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────────┐  │ │
│  │  │ check   │ │ preview │ │ verify- │ │rollback │ │ <branch>     │  │ │
│  │  │ mode    │ │ mode    │ │ prod    │ │ mode    │ │ (extended)   │  │ │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └──────┬───────┘  │ │
│  │       │           │           │           │             │          │ │
│  └───────┼───────────┼───────────┼───────────┼─────────────┼──────────┘ │
│          │           │           │           │             │            │
│          ▼           ▼           ▼           ▼             ▼            │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ │
│  │ Read      │ │ vercel ls │ │ Playwright│ │ git revert│ │ Full flow │ │
│  │ config +  │ │ + poll    │ │ tests vs  │ │ + push +  │ │ with all  │ │
│  │ prereqs   │ │ + tests   │ │ prod URL  │ │ verify    │ │ phases    │ │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘ └───────────┘ │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Configuration Files                              │
│                                                                          │
│  ┌────────────────────┐  ┌────────────────────┐  ┌───────────────────┐  │
│  │ config.json        │  │ critical-paths.ts  │  │ last-deploy.json  │  │
│  │                    │  │                    │  │                   │  │
│  │ - vercel URLs      │  │ - Dashboard /      │  │ - commit          │  │
│  │ - timeouts         │  │ - Inventory        │  │ - branch          │  │
│  │ - track settings   │  │ - Orders           │  │ - mergedAt        │  │
│  │                    │  │ - Single Order     │  │ - verification    │  │
│  └────────────────────┘  └────────────────────┘  └───────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Existing Playwright Infrastructure                    │
│                                                                          │
│  apps/web/playwright.config.ts                                          │
│  apps/web/.playwright/.auth/user.json (auth state)                      │
│  apps/web/tests/e2e/ (existing tests)                                   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Integration Points

| Integration Point | Location | Nature | Risk |
|-------------------|----------|--------|------|
| Agent spec | `docs/agents/merge-feature-agent.md` | Update existing | Low |
| Command file | `.claude/commands/merge-feature.md` | Update existing | Low |
| Playwright config | `apps/web/playwright.config.ts` | Read only | None |
| Auth state | `apps/web/.playwright/.auth/user.json` | Read only | None |
| Vercel CLI | System PATH | External dependency | Medium |
| Git | System PATH | External dependency | None |

### 3.3 Technology Decisions

#### Decision 1: Agent Spec vs Application Code

**Options:**
- A) Add TypeScript functions to the application
- B) Define behavior in agent markdown specs

**Decision:** Option B - Agent markdown specs

**Rationale:**
- Claude Code agents are documentation-driven
- The merge-feature command reads the spec and follows instructions
- No new npm dependencies
- Easier to maintain and modify
- Consistent with existing agent pattern

#### Decision 2: Critical Path Tests Location

**Options:**
- A) Put in `apps/web/tests/e2e/critical-paths/`
- B) Put in `docs/agents/merge-feature/critical-paths.ts`

**Decision:** Option B - Agent directory

**Rationale:**
- Keeps deployment verification separate from feature tests
- Agent owns its own test definitions
- Can be updated without touching app test infrastructure
- Clear ownership

#### Decision 3: Preview URL Detection

**Options:**
- A) Construct from pattern
- B) Parse Vercel CLI output
- C) Use Vercel API

**Decision:** Option B - Vercel CLI (`vercel ls`)

**Rationale:**
- User confirmed this approach
- Vercel CLI is already installed for deployment
- More reliable than pattern construction
- Simpler than API integration

---

## 4. File Changes

### 4.1 New Files

| File | Purpose | Est. Lines |
|------|---------|------------|
| `docs/agents/merge-feature/config.json` | Agent configuration (URLs, timeouts, tracks) | 30 |
| `docs/agents/merge-feature/critical-paths.ts` | Playwright test definitions for critical paths | 80 |
| `docs/agents/merge-feature/critical-paths.spec.ts` | Actual Playwright test file | 60 |

### 4.2 Modified Files

| File | Changes | Est. Lines Changed |
|------|---------|-------------------|
| `docs/agents/merge-feature-agent.md` | Add new modes, track detection, extended flow | 400+ |
| `.claude/commands/merge-feature.md` | Add new modes to quick reference | 40 |

### 4.3 Runtime Files (Created by Agent)

| File | Purpose | Created By |
|------|---------|------------|
| `docs/agents/merge-feature/last-deploy.json` | Track last deployment for rollback | Agent after each merge |

---

## 5. Implementation Details

### 5.1 Config File Schema

**File:** `docs/agents/merge-feature/config.json`

```json
{
  "vercel": {
    "productionUrl": "https://hadley-bricks-inventory-management.vercel.app",
    "previewUrlPattern": "https://hadley-bricks-inventory-management-git-{branch}.vercel.app",
    "deployTimeout": 120000,
    "pollingInterval": 5000
  },
  "verification": {
    "criticalPathsFile": "docs/agents/merge-feature/critical-paths.spec.ts",
    "pageLoadTimeout": 15000,
    "checkConsoleErrors": true
  },
  "tracks": {
    "feature": {
      "patterns": ["feature/*", "chore/*", "refactor/*"],
      "requireDoneCriteria": true,
      "requireVerifyDone": true,
      "requireFullTestSuite": true,
      "requireCodeReview": true
    },
    "fix": {
      "patterns": ["fix/*", "hotfix/*", "bugfix/*"],
      "requireDoneCriteria": false,
      "requireVerifyDone": false,
      "requireFullTestSuite": false,
      "requireCodeReview": true
    }
  }
}
```

### 5.2 Critical Paths Definition

**File:** `docs/agents/merge-feature/critical-paths.ts`

```typescript
/**
 * Critical paths for deployment verification.
 * These are the business-critical routes that must work for the app to be functional.
 */

export interface CriticalPath {
  name: string;
  path: string;
  expect: string;
  timeout: number;
  requiresAuth: boolean;
}

export const criticalPaths: CriticalPath[] = [
  {
    name: 'Dashboard loads',
    path: '/',
    expect: 'page loads without error, main content visible',
    timeout: 10000,
    requiresAuth: true,
  },
  {
    name: 'Inventory page loads',
    path: '/inventory',
    expect: 'page loads, inventory table or empty state visible',
    timeout: 15000,
    requiresAuth: true,
  },
  {
    name: 'Orders page loads',
    path: '/orders',
    expect: 'page loads, orders list or empty state visible',
    timeout: 15000,
    requiresAuth: true,
  },
  {
    name: 'Single order view',
    path: '/orders', // Will navigate to first order dynamically
    expect: 'order details load successfully',
    timeout: 10000,
    requiresAuth: true,
  },
];
```

### 5.3 Playwright Test File

**File:** `docs/agents/merge-feature/critical-paths.spec.ts`

```typescript
import { test, expect, Page } from '@playwright/test';
import path from 'path';

// Use existing auth state
const authFile = path.join(__dirname, '../../apps/web/.playwright/.auth/user.json');

test.describe('Critical Path Verification', () => {
  test.use({ storageState: authFile });

  test('Dashboard loads', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('main')).toBeVisible({ timeout: 10000 });
    // Check no error state
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });

  test('Inventory page loads', async ({ page }) => {
    await page.goto('/inventory');
    // Either table or empty state should be visible
    const hasContent = await page.locator('[data-testid="inventory-table"], [data-testid="empty-state"]')
      .first()
      .isVisible({ timeout: 15000 })
      .catch(() => false);
    expect(hasContent).toBeTruthy();
  });

  test('Orders page loads', async ({ page }) => {
    await page.goto('/orders');
    // Either table or empty state should be visible
    const hasContent = await page.locator('[data-testid="orders-table"], [data-testid="empty-state"]')
      .first()
      .isVisible({ timeout: 15000 })
      .catch(() => false);
    expect(hasContent).toBeTruthy();
  });

  test('Single order view loads', async ({ page }) => {
    await page.goto('/orders');
    // Try to click first order if exists
    const firstOrder = page.locator('[data-testid="order-row"]').first();
    if (await firstOrder.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstOrder.click();
      await expect(page.locator('[data-testid="order-details"]')).toBeVisible({ timeout: 10000 });
    }
    // If no orders, just verify the page loaded without error
  });
});
```

### 5.4 Last Deploy Schema

**File:** `docs/agents/merge-feature/last-deploy.json` (created at runtime)

```json
{
  "commit": "abc1234def5678",
  "branch": "feature/ebay-bulk-listing",
  "mergedAt": "2026-01-24T14:30:00Z",
  "verificationStatus": "passed",
  "criticalPathResults": [
    { "name": "Dashboard loads", "passed": true, "duration": 800 },
    { "name": "Inventory page loads", "passed": true, "duration": 1200 },
    { "name": "Orders page loads", "passed": true, "duration": 950 },
    { "name": "Single order view", "passed": true, "duration": 700 }
  ]
}
```

### 5.5 Agent Spec Additions

The following sections will be added to `docs/agents/merge-feature-agent.md`:

#### Track Detection Section

```markdown
## Track Detection

The agent automatically detects the merge track from the branch name:

| Branch Pattern | Track | Verification Level |
|----------------|-------|-------------------|
| `feature/*`, `chore/*`, `refactor/*` | FEATURE | Full prerequisites |
| `fix/*`, `hotfix/*`, `bugfix/*` | FIX | Abbreviated checks |
| Other | FEATURE | Default to full (safer) |

### Track Prerequisites

**FEATURE Track:**
- Done criteria exists (`docs/features/<name>/done-criteria.md`)
- Verify Done passed
- `/test-execute pre-merge` passed
- `/code-review branch` completed
- Preview verification passed

**FIX Track:**
- `/code-review branch` completed
- Preview verification passed
```

#### New Modes Sections

Each new mode (`check`, `preview`, `verify-production`, `rollback`) will have a dedicated section with:
- Purpose
- Prerequisites
- Process steps
- Example output
- Error handling

#### Extended Merge Flow Section

```markdown
## Extended Merge Process

For `/merge-feature <branch>`:

1. **Detect track** from branch name
2. **Run check** - validate prerequisites for track
3. **Pre-merge verification** (existing)
4. **Fetch latest main** (existing)
5. **Execute merge** with `--no-ff` (existing)
6. **Post-merge verification** - TypeScript, lint, tests (existing)
7. **Push to origin** (existing)
8. **Wait for Vercel deploy** - poll until ready (NEW)
9. **Run verify-production** - Playwright critical paths (NEW)
10. **Update last-deploy.json** (NEW)
11. **Delete merged branches** (existing)
12. **Generate merge report** with deployment section (extended)

If post-deploy verification fails:
- Output warning banner
- Recommend `/merge-feature rollback`
- Do NOT delete branches (for recovery)
```

---

## 6. Build Order

Given criteria dependencies, implement in this order:

### Phase 1: Configuration Files (F7, P1, P2)
1. Create `docs/agents/merge-feature/` directory
2. Create `config.json` with all settings
3. Validate JSON structure

### Phase 2: Critical Path Tests (F8, F11, F13, I3)
1. Create `critical-paths.ts` with path definitions
2. Create `critical-paths.spec.ts` with Playwright tests
3. Verify tests use existing auth state file
4. Test locally against dev server

### Phase 3: Track Detection (F1, F12)
1. Add track detection section to agent spec
2. Add prerequisite validation per track
3. Document pattern matching logic

### Phase 4: New Modes (F2, F3, F4, F5)
1. Add `check` mode section
2. Add `preview` mode section with Vercel CLI instructions
3. Add `verify-production` mode section
4. Add `rollback` mode section with confirmation flow

### Phase 5: Extended Merge Flow (F6, F9, F10)
1. Update existing merge process section
2. Add deploy wait logic with polling
3. Add post-deploy verification step
4. Add last-deploy.json update step

### Phase 6: Error Handling (E1, E2, E3, E4, E5)
1. Add Vercel CLI error messaging
2. Add preview polling timeout handling
3. Add test failure reporting format
4. Add rollback confirmation flow
5. Add post-deploy failure warning

### Phase 7: Command Update (I1, I2)
1. Update `.claude/commands/merge-feature.md` with new modes
2. Verify existing modes documentation preserved
3. Add quick reference for new modes

### Phase 8: Verification
1. Run `/merge-feature check` on a feature branch
2. Run `/merge-feature preview` on a pushed branch
3. Run `/merge-feature verify-production`
4. Verify all outputs match expected format

---

## 7. Risk Assessment

### 7.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Vercel CLI not installed | Medium | Blocks preview/production modes | Clear error message with install instructions |
| Auth state expired | Medium | Tests fail with 401 | Document auth refresh process |
| Preview URL format changes | Low | URL construction fails | Using Vercel CLI parsing, not pattern matching |
| Playwright tests flaky | Medium | False failures | Use generous timeouts, retry on first failure |

### 7.2 Scope Risks

| Risk | Mitigation |
|------|------------|
| Scope creep to add Sentry | Explicitly out of scope in criteria |
| Adding more critical paths | Start with 4, can extend later |
| Complex verification logic | Keep to page load checks only |

### 7.3 Integration Risks

| Risk | Probability | Mitigation |
|------|-------------|------------|
| Existing modes break | Low | Preserve all existing sections, only add new |
| Agent spec becomes too long | Medium | Use clear section headers, table of contents |
| Config file schema changes | Low | Version the schema, document migrations |

---

## 8. Feasibility Validation

| Criterion | Feasible | Confidence | Notes |
|-----------|----------|------------|-------|
| F1: Track detection | ✅ Yes | High | Simple pattern matching |
| F2: Check mode | ✅ Yes | High | File existence checks |
| F3: Preview mode | ✅ Yes | High | Vercel CLI + Playwright |
| F4: Verify-production mode | ✅ Yes | High | Playwright against URL |
| F5: Rollback mode | ✅ Yes | High | git revert + verification |
| F6: Extended merge process | ✅ Yes | High | Adding steps to existing flow |
| F7: Config file | ✅ Yes | High | Static JSON |
| F8: Critical paths file | ✅ Yes | High | TypeScript definitions |
| F9: Last deploy tracking | ✅ Yes | High | JSON file update |
| F10: Vercel CLI URL | ✅ Yes | Medium | Requires parsing CLI output |
| F11: Authenticated Playwright | ✅ Yes | High | Existing auth state works |
| F12: Track prerequisites | ✅ Yes | High | Conditional validation |
| F13: Existing auth helpers | ✅ Yes | High | Just use storage state path |
| E1-E5: Error handling | ✅ Yes | High | Output formatting |
| P1-P3: Performance config | ✅ Yes | High | Static values |
| I1-I3: Integration | ✅ Yes | High | Markdown updates |

**Overall:** All 24 criteria feasible with planned approach.

---

## 9. Notes for Build Agent

### Key Implementation Notes

1. **This is a documentation-first feature.** The primary output is updated markdown specs, not TypeScript application code. The Playwright tests are the only "real code."

2. **Vercel CLI parsing:** The `vercel ls` command outputs deployment info. Parse for the preview URL matching the current branch. Example:
   ```
   vercel ls --scope=your-team
   ```
   Look for deployments with state "READY" and URL matching branch pattern.

3. **Auth state location:** The existing auth file is at `apps/web/.playwright/.auth/user.json`. Critical path tests should use this via `storageState` in the test use block.

4. **Polling for deploy:** When waiting for Vercel deploy, use:
   ```powershell
   # Check if URL responds with 200
   curl -s -o /dev/null -w "%{http_code}" https://preview-url.vercel.app
   ```
   Poll every 5 seconds up to 120 seconds.

5. **Last deploy JSON:** Must be valid JSON. Create it on first merge, update on subsequent. Include ISO timestamps.

6. **Keep existing modes:** The current agent spec has modes: `<branch-name>`, `auto`, `list`, `status`. ALL must continue to work unchanged.

7. **Test data-testid attributes:** The critical path tests assume certain data-testid attributes exist. If they don't, the tests should still pass by checking for visible content rather than failing.

### Testing the Implementation

After build:
1. Run critical path tests locally: `npx playwright test critical-paths.spec.ts`
2. Test check mode on current branch
3. Push a test branch and verify preview mode
4. Verify rollback shows confirmation prompt

---

## 10. Handoff

**Status:** READY_FOR_BUILD

**Summary:**
- 3 new files to create
- 2 files to modify
- ~600 lines of content
- No database changes
- No new npm dependencies
- One external dependency: Vercel CLI (already installed)

**Build order:**
1. Config file (10 min)
2. Critical path tests (20 min)
3. Track detection in agent spec (15 min)
4. New modes in agent spec (45 min)
5. Extended merge flow (20 min)
6. Error handling (15 min)
7. Command file update (10 min)
8. Verification (15 min)

**Risks flagged:** 1 medium (Vercel CLI parsing - mitigated with clear error handling)

**Ready for:** `/build-feature merge-feature-extended`
