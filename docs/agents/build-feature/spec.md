# Build Feature Agent Specification

**Version:** 2.1
**Type:** Actor (Autonomous Builder)
**Command:** `/build-feature <feature-name> [--max-iterations=5] [--autonomous] [--cautious]`
**Project:** Cross-project (Hadley Bricks, FamilyFuel, Personal Finance)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Design Principles](#2-design-principles)
3. [Command Interface](#3-command-interface)
4. [Standard Boot Sequence](#4-standard-boot-sequence)
5. [Autonomous Recovery Actions](#5-autonomous-recovery-actions)
6. [The Autonomous Loop](#6-the-autonomous-loop)
7. [Phase 1: Load Context](#7-phase-1-load-context)
8. [Phase 2: Plan Implementation](#8-phase-2-plan-implementation)
9. [Phase 3: Execute Build](#9-phase-3-execute-build)
10. [Phase 4: Trigger Verification](#10-phase-4-trigger-verification)
11. [Phase 5: Process Verdict](#11-phase-5-process-verdict)
12. [Phase 6: Iterate or Exit](#12-phase-6-iterate-or-exit)
13. [Anti-Thrashing Protection](#13-anti-thrashing-protection)
14. [Context Management](#14-context-management)
15. [Scope Guards](#15-scope-guards)
16. [State Management](#16-state-management)
17. [Escalation & Exit Conditions](#17-escalation--exit-conditions)
18. [Error Handling](#18-error-handling)
19. [Output Templates](#19-output-templates)
20. [Handoffs](#20-handoffs)
21. [Examples](#21-examples)
22. [The Golden Rule](#22-the-golden-rule)

---

## 1. Overview

### 1.1 Purpose

The Build Feature Agent is an **autonomous builder** that owns the entire build-verify loop. It reads success criteria from `done-criteria.md`, implements the feature, verifies against criteria, and iterates on failures until convergence or escalation.

**This is the only agent the human needs to trigger.** It handles everything else internally.

### 1.2 The Core Loop

```
Human: /build-feature inventory-export

Build Feature Agent:
  ├── Iteration 1: Build → Verify → FAILED (2 criteria)
  ├── Iteration 2: Fix → Verify → FAILED (1 criterion)  
  ├── Iteration 3: Fix → Verify → CONVERGED ✅
  └── Exit: Report success, hand off to human for HUMAN_VERIFY review
```

### 1.3 Agent Classification

| Property | Value |
|----------|-------|
| Type | Actor (Autonomous) |
| Modifies Code | Yes |
| Requires Running App | Yes |
| State Tracking | Yes |
| Human Interaction | Only on exit (success or escalation) |
| Owns Loop | Yes - calls Verify Done internally |

### 1.4 Key Innovation

Unlike traditional "build and hope" approaches:
- **Criteria-driven**: Only builds what's defined in done-criteria.md
- **Self-verifying**: Calls Verify Done after each attempt
- **Self-correcting**: Uses failure reports to guide fixes
- **Self-limiting**: Exits on max iterations or stuck patterns

### 1.5 Interactions

| Agent | Relationship | When |
|-------|--------------|------|
| **Define Done Agent** | ← reads from | Gets done-criteria.md at start |
| **Verify Done Agent** | ← calls internally | After each build iteration |
| **Test Plan Agent** | → triggers on exit | After CONVERGED |
| **Code Review Agent** | → triggers on exit | After CONVERGED |

### 1.6 Critical Completion Requirement

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚠️  YOU ARE NOT DONE UNTIL VERIFY DONE RETURNS CONVERGED  ⚠️   │
│                                                                 │
│  "Implementation complete" ≠ DONE                               │
│  "Code written" ≠ DONE                                          │
│  "It should work" ≠ DONE                                        │
│                                                                 │
│  ONLY `CONVERGED` from Verify Done = DONE                       │
└─────────────────────────────────────────────────────────────────┘
```

**This is non-negotiable.** The Build Feature Agent MUST execute verification after every implementation iteration. Claiming completion without a CONVERGED verdict is a failure mode.

---

## 2. Design Principles

### 2.1 Autonomous Operation

Once triggered, the agent operates without human input until:
- All AUTO_VERIFY criteria pass (CONVERGED)
- Max iterations reached
- Blocked condition detected
- Stuck pattern identified

### 2.2 Criteria as Contract

The `done-criteria.md` file is the **only specification**. The agent:
- Does not invent requirements
- Does not add unrequested features
- Does not "improve" beyond criteria
- Builds exactly what's specified, nothing more

### 2.3 Failure as Fuel

Each failed verification provides:
- Specific criteria that failed
- Gap analysis (expected vs actual)
- Suggested fixes with file/line references

This failure context **drives** the next iteration. Without it, the agent would repeat mistakes.

### 2.4 Incremental Progress

Each iteration should:
- Fix specific failures from previous iteration
- Not regress passing criteria
- Make measurable progress toward convergence

### 2.5 Clean Exits

Every exit path provides:
- Clear status (CONVERGED, BLOCKED, ESCALATED)
- Full iteration history
- Next recommended action
- No orphaned state

### 2.6 Anti-Shortcut Rules

The following patterns are **PROHIBITED**:

#### Rule 1: No Premature Completion Claims
❌ **WRONG:** "I've implemented all the features. The implementation is complete."
✅ **RIGHT:** "I've implemented iteration 1. Now executing verification against all AUTO_VERIFY criteria..." [shows actual verification results]

#### Rule 2: No Implicit Verification
❌ **WRONG:** "I verified the implementation works correctly."
✅ **RIGHT:** "Verification results: F1 ✅ (button found in DOM), F2 ✅ (CSV downloaded, 650 rows)..." [actual evidence for each criterion]

#### Rule 3: No "Should Work" Claims
❌ **WRONG:** "The API endpoint should return the correct data."
✅ **RIGHT:** "Called GET /api/inventory/export. Response: 200, body: {rows: 650, columns: 7}. Matches expected. ✅"

#### Rule 4: No Verification by Inspection
❌ **WRONG:** "Looking at the code, the implementation is correct."
✅ **RIGHT:** "Executed test: clicked export button, captured download, parsed CSV. Column count: 7. Row count: 650. ✅"

#### Rule 5: No Deferred Verification
❌ **WRONG:** "I'll verify this after I finish the other features."
✅ **RIGHT:** [Runs verification immediately after each implementation iteration]

---

## 3. Command Interface

### 3.1 Basic Usage

```powershell
# Start build with default 5 iterations
/build-feature inventory-export

# Specify max iterations
/build-feature inventory-export --max-iterations=10

# Resume from previous state
/build-feature inventory-export --resume

# Dry run (show plan, don't execute)
/build-feature inventory-export --dry-run
```

### 3.2 Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `feature-name` | Required | Name matching done-criteria.md |
| `--max-iterations` | 5 | Maximum build-verify cycles |
| `--resume` | false | Continue from saved state |
| `--dry-run` | false | Plan only, no code changes |
| `--skip-verify` | false | Build only, don't verify (debugging) |
| `--autonomous` | false | Maximum autonomy, only BLOCK for credentials/destructive |
| `--cautious` | false | BLOCK immediately on any failure (no recovery attempts) |

### 3.3 Autonomy Levels

| Flag | Behaviour |
|------|-----------|
| (default) | Attempt recovery, BLOCK if stuck |
| `--autonomous` | Maximum autonomy, only BLOCK for credentials/destructive actions |
| `--cautious` | BLOCK immediately on any failure (no recovery attempts) |

### 3.4 Prerequisites

Before running:
- `docs/features/<feature-name>/done-criteria.md` must exist
- App must be running (for verification)
- Git working directory should be clean

---

## 4. Standard Boot Sequence

**MANDATORY: Execute before any work.**

### 4.0 Read Agent Spec
```powershell
cat docs/agents/build-feature/spec.md
```

### 4.1 Read Core Context
```powershell
cat CLAUDE.md
```
Extract: Project patterns, file structure, coding conventions.

### 4.2 Read Agent State
```powershell
cat docs/agents/build-feature/state.json
```
Check: Is there an in-progress build for this feature?

### 4.3 Load Done Criteria
```powershell
cat docs/features/<feature-name>/done-criteria.md
```
**CRITICAL:** If not found, EXIT with error.

Parse into structured criteria list.

### 4.4 Load Previous Iteration State (if resuming)
```powershell
cat docs/features/<feature-name>/build-state.json
```
Extract: Current iteration, previous failures, files modified.

### 4.5 Ensure App Running

```
curl localhost:3000 responds?
    │
    ├── Yes → Continue to 4.6
    │
    └── No → Attempt Recovery
            │
            ▼
        Start server (npm run dev in background)
            │
            ├── Wait up to 60s for ready
            │
            ├── Ready? → Continue to 4.6
            │
            └── Not ready?
                    │
                    ▼
                Check logs, attempt fix, retry
                    │
                    ├── Fixed? → Continue to 4.6
                    │
                    └── Exhausted (3 attempts)? → BLOCKED
```

**Recovery actions attempted automatically (unless `--cautious`):**
- Kill conflicting port: `npx kill-port 3000`
- Start dev server: `npm run dev` (background)
- Wait for server ready (poll localhost:3000)
- Tail logs on failure for diagnosis

See [Section 5: Autonomous Recovery Actions](#5-autonomous-recovery-actions) for full recovery capabilities.

### 4.6 Check Git Status
```powershell
git status --porcelain
```
If dirty: WARN but continue (changes will be part of feature).

### 4.7 Report Boot Status

```markdown
## Build Feature Agent - Boot Complete

**Feature:** inventory-export
**Max iterations:** 5
**Resuming:** No (fresh start)

**Criteria loaded:** 7 total
- AUTO_VERIFY: 6
- HUMAN_VERIFY: 1

**App status:** ✅ Running on localhost:3000
**Git status:** ✅ Clean

**Starting autonomous build loop...**
```

---

## 5. Autonomous Recovery Actions

### 5.1 Core Principle

**Try to fix it first, only BLOCK if truly stuck.**

The agent has full bash access. Use it.

### 5.2 Recovery Action Table

When a prerequisite check fails, attempt recovery before BLOCKING:

| Check Failed | Recovery Action | Max Attempts | Timeout |
|--------------|----------------|--------------|---------|
| App not running | `npm run dev` in background | 3 | 60s |
| Port 3000 in use | `npx kill-port 3000` then start app | 2 | 30s |
| Database unreachable | Check Supabase MCP connection, retry | 3 | 30s |
| Missing node_modules | `npm install` | 1 | 120s |
| Uncommitted changes | `git stash` (with warning to user) | 1 | 10s |
| Build errors on start | Read error, attempt fix, restart | 2 | 60s |

### 5.3 Recovery Flow

```
Check fails
    │
    ▼
Attempt recovery action
    │
    ├── Success → Continue to next check
    │
    └── Fail → Retry (up to max attempts)
                │
                ├── Success → Continue
                │
                └── Exhausted → BLOCKED (with recovery log)
```

### 5.4 Server Management

The agent **CAN and SHOULD**:

**Start the dev server (background process):**
```bash
cd apps/web && npm run dev > /tmp/dev-server.log 2>&1 &
```

**Wait for server ready:**
```bash
# Poll until ready (max 60s)
for i in {1..60}; do
  curl -s http://localhost:3000 > /dev/null && break
  sleep 1
done
```

**Kill and restart if needed:**
```bash
npx kill-port 3000
# then restart
```

**Tail logs on failure:**
```bash
tail -50 /tmp/dev-server.log
```

### 5.5 Database Management

The agent **CAN and SHOULD**:

- **Run pending migrations:**
  ```bash
  npx supabase db push
  ```

- **Check Supabase connection via MCP:**
  - Use Supabase MCP to verify connectivity
  - If local, ensure `supabase start` is running

- **Seed test data if required:**
  - Only when criteria require specific data state

### 5.6 Build Error Recovery

When `npm run dev` fails with build errors:

1. Capture the error output
2. Analyse the error (missing import, type error, etc.)
3. Attempt fix if straightforward (missing import, typo)
4. Restart server
5. If fix fails, include error in BLOCKED status

### 5.7 Updated BLOCKED Criteria

**Only BLOCK (escalate to human) when:**

| Condition | Reason |
|-----------|--------|
| Recovery exhausted | Tried all recovery actions, still failing |
| Credentials missing | Can't fix without human providing secrets |
| Destructive action required | e.g., drop database, force push |
| Ambiguous requirement | Criteria unclear, need clarification |
| External dependency down | eBay API outage, etc. |

**When BLOCKING, include:**
- What was tried
- Why it failed
- Specific human action needed

### 5.8 Recovery Logging

All recovery actions must be logged:

```markdown
## Recovery Log

| Time | Issue | Action | Result |
|------|-------|--------|--------|
| 10:01 | App not running | npm run dev | ✅ Started |
| 10:02 | Port conflict | kill-port 3000 | ✅ Cleared |
| 10:02 | App not running | npm run dev (retry) | ✅ Started |
```

Include recovery log in build output so human can see what happened.

### 5.9 Example: Fully Autonomous Start

```
/build-feature listing-optimiser --autonomous

Build Feature Agent - STARTING
Feature: listing-optimiser

Prerequisites Check:
✅ done-criteria.md found (47 criteria)
✅ feature-spec.md found
✅ CLAUDE.md loaded
⚠️ App not running - attempting recovery...
   → Running: npm run dev
   → Waiting for localhost:3000...
   → Ready after 8s
✅ App running
✅ Git status clean

All prerequisites met. Beginning build phase 1...
```

---

## 6. The Autonomous Loop

### 6.1 Loop Pseudocode

```typescript
async function buildFeatureLoop(feature: string, maxIterations: number) {
  // Initialize
  let iteration = 0;
  let verdict: Verdict = "PENDING";
  let failureContext: FailureContext | null = null;
  let iterationHistory: IterationRecord[] = [];
  
  // Load criteria
  const criteria = loadCriteria(feature);
  
  // Main loop
  while (iteration < maxIterations) {
    iteration++;
    logIterationStart(iteration, maxIterations);
    
    // === PHASE 1: BUILD ===
    const buildResult = await executeBuild({
      feature,
      iteration,
      criteria,
      failureContext,  // null on first iteration
      previousAttempts: iterationHistory
    });
    
    // Check for build errors
    if (buildResult.status === "ERROR") {
      return exitWithError(buildResult.error);
    }
    
    // === PHASE 2: VERIFY ===
    const verifyResult = await executeVerifyDone(feature);
    verdict = verifyResult.verdict;
    
    // === PHASE 3: RECORD ===
    iterationHistory.push({
      iteration,
      buildResult,
      verifyResult,
      timestamp: now()
    });
    saveIterationState(feature, iterationHistory);
    
    // === PHASE 4: DECIDE ===
    if (verdict === "CONVERGED") {
      return exitWithSuccess(feature, iterationHistory);
    }
    
    if (verdict === "BLOCKED") {
      return exitWithBlocked(feature, verifyResult.blockReason);
    }
    
    // verdict === "FAILED" - prepare for next iteration
    failureContext = buildFailureContext(verifyResult);
    
    // === PHASE 5: ANTI-THRASHING CHECK ===
    if (isRepeatingFailure(iterationHistory)) {
      return exitWithStuck(feature, iterationHistory);
    }
    
    // Continue to next iteration
    logIterationEnd(iteration, verdict, verifyResult.failCount);
  }
  
  // Max iterations reached without convergence
  return exitWithMaxIterations(feature, iterationHistory);
}
```

### 6.2 Loop Visualization

```
┌─────────────────────────────────────────────────────────────────────┐
│                     BUILD FEATURE LOOP                               │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ ITERATION START                                               │   │
│  │                                                               │   │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐       │   │
│  │  │ Load        │───▶│ Plan        │───▶│ Execute     │       │   │
│  │  │ Context     │    │ Changes     │    │ Build       │       │   │
│  │  └─────────────┘    └─────────────┘    └──────┬──────┘       │   │
│  │                                               │               │   │
│  │                                               ▼               │   │
│  │                                        ┌─────────────┐       │   │
│  │                                        │ Call        │       │   │
│  │                                        │ Verify Done │       │   │
│  │                                        └──────┬──────┘       │   │
│  │                                               │               │   │
│  │                     ┌─────────────────────────┼───────────┐   │   │
│  │                     │                         │           │   │   │
│  │                     ▼                         ▼           ▼   │   │
│  │              ┌───────────┐            ┌───────────┐ ┌───────┐│   │
│  │              │ CONVERGED │            │  FAILED   │ │BLOCKED││   │
│  │              └─────┬─────┘            └─────┬─────┘ └───┬───┘│   │
│  │                    │                        │           │    │   │
│  │                    ▼                        │           ▼    │   │
│  │               EXIT SUCCESS                  │      EXIT BLOCKED  │
│  │                                             │                │   │
│  │                                             ▼                │   │
│  │                                    ┌───────────────┐         │   │
│  │                                    │ Build Failure │         │   │
│  │                                    │ Context       │         │   │
│  │                                    └───────┬───────┘         │   │
│  │                                            │                 │   │
│  │                                            ▼                 │   │
│  │                                    ┌───────────────┐         │   │
│  │                                    │ Anti-Thrash   │         │   │
│  │                                    │ Check         │         │   │
│  │                                    └───────┬───────┘         │   │
│  │                                            │                 │   │
│  │                              ┌─────────────┴─────────────┐   │   │
│  │                              │                           │   │   │
│  │                              ▼                           ▼   │   │
│  │                        ┌──────────┐               ┌──────────┐   │
│  │                        │ CONTINUE │               │  STUCK   │   │
│  │                        │ LOOP     │               │  EXIT    │   │
│  │                        └────┬─────┘               └──────────┘   │
│  │                             │                                │   │
│  └─────────────────────────────┼────────────────────────────────┘   │
│                                │                                    │
│                                └──────────► ITERATION START         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. Phase 1: Load Context

### 7.1 First Iteration Context

On iteration 1, load:

| Source | Content | Purpose |
|--------|---------|---------|
| `done-criteria.md` | Success criteria | What to build |
| `CLAUDE.md` | Project patterns | How to build |
| Related source files | Existing code | Where to build |

### 7.2 Subsequent Iteration Context

On iteration 2+, also load:

| Source | Content | Purpose |
|--------|---------|---------|
| Previous `verify-report.md` | Failure details | What to fix |
| `build-state.json` | Iteration history | What was tried |
| Previous build changes | Code diff | What was done |

### 7.3 Context Summarization

To manage context window, summarize previous iterations:

```markdown
## Previous Iteration Summary (Iteration 2)

**Built:** Export API route + button component
**Passed:** F1 (button exists), F2 (download works), P1 (performance)
**Failed:** 
- F3: CSV missing 'location' column
- E1: No toast on empty inventory

**Changes made:**
- Created: apps/web/app/api/inventory/export/route.ts (45 lines)
- Modified: apps/web/app/(dashboard)/inventory/page.tsx (+12 lines)

**Do not repeat:**
- First iteration forgot to add location field
- Was correctly identified, partially fixed in iteration 2
```

---

## 8. Phase 2: Plan Implementation

### 8.1 First Iteration Planning

Analyze criteria and plan implementation:

```markdown
## Implementation Plan - Iteration 1

### Criteria Analysis
| ID | Criterion | Implementation Needed |
|----|-----------|----------------------|
| F1 | Export button exists | Add button to toolbar |
| F2 | CSV downloads | Create API route |
| F3 | CSV has columns | Build CSV with all fields |
| F4 | Data matches | Use same query as table |
| E1 | Empty toast | Add empty check |
| P1 | < 5s for 1000 items | Streaming response |

### Files to Create
- `apps/web/app/api/inventory/export/route.ts` - Export API

### Files to Modify
- `apps/web/app/(dashboard)/inventory/page.tsx` - Add button

### Implementation Order
1. Create API route (F2, F3, F4, P1)
2. Add button to page (F1)
3. Add empty check (E1)
4. Test locally before verify
```

### 8.2 Fix Iteration Planning

When fixing failures, be specific:

```markdown
## Fix Plan - Iteration 3

### Failures to Address
| ID | Failure | Root Cause | Fix |
|----|---------|------------|-----|
| F3 | Missing 'location' | Omitted from row mapping | Add field at line 48 |
| E1 | No empty toast | No length check | Add guard at line 78 |

### Specific Changes

**File 1:** `apps/web/app/api/inventory/export/route.ts`
- Line 48: Add `item.location` to CSV row array
- Estimated: 1 line change

**File 2:** `apps/web/app/(dashboard)/inventory/page.tsx`
- Line 78: Add `if (items.length === 0) { toast.error(...); return; }`
- Estimated: 4 line change

### Regression Prevention
Do NOT modify:
- CSV column order (F3 depends on position)
- Download trigger logic (F2 passing)
- Performance characteristics (P1 passing)
```

---

## 9. Phase 3: Execute Build

### 9.1 Implementation Execution

Execute the planned changes:

```markdown
## Executing Build - Iteration 1

### Step 1: Create Export API Route
Creating: `apps/web/app/api/inventory/export/route.ts`

```typescript
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  const supabase = createClient();
  
  const { data: items, error } = await supabase
    .from('inventory_items')
    .select('id, name, sku, quantity, location, purchase_price, created_at');
  
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  
  // Build CSV
  const headers = ['item_id', 'name', 'sku', 'quantity', 'location', 'purchase_price', 'created_at'];
  const rows = items.map(item => [
    item.id,
    item.name,
    item.sku,
    item.quantity,
    item.location,
    item.purchase_price,
    item.created_at
  ]);
  
  const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
  
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="inventory-export-${Date.now()}.csv"`
    }
  });
}
```

✅ File created

### Step 2: Add Export Button
Modifying: `apps/web/app/(dashboard)/inventory/page.tsx`

[Show diff]

✅ File modified

### Step 3: Add Empty Check
[Implementation details]

✅ Complete

### Build Summary
- Files created: 1
- Files modified: 1
- Lines added: ~65
- Lines modified: ~15
```

### 9.2 Pre-Verify Sanity Check

Before calling Verify Done, quick sanity check:

```powershell
# TypeScript compiles?
npx tsc --noEmit

# Lint passes?
npm run lint

# App still running?
Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing
```

If any fail, fix before verification.

---

## 10. Phase 4: Trigger Verification (MANDATORY - DO NOT SKIP)

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚠️  THIS PHASE IS NON-NEGOTIABLE  ⚠️                           │
│                                                                 │
│  DO NOT skip this step                                          │
│  DO NOT say "verified" without executing this                   │
│  DO NOT ask user "should I verify?"                             │
│  DO NOT claim completion without this                           │
│  DO NOT report "implementation complete" before this            │
└─────────────────────────────────────────────────────────────────┘
```

### 10.1 Internal Verify Done Call

The Build Feature Agent calls Verify Done **internally**, not as a separate human-triggered command:

```typescript
async function executeVerifyDone(feature: string): Promise<VerifyResult> {
  // This is an internal call, not a new agent invocation
  // The verification logic runs in the same context
  
  const criteria = loadCriteria(feature);
  const results: CriterionResult[] = [];
  
  for (const criterion of criteria) {
    if (criterion.tag === 'HUMAN_VERIFY') {
      results.push({ ...criterion, status: 'PENDING_HUMAN' });
      continue;
    }
    
    const result = await verifyCriterion(criterion);
    results.push(result);
  }
  
  return {
    verdict: calculateVerdict(results),
    results,
    passCount: results.filter(r => r.status === 'PASS').length,
    failCount: results.filter(r => r.status === 'FAIL').length,
    failures: results.filter(r => r.status === 'FAIL').map(buildFailureDetail)
  };
}
```

### 10.2 Verify Done Return Contract

Verify Done returns structured data for programmatic consumption:

```typescript
interface VerifyResult {
  verdict: "CONVERGED" | "FAILED" | "BLOCKED";
  iteration: number;
  timestamp: string;
  
  // Counts
  passCount: number;
  failCount: number;
  skipCount: number;
  pendingHumanCount: number;
  
  // Details
  results: CriterionResult[];
  failures: FailureDetail[];
  
  // For next iteration
  nextActions: NextAction[];
  
  // For anti-thrashing
  failureSignature: string;  // Hash of failed criteria IDs
}

interface CriterionResult {
  id: string;
  name: string;
  tag: "AUTO_VERIFY" | "HUMAN_VERIFY" | "TOOL_VERIFY";
  status: "PASS" | "FAIL" | "SKIP" | "PENDING_HUMAN" | "ERROR";
  evidence?: string;
  error?: string;
}

interface FailureDetail {
  criterionId: string;
  criterionName: string;
  expected: string;
  actual: string;
  gap: string;
  file?: string;
  line?: number;
  suggestedFix: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

interface NextAction {
  priority: number;
  criterionId: string;
  action: string;
  file: string;
  estimatedLines: number;
}
```

---

## 11. Phase 5: Process Verdict

### 11.1 CONVERGED Handling

```typescript
if (verdict === "CONVERGED") {
  // All AUTO_VERIFY passed
  
  // Save final state
  saveFinalState(feature, "CONVERGED", iterationHistory);
  
  // Generate success report
  const report = generateSuccessReport(feature, iterationHistory);
  
  // Check for pending HUMAN_VERIFY
  const pendingHuman = results.filter(r => r.status === 'PENDING_HUMAN');
  
  if (pendingHuman.length > 0) {
    // Exit with success, pending human review
    return {
      status: "CONVERGED_PENDING_HUMAN",
      message: "All automated criteria pass. Human verification required.",
      pendingCriteria: pendingHuman,
      nextStep: "Review HUMAN_VERIFY criteria, then /test-plan"
    };
  }
  
  // Full convergence
  return {
    status: "CONVERGED",
    message: "All criteria pass!",
    nextStep: "/test-plan → /code-review → /merge-feature"
  };
}
```

### 11.2 FAILED Handling

```typescript
if (verdict === "FAILED") {
  // Extract failure details for next iteration
  const failureContext: FailureContext = {
    iteration: currentIteration,
    failedCriteria: verifyResult.failures,
    passedCriteria: verifyResult.results.filter(r => r.status === 'PASS'),
    nextActions: verifyResult.nextActions
  };
  
  // Log iteration result
  logIterationResult({
    iteration: currentIteration,
    verdict: "FAILED",
    passed: verifyResult.passCount,
    failed: verifyResult.failCount,
    failures: verifyResult.failures.map(f => f.criterionId)
  });
  
  // Continue to next iteration with failure context
  return { continue: true, failureContext };
}
```

### 11.3 BLOCKED Handling

```typescript
if (verdict === "BLOCKED") {
  // Cannot proceed - needs human intervention
  
  saveFinalState(feature, "BLOCKED", iterationHistory);
  
  return {
    status: "BLOCKED",
    message: "Cannot verify - human intervention required",
    blockReason: verifyResult.blockReason,
    suggestion: verifyResult.blockSuggestion,
    nextStep: "Fix blocker, then /build-feature --resume"
  };
}
```

---

## 12. Phase 6: Iterate or Exit

### 12.1 Continue Decision

```typescript
function shouldContinue(
  iteration: number,
  maxIterations: number,
  verdict: Verdict,
  history: IterationRecord[]
): ContinueDecision {
  
  // Exit conditions
  if (verdict === "CONVERGED") {
    return { continue: false, reason: "SUCCESS" };
  }
  
  if (verdict === "BLOCKED") {
    return { continue: false, reason: "BLOCKED" };
  }
  
  if (iteration >= maxIterations) {
    return { continue: false, reason: "MAX_ITERATIONS" };
  }
  
  if (isRepeatingFailure(history)) {
    return { continue: false, reason: "STUCK" };
  }
  
  if (isRegressing(history)) {
    return { continue: false, reason: "REGRESSION" };
  }
  
  // Continue
  return { continue: true };
}
```

### 12.2 Exit Paths

| Exit Reason | Status | Human Action Required |
|-------------|--------|----------------------|
| SUCCESS | CONVERGED | Review HUMAN_VERIFY, then test/merge |
| BLOCKED | BLOCKED | Fix blocker, resume |
| MAX_ITERATIONS | ESCALATED | Review history, decide next steps |
| STUCK | ESCALATED | Different approach needed |
| REGRESSION | ESCALATED | Review what broke, manual fix |

---

## 13. Anti-Thrashing Protection

### 13.1 What is Thrashing?

Thrashing occurs when the agent:
- Makes the same fix repeatedly
- Alternates between two states
- Fixes A, breaks B, fixes B, breaks A

### 13.2 Detection Methods

#### Same Failure Repeated
```typescript
function isRepeatingFailure(history: IterationRecord[]): boolean {
  if (history.length < 2) return false;
  
  const current = history[history.length - 1].verifyResult.failureSignature;
  const previous = history[history.length - 2].verifyResult.failureSignature;
  
  // Same failures two iterations in a row
  if (current === previous) {
    return true;
  }
  
  // Check for oscillation (A → B → A)
  if (history.length >= 3) {
    const twoBack = history[history.length - 3].verifyResult.failureSignature;
    if (current === twoBack && current !== previous) {
      return true;  // Oscillating
    }
  }
  
  return false;
}
```

#### Regression Detection
```typescript
function isRegressing(history: IterationRecord[]): boolean {
  if (history.length < 2) return false;
  
  const current = history[history.length - 1].verifyResult;
  const previous = history[history.length - 2].verifyResult;
  
  // Check if previously passing criteria now fail
  const previouslyPassing = previous.results
    .filter(r => r.status === 'PASS')
    .map(r => r.id);
  
  const nowFailing = current.results
    .filter(r => r.status === 'FAIL')
    .map(r => r.id);
  
  const regressions = previouslyPassing.filter(id => nowFailing.includes(id));
  
  return regressions.length > 0;
}
```

### 13.3 Thrashing Response

When thrashing detected:

```markdown
## Build Feature Agent - STUCK

**Feature:** inventory-export
**Iterations completed:** 4 of 5
**Status:** ESCALATED (stuck pattern detected)

### Thrashing Detected
The same failure has occurred in iterations 3 and 4:
- F3: CSV missing 'location' column

### Attempted Fixes
| Iteration | Fix Attempted | Result |
|-----------|---------------|--------|
| 2 | Added location to SELECT | Still missing in output |
| 3 | Added location to row mapping | Column present but empty |
| 4 | Fixed null handling | Same error |

### Analysis
The fix is being applied but not taking effect. Possible causes:
1. Caching issue (old code running)
2. Wrong file being edited
3. Build not completing

### Recommended Human Action
1. Clear all caches: `Remove-Item -Recurse -Force .next, node_modules/.cache`
2. Restart dev server
3. Verify the correct file contains the changes
4. Run `/build-feature inventory-export --resume`
```

---

## 14. Context Management

### 14.1 The Context Problem

Long-running loops accumulate context:
- Each iteration adds build details
- Each verification adds results
- History grows unboundedly

This can exceed context window limits.

### 14.2 Context Summarization Strategy

After each iteration, summarize rather than retain full history:

```markdown
## Iteration History Summary

### Iteration 1 (FAILED)
- Built: API route + button
- Passed: F1, F2
- Failed: F3 (missing column), F4 (count mismatch), E1 (no toast), P1 (too slow)
- Key insight: Forgot location field

### Iteration 2 (FAILED)
- Fixed: F3 (added location), F4 (fixed query), P1 (added streaming)
- Still failing: E1 (no toast)
- Key insight: Need to add empty check

### Current (Iteration 3)
- Fixing: E1
- Changes planned: Add length check before export
```

### 14.3 What to Keep vs Discard

| Keep | Discard |
|------|---------|
| Failure reasons | Full verification output |
| Files modified | Complete file contents |
| Key insights | Intermediate attempts |
| Current passing criteria | Detailed evidence |
| Regression warnings | Screenshots |

### 14.4 Checkpoint State

Save full state to disk, keep summary in context:

```json
// docs/features/<feature>/build-state.json
{
  "feature": "inventory-export",
  "currentIteration": 3,
  "maxIterations": 5,
  "status": "IN_PROGRESS",
  "startedAt": "2026-01-16T10:00:00Z",
  "lastUpdated": "2026-01-16T10:45:00Z",
  "criteriaStatus": {
    "F1": "PASS",
    "F2": "PASS",
    "F3": "PASS",
    "F4": "PASS",
    "E1": "PENDING",
    "P1": "PASS",
    "U1": "PENDING_HUMAN"
  },
  "iterationHistory": [
    // Full details saved to disk
  ],
  "filesModified": [
    "apps/web/app/api/inventory/export/route.ts",
    "apps/web/app/(dashboard)/inventory/page.tsx"
  ]
}
```

---

## 15. Scope Guards

### 15.1 Why Scope Guards?

Prevent the agent from:
- Modifying unrelated files
- Making sweeping changes
- Touching sensitive files
- Exceeding reasonable bounds

### 15.2 File Restrictions

```typescript
const SCOPE_GUARDS = {
  // Files that cannot be modified
  blocklist: [
    'package.json',           // Dependency changes need human review
    'package-lock.json',
    '*.config.js',            // Config changes are risky
    '*.config.ts',
    'supabase/migrations/*',  // Database migrations need human review
    '.env*',                  // Environment files
    'CLAUDE.md',              // Project config
  ],
  
  // Maximum files per iteration
  maxFilesPerIteration: 10,
  
  // Maximum lines changed per iteration
  maxLinesPerIteration: 500,
  
  // Require confirmation for these directories
  confirmRequired: [
    'lib/auth/*',             // Auth changes are sensitive
    'lib/supabase/*',         // Database client changes
    'middleware.ts',          // Request handling
  ]
};
```

### 15.3 Scope Violation Response

```markdown
## Scope Guard Triggered

**Attempted action:** Modify package.json to add new dependency
**Guard:** package.json is on blocklist

**Reason:** Dependency changes require human review for:
- Security implications
- Bundle size impact
- Compatibility verification

**Options:**
1. Continue without this change (may not fully satisfy criteria)
2. EXIT and request human to add dependency

**Choosing:** EXIT for human intervention

**Human action required:**
```powershell
npm install papaparse
```
Then run: `/build-feature inventory-export --resume`
```

---

## 16. State Management

### 16.1 Directory Structure

```
docs/
├── agents/
│   └── build-feature/
│       ├── spec.md           # This document
│       └── state.json        # Global agent state
│
└── features/
    └── <feature-name>/
        ├── done-criteria.md  # From Define Done
        ├── build-state.json  # Current build state
        ├── build-log.md      # Human-readable log
        ├── verify-report.md  # Latest verify result
        └── evidence/         # Screenshots, outputs
```

### 16.2 Build State Schema

```json
{
  "feature": "inventory-export",
  "status": "IN_PROGRESS" | "CONVERGED" | "BLOCKED" | "ESCALATED",
  "currentIteration": 3,
  "maxIterations": 5,
  "startedAt": "2026-01-16T10:00:00Z",
  "lastUpdated": "2026-01-16T10:45:00Z",
  
  "criteria": {
    "total": 7,
    "autoVerify": 6,
    "humanVerify": 1,
    "passing": 5,
    "failing": 1,
    "pending": 1
  },
  
  "iterations": [
    {
      "number": 1,
      "startedAt": "2026-01-16T10:00:00Z",
      "completedAt": "2026-01-16T10:15:00Z",
      "verdict": "FAILED",
      "passCount": 2,
      "failCount": 4,
      "failedCriteria": ["F3", "F4", "E1", "P1"],
      "filesCreated": ["apps/web/app/api/inventory/export/route.ts"],
      "filesModified": ["apps/web/app/(dashboard)/inventory/page.tsx"]
    },
    {
      "number": 2,
      "startedAt": "2026-01-16T10:15:00Z",
      "completedAt": "2026-01-16T10:30:00Z",
      "verdict": "FAILED",
      "passCount": 5,
      "failCount": 1,
      "failedCriteria": ["E1"],
      "filesModified": ["apps/web/app/api/inventory/export/route.ts"]
    }
  ],
  
  "antiThrashing": {
    "failureSignatures": ["F3,F4,E1,P1", "E1"],
    "repeatedFailures": 0,
    "regressions": 0
  }
}
```

### 16.3 Resume Logic

When `--resume` flag is used:

```typescript
async function resumeBuild(feature: string) {
  const state = loadBuildState(feature);
  
  if (!state) {
    throw new Error("No saved state found. Start fresh with /build-feature");
  }
  
  if (state.status === "CONVERGED") {
    return { message: "Feature already converged. Run /test-plan next." };
  }
  
  if (state.status === "ESCALATED") {
    // Allow resume after human intervention
    log("Resuming from escalated state. Human should have addressed blocker.");
  }
  
  // Continue from last iteration
  return buildFeatureLoop(feature, state.maxIterations, state.currentIteration);
}
```

---

## 17. Escalation & Exit Conditions

### 17.1 Exit Condition Matrix

| Condition | Status | Auto-Resume | Human Action |
|-----------|--------|-------------|--------------|
| All AUTO_VERIFY pass | CONVERGED | No | Review HUMAN_VERIFY |
| Max iterations reached | ESCALATED | No | Review, decide approach |
| Same failure 2x | ESCALATED | No | Investigate root cause |
| Regression detected | ESCALATED | No | Review what broke |
| App not running | RECOVERED | Yes | Auto: start server (see Section 5) |
| Port conflict | RECOVERED | Yes | Auto: kill-port + restart |
| Build error | RECOVERED | Yes | Auto: attempt fix, restart |
| Recovery exhausted | BLOCKED | No | Review recovery log, fix manually |
| Credentials missing | BLOCKED | No | Provide secrets |
| Destructive action needed | BLOCKED | No | Confirm & execute manually |
| Ambiguous requirement | BLOCKED | No | Clarify criteria |
| External dependency down | BLOCKED | No | Wait for service restoration |
| File in blocklist | BLOCKED | Yes | Make manual change |
| Criteria file missing | ERROR | No | Run /define-done |

### 17.2 Escalation Report Format

```markdown
## Build Feature Agent - ESCALATED

**Feature:** inventory-export
**Reason:** Maximum iterations (5) reached without convergence
**Time spent:** 45 minutes

### Final Status
| Criteria | Status |
|----------|--------|
| F1: Button exists | ✅ PASS |
| F2: CSV downloads | ✅ PASS |
| F3: CSV columns | ✅ PASS |
| F4: Data matches | ✅ PASS |
| E1: Empty toast | ❌ FAIL |
| P1: Performance | ✅ PASS |
| U1: Button placement | 👤 PENDING |

### Iteration Summary
| # | Verdict | Progress |
|---|---------|----------|
| 1 | FAILED | 2/6 passing |
| 2 | FAILED | 4/6 passing |
| 3 | FAILED | 5/6 passing |
| 4 | FAILED | 5/6 passing |
| 5 | FAILED | 5/6 passing |

### Stuck Point
Criterion E1 has failed for 3 consecutive iterations.

**Attempted fixes:**
1. Added `if (items.length === 0)` check - toast not showing
2. Changed to `if (!items || items.length === 0)` - still not showing
3. Added console.log to confirm code path - log appears but toast doesn't

**Possible issues:**
- Toast library not properly configured
- Component not wrapped in Toaster provider
- Race condition with data loading

### Recommended Human Action
1. Verify `<Toaster />` is in layout.tsx
2. Check toast import is from correct package (sonner vs react-hot-toast)
3. Test toast manually in browser console

After fixing, run:
```powershell
/build-feature inventory-export --resume
```
```

---

## 18. Error Handling

| Error | Response | Recovery |
|-------|----------|----------|
| done-criteria.md not found | EXIT with ERROR | Run /define-done first |
| App not running | EXIT with BLOCKED | Start app, --resume |
| TypeScript compile error | Attempt fix, then verify | Auto-retry once |
| Git conflict | EXIT with BLOCKED | Resolve conflict, --resume |
| File write permission | EXIT with BLOCKED | Fix permissions, --resume |
| Verify Done timeout | Retry once, then EXIT | Check app health |
| Out of context window | Summarize and continue | Auto-handled |

### Error Recovery Flow

```typescript
async function handleBuildError(error: Error, context: BuildContext): Promise<ErrorResponse> {
  // Classify error
  const errorType = classifyError(error);
  
  switch (errorType) {
    case 'COMPILE_ERROR':
      // Try to fix automatically
      const fix = await attemptAutoFix(error);
      if (fix.success) {
        return { retry: true };
      }
      return { exit: true, status: 'BLOCKED', message: fix.failureReason };
      
    case 'RUNTIME_ERROR':
      // Log and exit for human review
      return { exit: true, status: 'BLOCKED', message: error.message };
      
    case 'VERIFICATION_ERROR':
      // Retry verification once
      if (context.verifyRetries < 1) {
        return { retry: true, incrementVerifyRetries: true };
      }
      return { exit: true, status: 'BLOCKED', message: 'Verification failed repeatedly' };
      
    default:
      return { exit: true, status: 'ERROR', message: error.message };
  }
}
```

---

## 19. Output Templates

### 19.1 Iteration Progress Output

```markdown
## Build Feature - Iteration 2 of 5

### Building
- Reading failure context from iteration 1...
- Planning fixes for: F3, F4, E1, P1
- Modifying: apps/web/app/api/inventory/export/route.ts
- ✅ Changes applied

### Verifying
- F1: Export Button Exists... ✅ PASS
- F2: CSV Downloads... ✅ PASS
- F3: CSV Columns... ✅ PASS (fixed!)
- F4: Data Matches... ✅ PASS (fixed!)
- E1: Empty Toast... ❌ FAIL
- P1: Performance... ✅ PASS (fixed!)

### Result
**Verdict:** FAILED (1 remaining)
**Progress:** 5/6 criteria passing (was 2/6)

### Continuing to iteration 3...
Failure context: E1 needs empty inventory check with toast
```

### 19.2 Success Output

```markdown
## Build Feature - CONVERGED ✅

**Feature:** inventory-export
**Iterations:** 3 of 5
**Duration:** 28 minutes

### Final Status
| Criteria | Status |
|----------|--------|
| F1: Button exists | ✅ PASS |
| F2: CSV downloads | ✅ PASS |
| F3: CSV columns | ✅ PASS |
| F4: Data matches | ✅ PASS |
| E1: Empty toast | ✅ PASS |
| P1: Performance | ✅ PASS |
| U1: Button placement | 👤 PENDING |

### Convergence Path
| Iteration | Passing | Action |
|-----------|---------|--------|
| 1 | 2/6 | Initial build |
| 2 | 5/6 | Fixed columns, query, perf |
| 3 | 6/6 | Fixed empty toast |

### Files Changed
- Created: `apps/web/app/api/inventory/export/route.ts`
- Modified: `apps/web/app/(dashboard)/inventory/page.tsx`

### Human Verification Required
Please review criterion U1 (Button placement):
- Screenshot: docs/features/inventory-export/evidence/u1-placement.png
- Confirm button is appropriately positioned in toolbar

### Next Steps
After confirming U1:
1. `/test-plan inventory-export` - Generate test coverage
2. `/code-review` - Review all changes
3. `/merge-feature` - Merge to main
```

---

## 20. Handoffs

### 20.1 Entry: From Define Done

```markdown
## Define Done → Build Feature

Feature: inventory-export
Criteria: docs/features/inventory-export/done-criteria.md

Ready for: /build-feature inventory-export
```

### 20.2 Exit: To Human (CONVERGED)

```markdown
## Build Feature → Human

**Status:** CONVERGED
**Pending:** HUMAN_VERIFY criteria review

Please review:
- U1: Button placement screenshot

After approval, continue with:
/test-plan inventory-export
```

### 20.3 Exit: To Human (ESCALATED)

```markdown
## Build Feature → Human

**Status:** ESCALATED
**Reason:** [reason]

Human action required:
[specific action]

After resolving:
/build-feature inventory-export --resume
```

### 20.4 Exit: To Test Plan (After Human Approval)

```markdown
## Build Feature → Test Plan

Feature inventory-export has CONVERGED and been approved.

Files changed:
- apps/web/app/api/inventory/export/route.ts (new)
- apps/web/app/(dashboard)/inventory/page.tsx (modified)

Criteria that need test coverage:
- F1: Button exists → Component test
- F2: Download triggers → E2E test
- F3: CSV columns → Integration test
- F4: Data matches → Integration test
- E1: Empty toast → Component test
- P1: Performance → Performance test

Run: /test-plan inventory-export
```

---

## 21. Examples

### 21.1 Successful Build (3 iterations)

```
Human: /build-feature inventory-export

Agent: ## Build Feature Agent - Boot Complete

**Feature:** inventory-export
**Max iterations:** 5
**Criteria:** 7 (6 AUTO_VERIFY, 1 HUMAN_VERIFY)

Starting autonomous build loop...

---

## Iteration 1 of 5

### Planning
Analyzing criteria...
- F1: Need export button in toolbar
- F2: Need CSV download API
- F3: CSV must include 7 columns
- F4: Data must match inventory
- E1: Need empty state handling
- P1: Must handle 1000 items in <5s

Creating implementation plan...

### Building
Creating: apps/web/app/api/inventory/export/route.ts
Modifying: apps/web/app/(dashboard)/inventory/page.tsx
✅ Build complete

### Verifying
- F1: Export Button... ✅ PASS
- F2: CSV Downloads... ✅ PASS
- F3: CSV Columns... ❌ FAIL (missing 'location')
- F4: Data Matches... ❌ FAIL (count mismatch)
- E1: Empty Toast... ❌ FAIL (no toast shown)
- P1: Performance... ❌ FAIL (8.2s > 5s threshold)

**Verdict:** FAILED (4 criteria)
**Progress:** 2/6 passing

---

## Iteration 2 of 5

### Planning (from failure context)
Fixes needed:
1. F3: Add 'location' to CSV columns
2. F4: Fix query to match table data
3. E1: Add empty check with toast
4. P1: Add streaming for large datasets

### Building
Modifying: apps/web/app/api/inventory/export/route.ts
Modifying: apps/web/app/(dashboard)/inventory/page.tsx
✅ Build complete

### Verifying
- F1: Export Button... ✅ PASS
- F2: CSV Downloads... ✅ PASS
- F3: CSV Columns... ✅ PASS (fixed!)
- F4: Data Matches... ✅ PASS (fixed!)
- E1: Empty Toast... ❌ FAIL (toast not appearing)
- P1: Performance... ✅ PASS (fixed! 1.8s)

**Verdict:** FAILED (1 criterion)
**Progress:** 5/6 passing

---

## Iteration 3 of 5

### Planning (from failure context)
Single fix needed:
- E1: Toast not showing - check Toaster provider and import

### Building
Verifying Toaster in layout... present
Checking import... wrong package!
Fixing: Change import from 'react-hot-toast' to 'sonner'
✅ Build complete

### Verifying
- F1: Export Button... ✅ PASS
- F2: CSV Downloads... ✅ PASS
- F3: CSV Columns... ✅ PASS
- F4: Data Matches... ✅ PASS
- E1: Empty Toast... ✅ PASS (fixed!)
- P1: Performance... ✅ PASS
- U1: Button Placement... 👤 PENDING_HUMAN

**Verdict:** CONVERGED ✅

---

## Build Feature - CONVERGED

**Iterations:** 3 of 5
**Duration:** 24 minutes

All AUTO_VERIFY criteria pass.

### Human Verification Required
Please review U1 (Button placement):
Screenshot: docs/features/inventory-export/evidence/u1-placement.png

### Next Steps
After confirming U1:
1. /test-plan inventory-export
2. /code-review
3. /merge-feature
```

### 21.2 Escalated Build (Max Iterations)

```
Human: /build-feature complex-import

[... iterations 1-5 shown ...]

---

## Build Feature - ESCALATED

**Feature:** complex-import
**Reason:** Maximum iterations (5) reached
**Status:** 4/7 criteria passing

### Persistent Failures
- F5: File validation (failed 4x)
- F6: Duplicate handling (failed 3x)
- E2: Large file error (failed 5x)

### Analysis
E2 (Large file error) appears to be a fundamental issue:
- Browser memory limit being hit
- Streaming approach not sufficient
- May need server-side processing

### Recommendation
This feature may need architectural changes:
1. Move file processing to API route (not client)
2. Implement chunked upload
3. Add progress indicator

This exceeds simple iteration fixes.

### Human Action Required
Review and decide:
A) Simplify criteria (remove large file support for MVP)
B) Implement architectural changes manually
C) Break into smaller features

After decision:
- If A: Update done-criteria.md, then /build-feature --resume
- If B: Make changes, then /build-feature --resume
- If C: /define-done for each sub-feature
```

---

## 22. The Golden Rule

```
┌─────────────────────────────────────────────────────────────────┐
│                    THE GOLDEN RULE                               │
│                                                                 │
│  YOU HAVE NOT COMPLETED THE TASK UNTIL YOU HAVE:                │
│                                                                 │
│  1. EXECUTED verification against EVERY AUTO_VERIFY criterion   │
│  2. SHOWN the ACTUAL output/evidence for each criterion         │
│  3. RECEIVED verdict: CONVERGED from Verify Done                │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  "I implemented it" without verification = INCOMPLETE           │
│  "Verified" without showing results = NOT VERIFIED              │
│  "It should work" without evidence = UNACCEPTABLE               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Appendix A: Command Quick Reference

```powershell
# Start new build
/build-feature <feature-name>

# With custom iteration limit
/build-feature <feature-name> --max-iterations=10

# Resume after interruption or human fix
/build-feature <feature-name> --resume

# Preview plan without executing
/build-feature <feature-name> --dry-run

# Check status of in-progress build
/build-feature <feature-name> --status
```

---

## Appendix B: Troubleshooting

| Symptom | Likely Cause | Solution |
|---------|--------------|----------|
| Same failure every iteration | Fix not taking effect | Clear caches, restart server |
| Regression on passing criteria | Change broke something | Review diff, revert specific change |
| Verification timeout | App crashed or hung | Restart app, check logs |
| "Criteria not found" | Wrong feature name | Check docs/features/ directory |
| Stuck at iteration 1 | Build errors | Check TypeScript compilation |

---

**End of Build Feature Agent Specification**
