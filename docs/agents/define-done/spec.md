# Define Done Agent Specification

**Version:** 1.0  
**Type:** Initializer (Interactive)  
**Command:** `/define-done <feature-name>`  
**Project:** Cross-project (Hadley Bricks, FamilyFuel, Personal Finance)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Design Principles](#2-design-principles)
3. [Modes](#3-modes)
4. [Standard Boot Sequence](#4-standard-boot-sequence)
5. [Phase 1: Feature Context Gathering](#5-phase-1-feature-context-gathering)
6. [Phase 2: Success Criteria Elicitation](#6-phase-2-success-criteria-elicitation)
7. [Phase 3: Criteria Validation](#7-phase-3-criteria-validation)
8. [Phase 4: Output Generation](#8-phase-4-output-generation)
9. [Anti-Vague Patterns](#9-anti-vague-patterns)
10. [State Management](#10-state-management)
11. [Error Handling](#11-error-handling)
12. [Output Templates](#12-output-templates)
13. [Handoffs](#13-handoffs)
14. [Examples](#14-examples)

---

## 1. Overview

### 1.1 Purpose

The Define Done Agent conducts an interactive session to establish **machine-verifiable success criteria** for a feature before any code is written. It forces clarity on what "done" means, preventing scope creep and enabling the Build Feature Agent to iterate toward a concrete target.

### 1.2 Why an Agent?

Defining "done" well requires:
- Understanding existing codebase context
- Asking probing questions to surface hidden requirements
- Distinguishing verifiable vs vague criteria
- Structuring output for downstream agents

This is too nuanced for a template and benefits from interactive refinement.

### 1.3 Agent Classification

| Property | Value |
|----------|-------|
| Type | Initializer (Interactive) |
| Modifies Code | No |
| Requires Running App | No |
| State Tracking | Yes |
| Human Interaction | Required (conversational) |

### 1.4 The Core Problem This Solves

**Without Define Done:**
```
Human: "Add inventory export"
Claude: *builds something*
Human: "That's not what I wanted"
Claude: *rebuilds differently*
Human: "Still not right"
[Repeat until frustration]
```

**With Define Done:**
```
Human: /define-done inventory-export
Agent: *asks clarifying questions*
Agent: *produces done-criteria.md with 5 verifiable criteria*
Human: "Yes, that's exactly what I need"
Build Agent: *builds to spec*
Verify Done: *confirms all 5 criteria pass*
```

### 1.5 Interactions

| Agent | Direction | Purpose |
|-------|-----------|---------|
| **Build Feature Agent** | → outputs to | Receives done-criteria.md |
| **Verify Done Agent** | → outputs to | Uses criteria for verification |
| **Feature Spec Agent** | → outputs to | Optional detailed spec |
| **Test Plan Agent** | → outputs to | Derives test cases from criteria |

---

## 2. Design Principles

### 2.1 The "Ralph Wiggum" Principle

> "If you can buy iteration, you can buy correctness—but only if correctness is anchored to something you can actually verify."

This agent's job is to **anchor correctness** by producing criteria that downstream agents can verify without human judgment.

### 2.2 Core Rules

1. **No Vague Criteria** - Every criterion must be binary (pass/fail)
2. **Machine-Verifiable First** - Prefer criteria a script can check
3. **Human-Verifiable Tagged** - If human judgment needed, mark explicitly
4. **Atomic Scope** - Each criterion tests ONE thing
5. **Evidence Required** - Each criterion defines what evidence proves it

### 2.3 The Verifiability Test

For each criterion, ask: *"Can the Verify Done Agent check this without asking a human?"*

| Criterion | Verifiable? | Why |
|-----------|-------------|-----|
| "Export works correctly" | ❌ No | What is "correctly"? |
| "Export button visible on /inventory page" | ✅ Yes | DOM check |
| "CSV contains all inventory columns" | ✅ Yes | Parse and validate |
| "Export is fast" | ❌ No | What is "fast"? |
| "Export completes in < 5 seconds for 1000 items" | ✅ Yes | Timed test |
| "UI looks good" | ❌ No | Subjective |
| "UI matches Figma design" | ⚠️ Partial | Needs visual diff tool |
| "No console errors during export" | ✅ Yes | Console check |

---

## 3. Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `new` | Start fresh definition session | New feature |
| `refine` | Improve existing done-criteria.md | Criteria too vague |
| `review` | Display current criteria for feature | Check before build |
| `validate` | Check criteria are well-formed | Pre-build validation |

### Command Examples

```powershell
# Start new definition session
/define-done inventory-export

# Refine existing criteria
/define-done inventory-export --refine

# Review what's defined
/define-done inventory-export --review

# Validate criteria quality
/define-done inventory-export --validate
```

---

## 4. Standard Boot Sequence

**MANDATORY: Execute before any work.**

### 4.0 Read Agent Spec
```powershell
cat docs/agents/define-done/spec.md
```

### 4.1 Read Core Context
```powershell
cat CLAUDE.md
```
Extract: Project patterns, tech stack, conventions.

### 4.2 Read Agent State
```powershell
cat docs/agents/define-done/state.json
```
Extract: Recent features defined, common criteria patterns.

### 4.3 Check for Existing Criteria
```powershell
cat docs/features/<feature-name>/done-criteria.md
```
If exists: Load for refinement. If not: Start fresh.

### 4.4 Scan Related Code (if feature touches existing functionality)
```powershell
# Identify files likely affected
# This informs what's feasible
```

### 4.5 Report Boot Status

```markdown
## Define Done Agent - Boot Complete

**Feature:** <feature-name>
**Mode:** new | refine
**Existing criteria:** Yes (5 criteria) | No

**Related code identified:**
- apps/web/app/(dashboard)/inventory/page.tsx
- apps/web/lib/repositories/inventoryRepository.ts

**Ready for definition session.**
```

---

## 5. Phase 1: Feature Context Gathering

### 5.1 Initial Questions

Before defining criteria, understand the feature:

```markdown
## Let's define "done" for: <feature-name>

To make sure we're aligned, I need to understand:

1. **What problem does this solve?**
   (User pain point or business need)

2. **Who is the user?**
   (You? End customer? API consumer?)

3. **What's the trigger?**
   (Button click? Scheduled job? API call?)

4. **What's the expected outcome?**
   (File download? Data change? UI update?)

5. **What's the scope boundary?**
   (What is explicitly NOT included?)
```

### 5.2 Context from Codebase

While gathering human input, also check:

| Check | Purpose |
|-------|---------|
| Existing similar features | Reuse patterns |
| Database schema | Understand data shape |
| API routes | Integration points |
| UI components | Reusable elements |

### 5.3 Output: Feature Context Summary

```markdown
## Feature Context: <feature-name>

**Problem:** Users cannot export inventory for use in spreadsheets
**User:** Business owner (Chris)
**Trigger:** Click "Export" button on inventory page
**Outcome:** CSV file downloads with all inventory data
**Scope:** Export only, not import. Current view only, not filtered.

**Related Code:**
- Inventory page: `apps/web/app/(dashboard)/inventory/page.tsx`
- Inventory data: `apps/web/lib/repositories/inventoryRepository.ts`
- No existing export functionality
```

---

## 6. Phase 2: Success Criteria Elicitation

### 6.1 Criteria Categories

Guide the human through each category:

| Category | Question | Example Criterion |
|----------|----------|-------------------|
| **Functional** | What must the feature DO? | "CSV contains item_id, name, quantity columns" |
| **UI/UX** | What must the user SEE/EXPERIENCE? | "Export button visible in toolbar" |
| **Performance** | How FAST must it be? | "Export completes in < 5s for 1000 items" |
| **Error Handling** | What happens when things go WRONG? | "Empty inventory shows 'Nothing to export' message" |
| **Edge Cases** | What are the BOUNDARIES? | "Special characters in names are escaped properly" |
| **Integration** | How does it CONNECT to other systems? | "Export uses same data as inventory table" |

### 6.2 Elicitation Prompts

For each category, ask:

```markdown
### Functional Criteria

What must this feature actually DO to be considered done?

Think about:
- The happy path (everything works)
- The data involved (what fields, what format)
- The action completed (what changes, what's produced)

**Your input:** [wait for response]

Let me convert that to verifiable criteria:
- ✅ [Criterion 1]
- ✅ [Criterion 2]

Does this capture it? Anything missing?
```

### 6.3 Criterion Refinement Loop

For each proposed criterion, validate:

```markdown
**Proposed:** "Export works correctly"

This is too vague. Let me ask:
- What file format? (CSV, Excel, JSON)
- What columns must be included?
- What constitutes "correct" data?

**Refined:** 
- "Export produces valid CSV file"
- "CSV includes columns: item_id, name, sku, quantity, location, purchase_price"
- "CSV data matches current inventory table display"

Better?
```

---

## 7. Phase 3: Criteria Validation

### 7.1 Verifiability Check

For each criterion, classify:

| Tag | Meaning | Verify Done Handling |
|-----|---------|---------------------|
| `AUTO_VERIFY` | Machine can check | Automated test |
| `HUMAN_VERIFY` | Requires human judgment | Prompt for confirmation |
| `TOOL_VERIFY` | Needs external tool | Specify tool |

### 7.2 Validation Questions

For each criterion:

1. **Is it binary?** Can only be PASS or FAIL, not "partially done"
2. **Is it atomic?** Tests exactly ONE thing
3. **Is it evidence-based?** Defines what proves it
4. **Is it independent?** Doesn't depend on other criteria passing

### 7.3 Validation Report

```markdown
## Criteria Validation

| # | Criterion | Binary | Atomic | Evidence | Independent | Valid |
|---|-----------|--------|--------|----------|-------------|-------|
| 1 | Export button visible on /inventory | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2 | CSV downloads on click | ✅ | ✅ | ✅ | ❌ (needs #1) | ⚠️ |
| 3 | UI looks professional | ❌ | ✅ | ❌ | ✅ | ❌ |

### Issues to Resolve
- Criterion 2: Acceptable dependency on #1 (sequential flow)
- Criterion 3: Too vague - refine to specific UI checks
```

### 7.4 Refinement Prompt

```markdown
Criterion 3 "UI looks professional" cannot be verified by machine.

Options:
A) Remove it (not critical for MVP)
B) Make it specific: "Button uses shadcn/ui Button component with variant='outline'"
C) Tag as HUMAN_VERIFY: You'll confirm manually before merge

Which approach?
```

---

## 8. Phase 4: Output Generation

### 8.1 Generate done-criteria.md

Final output file:

```markdown
# Done Criteria: <feature-name>

**Created:** 2026-01-16
**Author:** Define Done Agent + Chris
**Status:** APPROVED

## Feature Summary
<one paragraph description>

## Success Criteria

### Functional

#### F1: Export Button Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** An "Export" button is visible on the /inventory page
- **Evidence:** DOM query finds button with text "Export" or aria-label="Export inventory"
- **Test:** `document.querySelector('[data-testid="export-button"]') !== null`

#### F2: CSV File Downloads
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking export button triggers CSV file download
- **Evidence:** Network request returns Content-Type: text/csv, browser downloads file
- **Test:** Playwright click + download event listener

#### F3: CSV Contains Required Columns
- **Tag:** AUTO_VERIFY
- **Criterion:** Downloaded CSV includes columns: item_id, name, sku, quantity, location, purchase_price, created_at
- **Evidence:** Parse CSV header row, validate all columns present
- **Test:** CSV parse + column check

#### F4: CSV Data Matches Table
- **Tag:** AUTO_VERIFY
- **Criterion:** CSV row count equals inventory table row count (excluding header)
- **Evidence:** Compare CSV rows to API response count
- **Test:** Fetch /api/inventory count, compare to CSV rows

### Error Handling

#### E1: Empty Inventory Message
- **Tag:** AUTO_VERIFY
- **Criterion:** If inventory is empty, clicking Export shows toast "Nothing to export"
- **Evidence:** Toast component appears with expected message
- **Test:** Clear inventory, click export, check toast

### Performance

#### P1: Export Speed
- **Tag:** AUTO_VERIFY
- **Criterion:** Export of 1000 items completes in under 5 seconds
- **Evidence:** Time from click to download complete < 5000ms
- **Test:** Seed 1000 items, measure export duration

### UI/UX

#### U1: Button Placement
- **Tag:** HUMAN_VERIFY
- **Criterion:** Export button is positioned in the toolbar next to other actions
- **Evidence:** Visual inspection confirms logical placement
- **Verify:** Screenshot review before merge

## Out of Scope
- Import functionality
- Filtered exports (exports all items regardless of current filter)
- Excel format (CSV only for MVP)

## Dependencies
- Inventory page must be functional
- Inventory API must return data

## Iteration Budget
- **Max iterations:** 5
- **Escalation:** If not converged after 5 iterations, pause for human review
```

### 8.2 File Location

```
docs/
└── features/
    └── <feature-name>/
        ├── done-criteria.md    ← This file
        ├── build-log.md        ← Created by Build Feature Agent
        └── verify-report.md    ← Created by Verify Done Agent
```

### 8.3 State Update

After generating criteria:

```json
{
  "agent": "define-done",
  "lastRun": "2026-01-16T10:00:00Z",
  "lastFeature": "inventory-export",
  "featuresDefinedCount": 12,
  "averageCriteriaPerFeature": 7,
  "commonPatterns": [
    "Button exists (AUTO_VERIFY)",
    "API returns expected data (AUTO_VERIFY)",
    "Error toast on failure (AUTO_VERIFY)",
    "Performance under threshold (AUTO_VERIFY)"
  ]
}
```

---

## 9. Anti-Vague Patterns

### 9.1 Vague → Specific Transformations

| Vague Criterion | Problem | Specific Version |
|-----------------|---------|------------------|
| "Works correctly" | Undefined "correct" | "Returns HTTP 200 with JSON body containing `items` array" |
| "Fast" | Undefined threshold | "Response time < 500ms at p95" |
| "User-friendly" | Subjective | "Form shows inline validation errors within 100ms of blur" |
| "Handles errors" | Which errors? | "Network timeout shows retry button; 401 redirects to login" |
| "Looks good" | Subjective | "Matches Figma design within 5px tolerance" OR tag HUMAN_VERIFY |
| "Secure" | Too broad | "API validates auth token; rejects requests without valid session" |
| "Complete" | Circular | List specific completeness checks |

### 9.2 Anti-Vague Prompts

When human provides vague criterion:

```markdown
"Works correctly" is too vague for verification. 

Help me make it specific:
- What INPUT does it receive?
- What OUTPUT should it produce?
- What SIDE EFFECTS should occur?
- What should NEVER happen?

Let's break "works correctly" into 2-3 specific, testable criteria.
```

### 9.3 The "How Would You Test It?" Technique

```markdown
You said: "The export should be reliable"

If you were testing this manually, what would you check?
- Would you try exporting multiple times?
- Would you check the file isn't corrupted?
- Would you verify row counts?

Those manual checks become our criteria:
1. "Export succeeds on 3 consecutive attempts" (reliability)
2. "CSV file parses without errors" (not corrupted)
3. "Row count matches inventory count" (completeness)
```

---

## 10. State Management

### 10.1 Directory Structure

```
docs/
└── agents/
    └── define-done/
        ├── spec.md           # This document
        ├── state.json        # Agent state
        └── templates/
            └── criteria-template.md
```

### 10.2 State File Schema

```json
{
  "agent": "define-done",
  "lastRun": "2026-01-16T10:00:00Z",
  "lastCommit": "abc123",
  "status": "success",
  "featuresDefinedCount": 12,
  "recentFeatures": [
    {
      "name": "inventory-export",
      "criteriaCount": 7,
      "autoVerifyCount": 6,
      "humanVerifyCount": 1,
      "definedAt": "2026-01-16T10:00:00Z"
    }
  ],
  "criteriaPatterns": {
    "functional": ["button exists", "api returns", "data matches"],
    "error": ["toast on error", "validation message"],
    "performance": ["completes under Xms", "handles N items"]
  }
}
```

---

## 11. Error Handling

| Situation | Response |
|-----------|----------|
| Human gives only vague criteria | Apply anti-vague patterns, keep asking |
| Human wants to skip criteria | Warn that Verify Done will fail on missing criteria |
| Feature too large | Suggest breaking into smaller features |
| Criteria conflict with each other | Surface conflict, ask human to resolve |
| Can't determine verifiability | Default to HUMAN_VERIFY, flag for discussion |
| Human abandons session | Save partial progress to state |

---

## 12. Output Templates

### 12.1 Criterion Template

```markdown
#### <ID>: <Short Name>
- **Tag:** AUTO_VERIFY | HUMAN_VERIFY | TOOL_VERIFY
- **Criterion:** <One sentence, binary, specific>
- **Evidence:** <What proves this is true>
- **Test:** <How to check - code snippet, command, or manual step>
```

### 12.2 Minimal Viable Criteria Set

Every feature should have at least:

```markdown
## Minimum Criteria Checklist

- [ ] At least 1 Functional criterion (what it does)
- [ ] At least 1 Error Handling criterion (what happens on failure)
- [ ] At least 1 Integration criterion (how it connects)
- [ ] Scope boundaries defined (what's NOT included)
- [ ] Iteration budget set
```

---

## 13. Handoffs

### 13.1 To Build Feature Agent

```markdown
## Define Done → Build Feature Handoff

Feature: inventory-export
Criteria file: docs/features/inventory-export/done-criteria.md

Summary:
- 7 total criteria (6 AUTO_VERIFY, 1 HUMAN_VERIFY)
- Iteration budget: 5
- Key files likely affected:
  - apps/web/app/(dashboard)/inventory/page.tsx
  - apps/web/app/api/inventory/export/route.ts (new)

Ready for: /build-feature inventory-export
```

### 13.2 To Verify Done Agent

The `done-criteria.md` file IS the handoff. Verify Done reads it directly.

### 13.3 To Test Plan Agent

```markdown
## Define Done → Test Plan Handoff

The following criteria should inform test coverage:

| Criterion | Suggested Test Type |
|-----------|---------------------|
| F1: Export Button Exists | Component test |
| F2: CSV Downloads | E2E test (Playwright) |
| F3: CSV Columns | Integration test |
| P1: Export Speed | Performance test |

Add to: docs/testing/analysis/coverage-analysis.md
```

---

## 14. Examples

### 14.1 Example Session: Inventory Export

```
Human: /define-done inventory-export

Agent: ## Let's define "done" for: inventory-export

To make sure we're aligned:

1. **What problem does this solve?**