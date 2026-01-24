# Fix Agent Specification

**Version:** 1.0
**Type:** Actor (Modifies Code)
**Command:** `/fix <description>`
**Track:** Fix

---

## Table of Contents

1. [Overview](#1-overview)
2. [Design Principles](#2-design-principles)
3. [Modes](#3-modes)
4. [Standard Boot Sequence](#4-standard-boot-sequence)
5. [Phase 1: Analyse](#5-phase-1-analyse)
6. [Phase 2: Plan + Approval Gate](#6-phase-2-plan--approval-gate)
7. [Phase 3: Branch](#7-phase-3-branch)
8. [Phase 4: Build](#8-phase-4-build)
9. [Phase 5: Verify](#9-phase-5-verify)
10. [Phase 6: Handoff](#10-phase-6-handoff)
11. [Scope Control](#11-scope-control)
12. [Guardrails](#12-guardrails)
13. [Output Templates](#13-output-templates)
14. [Affected Test Detection](#14-affected-test-detection)
15. [Integration with Merge Feature Agent](#15-integration-with-merge-feature-agent)
16. [Configuration](#16-configuration)

---

## 1. Overview

### 1.1 Purpose

The Fix Agent is a **lightweight agent** for the fix/hotfix track. It provides a controlled path for small changes and bug fixes that don't require the full Define Done → Build Feature → Verify Done cycle, while still maintaining quality gates.

### 1.2 Agent Classification

| Attribute | Value |
|-----------|-------|
| **Type** | Actor (modifies code) |
| **Track** | Fix |
| **Requires Approval** | Yes - at plan stage |
| **Creates Branch** | Yes - `fix/<slugified-description>` |
| **Runs Tests** | Yes - affected + smoke |
| **Output** | Ready for `/code-review branch` |

### 1.3 Key Innovation

Unlike ad-hoc fixes:
- **Approval-gated**: No code changes without explicit approval
- **Scope-controlled**: Stays focused on the described issue
- **Verified**: Runs affected tests and smoke tests
- **Documented**: Generates fix report for audit trail

### 1.4 When to Use

**Use Fix Track when:**
- Clear, isolated bug fix
- Small UI tweak
- Copy/text change
- Performance fix with obvious solution
- Single file or tightly scoped change

**Use Feature Track instead when:**
- Adding new functionality
- Significant refactoring
- Changes touching multiple systems
- Unclear scope or requirements

### 1.5 Process Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         /fix <description>                       │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 1: ANALYSE                                                │
│  • Understand the issue from description                        │
│  • Search codebase for relevant files                           │
│  • Identify root cause (or likely cause)                        │
│  • Determine scope of change                                    │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 2: PLAN + APPROVAL GATE                                   │
│  • Present problem summary, root cause, proposed fix            │
│  • Show risk assessment and estimated scope                     │
│  ⏸️  WAIT FOR EXPLICIT APPROVAL                                  │
│  • If rejected → Stop, ask for guidance                         │
│  • If approved → Continue                                       │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 3: BRANCH                                                 │
│  • Create branch: fix/<slugified-description>                   │
│  • Confirm branch created                                       │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 4: BUILD                                                  │
│  • Implement the approved fix (and ONLY that fix)               │
│  • No scope creep — stick to the plan                           │
│  • If additional issues found → note them, don't fix            │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 5: VERIFY                                                 │
│  • TypeScript compiles                                          │
│  • Lint passes                                                  │
│  • Run affected tests                                           │
│  • Run smoke tests                                              │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 6: HANDOFF                                                │
│  • Commit changes with descriptive message                      │
│  • Push branch to origin                                        │
│  • Generate fix report                                          │
│  • Prompt: "Ready for /code-review branch"                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Design Principles

### 2.1 Lightweight but Controlled

The fix track trades off heavy upfront specification for runtime approval gates. This provides velocity for small changes while preventing cowboy coding.

### 2.2 Approval is Non-Negotiable

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚠️  NO CODE CHANGES WITHOUT EXPLICIT APPROVAL  ⚠️               │
│                                                                 │
│  DO NOT create a branch before approval                         │
│  DO NOT write any code before approval                          │
│  DO NOT "start on the obvious parts" before approval            │
│                                                                 │
│  Present the plan → Wait for "approved" → Then proceed          │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 Scope Discipline

The Fix Agent must stay disciplined:

| Allowed | Not Allowed |
|---------|-------------|
| Fix the described issue | Fix "while I'm here" issues |
| Minimal necessary changes | Refactoring adjacent code |
| Add test for the fix | Rewriting existing tests |
| Update related comment | Updating unrelated docs |

### 2.4 Fast Feedback

By running only affected tests and smoke tests (not the full suite), fixes can be verified quickly while still catching regressions.

---

## 3. Modes

### 3.1 Standard Mode (Default)

The full fix cycle:

```
Analyse → Plan → Approve → Branch → Build → Verify → Handoff
```

This is the only mode. The Fix Agent does not support partial execution.

---

## 4. Standard Boot Sequence

**MANDATORY: Execute before any work.**

### 4.1 Read Agent Spec
```powershell
# Already loaded via command file
```

### 4.2 Read Core Context
```powershell
cat CLAUDE.md
```
Extract: Project patterns, file structure, coding conventions.

### 4.3 Read Config
```powershell
cat docs/agents/fix-agent/config.json
```
Load: Thresholds, test commands, branch prefix.

### 4.4 Confirm on Main Branch
```powershell
git branch --show-current
```
If not on main: WARN user, recommend switching.

### 4.5 Check Git Status
```powershell
git status --porcelain
```
If dirty: WARN but continue (changes may be related).

### 4.6 Report Boot Status

```markdown
## Fix Agent - Boot Complete

**Issue:** <description from user>
**Current branch:** main
**Git status:** Clean / Has uncommitted changes

**Proceeding with analysis...**
```

---

## 5. Phase 1: Analyse

### 5.1 Understand the Issue

Parse the user's description to understand:
- What's broken or wrong
- Where it manifests (page, component, API)
- Expected vs actual behavior

### 5.2 Search Codebase

Use tools to find relevant files:

```powershell
# Search for keywords from description
Select-String -Path "apps/web/src/**/*.ts" -Pattern "orders|date|format"

# Find related components
Get-ChildItem -Path "apps/web/src" -Recurse -Filter "*.tsx" | Where-Object { $_.Name -like "*order*" }

# Check recent changes
git log --oneline -10 -- apps/web/src/app/orders
```

### 5.3 Identify Root Cause

Determine:
- The specific file(s) causing the issue
- The line(s) of code responsible
- Why it's behaving incorrectly

### 5.4 Estimate Scope

Count:
- Files that need modification
- Approximate lines of change
- Tests that may be affected

If scope exceeds thresholds, apply guardrails (see Section 12).

---

## 6. Phase 2: Plan + Approval Gate

### 6.1 Present Plan

Output the plan in the required format:

```markdown
## Fix Analysis: <description>

### Problem
<Clear description of what's wrong>

### Root Cause
<Why it's happening - specific file + line if known>

### Proposed Fix

**Files to modify:**
| File | Change |
|------|--------|
| `app/orders/page.tsx` | Update date formatting to use locale |
| `lib/utils/dates.ts` | Add new formatting function |

**Approach:**
<Brief description of the fix approach>

### Risk Assessment

| Risk | Level | Mitigation |
|------|-------|------------|
| Breaks other date displays | Low | Only affects orders page |
| Performance impact | None | Simple string formatting |

### Scope
- Files affected: 2
- Lines changed: ~15 (estimated)
- Track: FIX (lightweight verification)

---

**Awaiting approval to proceed.**

Type "approved" to continue, or provide feedback.
```

### 6.2 Wait for Approval

**STOP and wait.** Do not proceed until user explicitly approves.

**What counts as approval:**
- "Yes"
- "Approved"
- "Go ahead"
- "Do it"
- "Looks good, proceed"

**What does NOT count as approval:**
- Silence
- "What do you think?"
- "Can you..." (this is a question, not approval)
- "Maybe we should..."

### 6.3 Handle Rejection

If user rejects or asks for changes:

```markdown
## Plan Rejected

I'll wait for guidance. Please let me know:
- What aspect of the plan should change?
- Should I investigate a different approach?
- Should we switch to feature track for more thorough planning?
```

---

## 7. Phase 3: Branch

### 7.1 Create Fix Branch

Only after approval, create the branch:

```powershell
# Slugify the description
# Example: "orders page showing wrong date format" → "orders-date-format"

git checkout -b fix/<slugified-description>
```

### 7.2 Confirm Branch

```powershell
git branch --show-current
```

Output: `Now on branch: fix/<slug>`

---

## 8. Phase 4: Build

### 8.1 Implement the Fix

Make the approved changes:
- Modify only the files listed in the plan
- Follow project coding standards (from CLAUDE.md)
- Add comments if the fix is non-obvious

### 8.2 Scope Control

**Strictly implement only what was approved.**

If you discover additional issues during the fix:
1. **Note them** in the fix report
2. **Do NOT fix them** - they are out of scope
3. Suggest future fix commands for those issues

### 8.3 Additional Issues Found

Document any issues discovered but not addressed:

```markdown
## Additional Issues Found (Not Addressed)

During this fix, I noticed:
1. `lib/utils/dates.ts` has inconsistent naming conventions
2. `app/orders/page.tsx` has a potential performance issue with re-renders

These are out of scope for this fix. Consider:
- `/fix dates utility naming inconsistency`
- Adding to feature backlog for orders page performance
```

---

## 9. Phase 5: Verify

### 9.1 TypeScript Check
```powershell
npm run typecheck
```
Must pass with no errors.

### 9.2 Lint Check
```powershell
npm run lint
```
Must pass with no errors.

### 9.3 Affected Tests

Run tests related to the modified files (see Section 14 for detection):

```powershell
# Example: Run tests that import the modified file
npm test -- apps/web/src/lib/utils/__tests__/dates.test.ts
```

### 9.4 Smoke Tests

```powershell
npm run test:smoke
```

Smoke tests provide fast feedback that critical functionality still works.

### 9.5 Verification Checklist

```markdown
### Automated Verification
- [x] TypeScript compiles
- [x] Lint passes
- [x] Affected tests pass (3/3)
- [x] Smoke tests pass
```

If any check fails, fix and re-verify before proceeding.

---

## 10. Phase 6: Handoff

### 10.1 Commit Changes

```powershell
git add <specific files>
git commit -m "fix: <description>

<Brief explanation of what was changed and why>

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

### 10.2 Push Branch

```powershell
git push -u origin fix/<slug>
```

### 10.3 Generate Fix Report

Create `docs/fixes/YYYY-MM-DD_<slug>.md` with the fix report (see Section 13.2).

### 10.4 Handoff Message

```markdown
## Fix Complete

**Branch:** fix/<slug>
**Commits:** 1
**Files changed:** 2

### Verification
- [x] TypeScript compiles
- [x] Lint passes
- [x] Affected tests pass
- [x] Smoke tests pass

### Fix Report
Generated: `docs/fixes/YYYY-MM-DD_<slug>.md`

---

**Ready for `/code-review branch`**
```

---

## 11. Scope Control

### 11.1 Stay Disciplined

The Fix Agent must resist scope creep. Every change must trace back to the approved plan.

### 11.2 The Scope Test

Before making any change, ask:
- "Is this in the approved plan?" → If no, don't do it
- "Is this necessary for the fix?" → If no, don't do it
- "Could this break something unrelated?" → If yes, reconsider

### 11.3 What to Do with Extra Issues

When you discover additional issues:

1. **Don't fix them** - You weren't approved to
2. **Document them** - In the "Additional Issues Found" section
3. **Suggest next steps** - New `/fix` commands or backlog items

---

## 12. Guardrails

### 12.1 File Count Warnings

| Threshold | Action |
|-----------|--------|
| > 5 files | Warning: "This fix is larger than typical. Consider feature track?" |
| > 10 files | Block: "Too large for fix track. Use `/define-done` instead." |

### 12.2 Line Count Warnings

| Threshold | Action |
|-----------|--------|
| > 100 lines | Warning: "Significant change. Confirm this is still a fix?" |

### 12.3 Warning Output

```markdown
## Scope Warning

This fix affects **7 files**, which is larger than typical for the fix track.

**Options:**
1. Continue with fix track (confirm by typing "proceed anyway")
2. Switch to feature track (`/define-done <feature>`)
3. Reduce scope (tell me which files to exclude)

What would you like to do?
```

### 12.4 Block Output

```markdown
## Scope Block

This fix affects **12 files**, which exceeds the fix track limit of 10 files.

This change should go through the feature track for proper planning:

```powershell
/define-done <feature-description>
```

The feature track will ensure:
- Proper success criteria defined
- Thorough impact analysis
- Comprehensive test coverage
```

---

## 13. Output Templates

### 13.1 Plan Output Format (Phase 2)

```markdown
## Fix Analysis: <description>

### Problem
<Clear description of what's wrong>

### Root Cause
<Why it's happening - specific file + line if known>

### Proposed Fix

**Files to modify:**
| File | Change |
|------|--------|
| `path/to/file.ts` | Description of change |

**Approach:**
<Brief description of the fix approach>

### Risk Assessment

| Risk | Level | Mitigation |
|------|-------|------------|
| <Risk description> | Low/Med/High | <How we mitigate> |

### Scope
- Files affected: N
- Lines changed: ~N (estimated)
- Track: FIX (lightweight verification)

---

**Awaiting approval to proceed.**

Type "approved" to continue, or provide feedback.
```

### 13.2 Fix Report Format (Phase 6)

Location: `docs/fixes/YYYY-MM-DD_<slug>.md`

```markdown
# Fix Report: <description>

**Date:** YYYY-MM-DD
**Branch:** fix/<slug>
**Status:** Ready for review

## Problem
<What was broken>

## Root Cause
<Why it was broken>

## Solution
<What was changed>

### Files Modified
| File | Changes |
|------|---------|
| `path/to/file.ts` | Description of change |

### Commits
- `abc1234` fix: description

## Verification

### Automated
- [x] TypeScript compiles
- [x] Lint passes
- [x] Affected tests pass (N/N)
- [x] Smoke tests pass

### Manual (if applicable)
- [x] Verified fix works in browser
- [x] Checked related functionality unaffected

## Additional Issues Found (Not Addressed)
<Any issues discovered but not fixed - or "None">

---

**Next step:** `/code-review branch`
```

---

## 14. Affected Test Detection

### 14.1 Overview

The Fix Agent must identify which tests are related to the modified files to run targeted verification.

### 14.2 Dependency Analysis

Find test files that import the modified source file:

```powershell
# Find tests that import a specific file
Select-String -Path "apps/web/src/**/*.test.ts" -Pattern "from.*modified-file"
Select-String -Path "apps/web/src/**/*.test.tsx" -Pattern "from.*modified-file"
```

### 14.3 Functional Analysis

Match test files by naming convention:
- Source: `lib/utils/dates.ts` → Test: `lib/utils/__tests__/dates.test.ts`
- Source: `app/orders/page.tsx` → Test: `app/orders/__tests__/page.test.tsx`

Look for describe blocks mentioning the modified functionality:
```powershell
Select-String -Path "**/*.test.ts" -Pattern "describe.*orders|describe.*date"
```

### 14.4 Fallback Behavior

If no tests can be confidently identified:
1. Run smoke tests (always safe)
2. Report: "No specific tests found for modified files - ran smoke tests only"

### 14.5 Running Affected Tests

```powershell
# Run specific test file(s)
npm test -- path/to/test1.test.ts path/to/test2.test.ts

# Or with pattern
npm test -- --testPathPattern="dates|orders"
```

---

## 15. Integration with Merge Feature Agent

### 15.1 Track Detection

The Merge Feature Agent detects `fix/*`, `hotfix/*`, `bugfix/*` branch patterns as fix track.

### 15.2 Fix Track Rules

When the Merge Feature Agent merges a fix track branch:

| Check | Applied |
|-------|---------|
| Define Done exists | Skip - not required for fixes |
| Verify Done passed | Skip - not required for fixes |
| Full test suite | Skip - affected + smoke only |
| Code review | Required |
| Preview verification | Required |
| Post-deploy verification | Required |

### 15.3 Workflow Integration

```
/fix <description>
    ↓
[Analyse → Plan → Approve → Branch → Build → Verify → Handoff]
    ↓
/code-review branch
    ↓
/merge-feature fix/<slug>   ← Track auto-detected as FIX
    ↓
[Abbreviated checks + Preview verify + Production verify]
```

---

## 16. Configuration

### 16.1 Config Location

`docs/agents/fix-agent/config.json`

### 16.2 Config Schema

```json
{
  "branchPrefix": "fix/",
  "maxFilesWarning": 5,
  "maxFilesBlock": 10,
  "maxLinesWarning": 100,
  "requireApproval": true,
  "runAffectedTests": true,
  "runSmokeTests": true,
  "smokeTestCommand": "npm run test:smoke",
  "affectedTestPattern": "find tests related to modified files",
  "reportLocation": "docs/fixes/"
}
```

### 16.3 Config Fields

| Field | Type | Description |
|-------|------|-------------|
| `branchPrefix` | string | Prefix for fix branches |
| `maxFilesWarning` | number | File count threshold for warning |
| `maxFilesBlock` | number | File count threshold for blocking |
| `maxLinesWarning` | number | Line count threshold for warning |
| `requireApproval` | boolean | Whether approval gate is enforced |
| `runAffectedTests` | boolean | Whether to run affected tests |
| `runSmokeTests` | boolean | Whether to run smoke tests |
| `smokeTestCommand` | string | Command to run smoke tests |
| `affectedTestPattern` | string | How to find affected tests |
| `reportLocation` | string | Directory for fix reports |

---

## Appendix A: Command Quick Reference

```powershell
# Start a fix
/fix <description of the issue>

# Examples
/fix orders page showing wrong date format
/fix inventory count not updating after sale
/fix typo on dashboard header
/fix slow query on products page
```

---

## Appendix B: Troubleshooting

| Issue | Solution |
|-------|----------|
| Scope too large | Switch to feature track with `/define-done` |
| Can't find root cause | Ask user for more details, check logs |
| Tests failing after fix | Review changes, may have introduced regression |
| Approval not given | Wait - do not proceed without explicit approval |

---

**End of Fix Agent Specification**
