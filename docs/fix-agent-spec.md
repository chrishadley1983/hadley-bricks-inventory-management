# Fix Agent Specification

## Overview

A lightweight agent for the fix/hotfix track. Provides a controlled path for small changes and bug fixes that don't require the full Define Done → Build Feature → Verify Done cycle, while still maintaining quality gates.

---

## Part 1: CLAUDE.md Documentation Updates

The following sections must be added to CLAUDE.md to enforce branch-based development.

### Add to CLAUDE.md: Branch Policy

```markdown
## Branch Policy

### Golden Rules

1. **All code changes require a branch** — Main is protected, direct commits blocked
2. **No code changes without approval** — Always present a plan and wait for explicit approval
3. **Branch naming determines workflow** — Different tracks for features vs fixes

### Branch Naming Convention

| Pattern | Track | Workflow |
|---------|-------|----------|
| `feature/*` | Feature | Full DBT cycle: Define Done → Build → Verify Done → Tests → Code Review → Merge |
| `fix/*` | Fix | Quick cycle: `/fix` agent → Code Review → Merge |
| `hotfix/*` | Fix | Same as fix/* |
| `bugfix/*` | Fix | Same as fix/* |
| `chore/*` | Feature | Full cycle (housekeeping can break things) |
| `refactor/*` | Feature | Full cycle (refactors can break things) |

### Approval Gates

**Before writing ANY code, you must:**

1. Present a clear plan of what you intend to change
2. Wait for explicit approval (e.g., "yes", "approved", "go ahead")
3. Only then create a branch and begin implementation

**Approval applies to:**
- New features
- Bug fixes
- Refactors
- Dependency updates
- Any file modification

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

### Workflow Selection

**Use Feature Track (`/define-done` → `/build-feature` → etc.) when:**
- Adding new functionality
- Significant refactoring
- Changes touching multiple systems
- Unclear scope or requirements

**Use Fix Track (`/fix`) when:**
- Clear, isolated bug fix
- Small UI tweak
- Copy/text change
- Performance fix with obvious solution
- Single file or tightly scoped change
```

### Add to CLAUDE.md: Agent Quick Reference

```markdown
## Agent Quick Reference

### Feature Track
```
/define-done <feature>     # Establish success criteria
/feature-spec <feature>    # Plan implementation (optional)
/build-feature <feature>   # Autonomous build loop
/verify-done <feature>     # Verify against done criteria
/test-plan analyze         # Check test coverage
/test-build                # Generate missing tests
/test-execute pre-merge    # Run full test suite
/code-review branch        # Review changes
/merge-feature <branch>    # Merge + deploy + verify
```

### Fix Track
```
/fix <description>         # Plan → Approve → Build → Test
/code-review branch        # Review changes
/merge-feature <branch>    # Merge + deploy + verify
```

### Standalone
```
/merge-feature check           # Pre-merge readiness
/merge-feature preview         # Test Vercel preview
/merge-feature verify-production  # Check production health
/merge-feature rollback        # Revert last deploy
```
```

---

## Part 2: Fix Agent Specification

### Command

```
/fix <description>
```

### Examples

```powershell
/fix orders page showing wrong date format
/fix inventory count not updating after sale
/fix typo on dashboard header
/fix slow query on products page
```

### Agent Type

| Attribute | Value |
|-----------|-------|
| **Type** | Actor (modifies code) |
| **Track** | Fix |
| **Requires Approval** | Yes — at plan stage |
| **Creates Branch** | Yes — `fix/<slugified-description>` |
| **Runs Tests** | Yes — affected + smoke |
| **Output** | Ready for `/code-review branch` |

---

### Process Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         /fix <description>                       │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 1: ANALYSE                                                │
│                                                                  │
│  • Understand the issue from description                        │
│  • Search codebase for relevant files                           │
│  • Identify root cause (or likely cause)                        │
│  • Determine scope of change                                    │
│                                                                  │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 2: PLAN + APPROVAL GATE                                   │
│                                                                  │
│  Present to user:                                                │
│  • Problem summary                                               │
│  • Root cause analysis                                          │
│  • Proposed fix (specific files + changes)                      │
│  • Risk assessment                                               │
│  • Estimated scope (files affected)                             │
│                                                                  │
│  ⏸️  WAIT FOR EXPLICIT APPROVAL                                  │
│                                                                  │
│  If rejected → Stop, ask for guidance                           │
│  If approved → Continue                                         │
│                                                                  │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 3: BRANCH                                                 │
│                                                                  │
│  • Create branch: fix/<slugified-description>                   │
│  • Confirm branch created                                       │
│                                                                  │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 4: BUILD                                                  │
│                                                                  │
│  • Implement the approved fix (and ONLY that fix)               │
│  • No scope creep — stick to the plan                           │
│  • If additional issues found → note them, don't fix            │
│                                                                  │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 5: VERIFY                                                 │
│                                                                  │
│  • TypeScript compiles                                          │
│  • Lint passes                                                  │
│  • Run affected tests                                           │
│  • Run smoke tests (if defined)                                 │
│  • Manual verification steps (if applicable)                    │
│                                                                  │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 6: HANDOFF                                                │
│                                                                  │
│  • Commit changes with descriptive message                      │
│  • Push branch to origin                                        │
│  • Generate fix report                                          │
│  • Prompt: "Ready for /code-review branch"                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

### Phase 2: Plan Output Format

```markdown
## Fix Analysis: <description>

### Problem
<Clear description of what's wrong>

### Root Cause
<Why it's happening — specific file + line if known>

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

---

### Phase 6: Fix Report Format

Location: `docs/fixes/YYYY-MM-DD_<slug>.md`

```markdown
# Fix Report: <description>

**Date:** 2025-01-24
**Branch:** fix/orders-date-format
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
| `app/orders/page.tsx` | Updated date formatting |
| `lib/utils/dates.ts` | Added `formatOrderDate()` function |

### Commits
- `abc1234` fix: update date formatting on orders page

## Verification

### Automated
- [x] TypeScript compiles
- [x] Lint passes
- [x] Affected tests pass (3/3)
- [x] Smoke tests pass

### Manual (if applicable)
- [x] Verified date displays correctly on orders page
- [x] Checked other pages unaffected

## Additional Notes
<Any issues discovered but not addressed — scope for future fixes>

---

**Next step:** `/code-review branch`
```

---

### Scope Control

The Fix Agent must stay disciplined:

| Allowed | Not Allowed |
|---------|-------------|
| Fix the described issue | Fix "while I'm here" issues |
| Minimal necessary changes | Refactoring adjacent code |
| Add test for the fix | Rewriting existing tests |
| Update related comment | Updating unrelated docs |

**If additional issues are discovered:**

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

### Configuration

Add to `docs/agents/fix-agent/config.json`:

```json
{
  "branchPrefix": "fix/",
  "maxFilesWarning": 5,
  "maxFilesBlock": 10,
  "requireApproval": true,
  "runAffectedTests": true,
  "runSmokeTests": true,
  "smokeTestCommand": "npm run test:smoke",
  "affectedTestPattern": "find tests related to modified files",
  "reportLocation": "docs/fixes/"
}
```

**Guardrails:**

| Threshold | Action |
|-----------|--------|
| > 5 files | Warning: "This fix is larger than typical. Consider feature track?" |
| > 10 files | Block: "Too large for fix track. Use `/define-done` instead." |
| > 100 lines | Warning: "Significant change. Confirm this is still a fix?" |

---

### Integration with Merge Feature Agent

Fix track flows into the extended Merge Feature Agent:

```
/fix <description>
    ↓
[Plan → Approve → Build → Test → Handoff]
    ↓
/code-review branch
    ↓
/merge-feature fix/xxx   ← Track auto-detected as FIX
    ↓
[Abbreviated checks + Preview verify + Production verify]
```

The Merge Feature Agent detects `fix/*` branch and applies fix track rules:

| Check | Applied |
|-------|---------|
| Define Done exists | ❌ Skip |
| Verify Done passed | ❌ Skip |
| Full test suite | ❌ Skip (affected + smoke only) |
| Code review | ✅ Required |
| Preview verification | ✅ Required |
| Post-deploy verification | ✅ Required |

---

### Command File

Create `.claude/commands/fix.md`:

```markdown
# Fix Command

You are now operating as the **Fix Agent**. Follow the comprehensive instructions in `docs/agents/fix-agent/spec.md`.

## Quick Reference

### Usage
```
/fix <description of the issue>
```

### Examples
```powershell
/fix orders page showing wrong date format
/fix inventory count not updating after sale
/fix typo on dashboard header
```

### Process
1. **Analyse** — Understand the issue, find root cause
2. **Plan** — Present fix approach, wait for approval
3. **Branch** — Create `fix/<slug>` branch
4. **Build** — Implement approved fix only
5. **Verify** — TypeScript, lint, affected tests
6. **Handoff** — Ready for `/code-review branch`

### Key Rules
- ⏸️ ALWAYS wait for approval before creating branch or writing code
- 🎯 Stay focused — fix only what was approved
- 📝 Note additional issues found, don't fix them
- 🚫 If scope grows beyond 10 files, escalate to feature track

### Output
- Fix report: `docs/fixes/YYYY-MM-DD_<slug>.md`
- Branch ready for code review
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `docs/agents/fix-agent/spec.md` | Full agent specification (this document) |
| `docs/agents/fix-agent/config.json` | Agent configuration |
| `.claude/commands/fix.md` | Claude Code command trigger |
| `docs/fixes/.gitkeep` | Fix reports directory |

## Files to Update

| File | Changes |
|------|---------|
| `CLAUDE.md` | Add Branch Policy + Agent Quick Reference sections |

---

## Summary

| Component | Purpose |
|-----------|---------|
| **CLAUDE.md updates** | Enforce "all changes need branch + approval" globally |
| **Fix Agent** | Controlled path for small changes: Plan → Approve → Build → Test |
| **Merge Feature integration** | Detects fix track, applies appropriate verification level |

The fix track provides velocity for bug fixes while maintaining:
- Approval gate (no cowboy coding)
- Branch isolation (main protected)
- Basic verification (tests still run)
- Code review (quality maintained)
- Production verification (stability maintained)
