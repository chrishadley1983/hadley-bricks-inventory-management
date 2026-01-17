# Feature Spec Agent Specification

**Version:** 1.0  
**Type:** Initializer (Planner)  
**Command:** `/feature-spec <feature-name>`  
**Project:** Cross-project (Hadley Bricks, FamilyFuel, Personal Finance)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Design Principles](#2-design-principles)
3. [Modes](#3-modes)
4. [Standard Boot Sequence](#4-standard-boot-sequence)
5. [Phase 1: Load Context](#5-phase-1-load-context)
6. [Phase 2: Architecture Analysis](#6-phase-2-architecture-analysis)
7. [Phase 3: Implementation Planning](#7-phase-3-implementation-planning)
8. [Phase 4: Risk Assessment](#8-phase-4-risk-assessment)
9. [Phase 5: Criteria Feasibility Validation](#9-phase-5-criteria-feasibility-validation)
10. [Phase 6: Output Generation](#10-phase-6-output-generation)
11. [State Management](#11-state-management)
12. [Error Handling](#12-error-handling)
13. [Output Templates](#13-output-templates)
14. [Handoffs](#14-handoffs)
15. [Examples](#15-examples)

---

## 1. Overview

### 1.1 Purpose

The Feature Spec Agent transforms **success criteria** (from Define Done) into a **concrete implementation plan** that the Build Feature Agent can execute. It answers the question: "HOW do we build this?"

### 1.2 Position in the DBT Cycle

```
Define Done Agent    →    Feature Spec Agent    →    Build Feature Agent
     │                          │                          │
     │                          │                          │
  "WHAT does                "HOW do we                 "EXECUTE
   done look like?"          build it?"                 the plan"
     │                          │                          │
     ▼                          ▼                          ▼
done-criteria.md          feature-spec.md              Working code
```

### 1.3 Why This Agent Exists

Without Feature Spec, Build Feature must:
- Make architecture decisions during build
- Discover constraints mid-implementation
- Potentially redesign across iterations

With Feature Spec:
- Architecture decided upfront
- Constraints surfaced before building
- Build iterations focus on **fixing failures**, not **redesigning**
- Criteria validated as feasible before committing

### 1.4 Agent Classification

| Property | Value |
|----------|-------|
| Type | Initializer (Planner) |
| Modifies Code | No |
| Requires Running App | No (but helps for context) |
| State Tracking | Yes |
| Human Interaction | Review output before build |

### 1.5 Interactions

| Agent | Direction | Purpose |
|-------|-----------|---------|
| **Define Done Agent** | ← reads from | Gets done-criteria.md |
| **Build Feature Agent** | → outputs to | Provides feature-spec.md |
| **Database Agent** | → may trigger | If schema changes needed |
| **Performance Agent** | ← may consult | For performance-critical features |

---

## 2. Design Principles

### 2.1 Plan Before Build

> "Hours of coding can save you minutes of planning" - said no one successful

This agent invests time upfront to:
- Understand existing architecture
- Identify integration points
- Surface hidden complexity
- Validate feasibility of criteria

### 2.2 Criteria-Driven Planning

Every element of the spec must trace back to a criterion:

| Criterion | Spec Element |
|-----------|--------------|
| F1: Export button exists | UI: Add button to toolbar component |
| F2: CSV downloads | API: Create /api/inventory/export route |
| F3: CSV has columns | API: Include all fields in response |
| P1: < 5s for 1000 items | API: Use streaming response |

If a spec element doesn't serve a criterion, question why it's there.

### 2.3 Feasibility First

Before detailing the implementation, validate:
- Can all criteria actually be met with this approach?
- Are there technical constraints that make criteria impossible?
- Should any criteria be flagged for revision?

### 2.4 Opinionated but Flexible

The spec should be:
- **Opinionated**: Make clear recommendations
- **Justified**: Explain why this approach
- **Flexible**: Note alternatives if approach doesn't work

### 2.5 Right-Sized Detail

| Feature Size | Spec Detail Level |
|--------------|-------------------|
| Small (1-2 files) | Brief - file paths + key changes |
| Medium (3-10 files) | Moderate - component breakdown + contracts |
| Large (10+ files) | Detailed - full architecture + phases |

Don't over-spec simple features. Don't under-spec complex ones.

---

## 3. Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `new` | Generate fresh spec from criteria | New feature |
| `update` | Update spec based on changed criteria | Criteria refined |
| `validate` | Check spec against current codebase | Pre-build validation |
| `review` | Display current spec | Check before build |

### Command Examples

```powershell
# Generate new spec
/feature-spec inventory-export

# Update after criteria changed
/feature-spec inventory-export --update

# Validate spec is still accurate
/feature-spec inventory-export --validate

# Review current spec
/feature-spec inventory-export --review
```

---

## 4. Standard Boot Sequence

**MANDATORY: Execute before any work.**

### 4.0 Read Agent Spec
```powershell
cat docs/agents/feature-spec/spec.md
```

### 4.1 Read Core Context
```powershell
cat CLAUDE.md
```
Extract: Project patterns, architecture, conventions, tech stack.

### 4.2 Read Agent State
```powershell
cat docs/agents/feature-spec/state.json
```
Extract: Previous specs, common patterns used.

### 4.3 Load Done Criteria (REQUIRED)
```powershell
cat docs/features/<feature-name>/done-criteria.md
```
**CRITICAL:** If not found, EXIT - must run /define-done first.

### 4.4 Check for Existing Spec
```powershell
cat docs/features/<feature-name>/feature-spec.md
```
If exists: Load for update/validation mode.

### 4.5 Scan Project Structure
```powershell
# Understand current architecture
Get-ChildItem -Path "apps/web/app" -Directory -Recurse -Depth 2
Get-ChildItem -Path "apps/web/lib" -Directory -Recurse -Depth 2
Get-ChildItem -Path "apps/web/components" -Directory -Recurse -Depth 2
```

### 4.6 Identify Related Code
Based on criteria, identify likely integration points.

### 4.7 Report Boot Status

```markdown
## Feature Spec Agent - Boot Complete

**Feature:** inventory-export
**Mode:** new
**Criteria loaded:** 7 (from done-criteria.md)

**Project context:**
- Framework: Next.js 15 (App Router)
- Database: Supabase (45+ tables)
- UI: shadcn/ui + Tailwind

**Related existing code identified:**
- Inventory page: apps/web/app/(dashboard)/inventory/page.tsx
- Inventory repo: apps/web/lib/repositories/inventoryRepository.ts
- Similar export: None found (new capability)

**Proceeding with implementation planning...**
```

---

## 5. Phase 1: Load Context

### 5.1 Parse Done Criteria

Extract structured criteria:

```typescript
interface ParsedCriteria {
  id: string;           // "F1"
  category: string;     // "Functional"
  name: string;         // "Export Button Exists"
  criterion: string;    // Full criterion text
  tag: string;          // "AUTO_VERIFY"
  testMethod: string;   // How it will be verified
}
```

### 5.2 Categorize by Implementation Domain

Group criteria by what they require:

| Domain | Criteria | Implementation Area |
|--------|----------|---------------------|
| UI | F1, U1 | Components, pages |
| API | F2, F3, F4, P1 | API routes |
| Error Handling | E1 | UI + API |
| Database | (none) | No schema changes |

### 5.3 Identify Dependencies

```markdown
## Criteria Dependencies

F2 (CSV downloads) depends on:
- F1 (button must exist to trigger download)

F3 (CSV columns) depends on:
- F2 (download must work to check columns)

F4 (data matches) depends on:
- F3 (columns must exist to compare data)

P1 (performance) depends on:
- F2, F3, F4 (feature must work to measure speed)

**Build order implication:** F1 → F2 → F3 → F4 → P1/E1
```

### 5.4 Load Project Patterns

From CLAUDE.md and existing code, extract:
- API route patterns
- Component patterns
- Error handling patterns
- State management patterns
- Testing patterns

---

## 6. Phase 2: Architecture Analysis

### 6.1 Integration Point Analysis

Where does this feature connect to existing code?

```markdown
## Integration Analysis

### UI Integration
**Location:** apps/web/app/(dashboard)/inventory/page.tsx
**Current state:** Displays inventory table with toolbar
**Integration:** Add export button to existing toolbar
**Risk:** Low - additive change

### Data Integration
**Location:** apps/web/lib/repositories/inventoryRepository.ts
**Current state:** Has getAll(), getById(), etc.
**Integration:** May reuse existing query or add exportAll()
**Risk:** Low - can reuse existing patterns

### API Integration
**Location:** apps/web/app/api/inventory/ (new route)
**Current state:** Has CRUD routes
**Integration:** Add /export route alongside existing
**Risk:** Low - new route, no modification to existing
```

### 6.2 Technology Decisions

For each criteria, decide on approach:

```markdown
## Technology Decisions

### CSV Generation (F2, F3)
**Options:**
A) Build CSV string manually in API route
B) Use library (papaparse, csv-stringify)
C) Stream CSV for large datasets

**Decision:** Option A for simplicity, Option C for P1 (performance)
**Rationale:** 
- No external dependency needed for basic CSV
- Streaming handles 1000+ items efficiently
- Keep it simple, enhance for performance

### Download Mechanism (F2)
**Options:**
A) Return CSV with Content-Disposition header
B) Generate file URL, redirect to download
C) Client-side Blob creation

**Decision:** Option A
**Rationale:**
- Simplest approach
- Works with streaming
- No temporary file management

### Empty State (E1)
**Options:**
A) Check in API, return 204 No Content
B) Check in UI before API call, show toast
C) Both - defense in depth

**Decision:** Option B (UI check)
**Rationale:**
- Faster feedback (no network round trip)
- Better UX (immediate toast)
- API can still handle gracefully
```

### 6.3 Architecture Diagram

For medium/large features:

```markdown
## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         UI Layer                                 │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ inventory/page.tsx                                       │    │
│  │                                                          │    │
│  │  ┌──────────────────┐    ┌──────────────────────────┐   │    │
│  │  │ InventoryToolbar │    │ InventoryTable           │   │    │
│  │  │                  │    │                          │   │    │
│  │  │ [+ Add] [Export] │    │ (existing)               │   │    │
│  │  │          ▲       │    │                          │   │    │
│  │  └──────────┼───────┘    └──────────────────────────┘   │    │
│  │             │                                            │    │
│  └─────────────┼────────────────────────────────────────────┘    │
│                │                                                  │
│                │ onClick: handleExport()                         │
│                │                                                  │
├────────────────┼─────────────────────────────────────────────────┤
│                │           API Layer                              │
│                ▼                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ GET /api/inventory/export                                │    │
│  │                                                          │    │
│  │ 1. Fetch all inventory items                             │    │
│  │ 2. Build CSV (streaming)                                 │    │
│  │ 3. Return with Content-Disposition                       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                │                                                  │
├────────────────┼─────────────────────────────────────────────────┤
│                │           Data Layer                             │
│                ▼                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ inventoryRepository.getAll()                             │    │
│  │                                                          │    │
│  │ SELECT id, name, sku, quantity, location,                │    │
│  │        purchase_price, created_at                        │    │
│  │ FROM inventory_items                                     │    │
│  │ WHERE user_id = $1                                       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```
```

---

## 7. Phase 3: Implementation Planning

### 7.1 File Inventory

List all files to create or modify:

```markdown
## Files to Change

### New Files
| File | Purpose | Est. Lines |
|------|---------|------------|
| `apps/web/app/api/inventory/export/route.ts` | Export API endpoint | 50-70 |

### Modified Files
| File | Changes | Est. Lines Changed |
|------|---------|-------------------|
| `apps/web/app/(dashboard)/inventory/page.tsx` | Add export button + handler | 15-20 |

### No Changes Needed
| File | Reason |
|------|--------|
| `inventoryRepository.ts` | Existing getAll() sufficient |
| Database schema | No new columns/tables needed |
```

### 7.2 Component Specification

For each new/modified component:

```markdown
## Component: Export Button

**Location:** apps/web/app/(dashboard)/inventory/page.tsx (inline, or extract to component)

**Props:** None (uses page context)

**Behavior:**
1. On click, check if items.length === 0
2. If empty, show toast "Nothing to export" and return
3. If items exist, trigger download via window.location or fetch

**UI Spec:**
- Use shadcn Button component
- Variant: outline
- Icon: Download (from lucide-react)
- Text: "Export"
- Position: In toolbar, after "Add" button

**Code Pattern:**
```tsx
<Button 
  variant="outline" 
  onClick={handleExport}
  disabled={isExporting}
>
  <Download className="h-4 w-4 mr-2" />
  Export
</Button>
```
```

### 7.3 API Specification

For each API endpoint:

```markdown
## API: GET /api/inventory/export

**Purpose:** Generate and return CSV of inventory items

**Authentication:** Required (Supabase auth)

**Request:**
- Method: GET
- Headers: Cookie (auth session)
- Query params: None for MVP

**Response (Success):**
- Status: 200
- Headers:
  - Content-Type: text/csv
  - Content-Disposition: attachment; filename="inventory-{timestamp}.csv"
- Body: CSV content

**Response (Empty):**
- Status: 200
- Headers: Same as success
- Body: Header row only (no data rows)

**Response (Error):**
- Status: 401 if not authenticated
- Status: 500 if database error

**CSV Format:**
```csv
item_id,name,sku,quantity,location,purchase_price,created_at
uuid-1,LEGO Set 1234,SET-1234,5,Shelf A,29.99,2026-01-15T10:00:00Z
uuid-2,LEGO Minifig,MF-5678,12,Bin 3,4.99,2026-01-14T15:30:00Z
```

**Performance Requirement:**
- Must handle 1000+ items in < 5 seconds
- Use streaming if needed
```

### 7.4 Data Flow

```markdown
## Data Flow: Export

1. **User Action**
   - User clicks Export button on inventory page

2. **Pre-flight Check (UI)**
   - Check if inventory items exist
   - If empty → toast("Nothing to export") → STOP
   - If items → continue

3. **API Request**
   - Fetch GET /api/inventory/export
   - Browser automatically handles Content-Disposition

4. **API Processing**
   - Authenticate user from session
   - Query inventory_items for user
   - Build CSV header row
   - Stream/build CSV data rows
   - Return response

5. **Download**
   - Browser receives CSV
   - Triggers download dialog
   - File saves to user's downloads

6. **Completion**
   - Optional: Toast "Export complete"
```

### 7.5 Implementation Order

```markdown
## Build Order

Given criteria dependencies, build in this order:

### Step 1: API Route (F2, F3, F4, P1)
Create the export endpoint first. This can be tested independently.
- Create route.ts
- Implement CSV generation
- Add streaming for performance
- Test with curl/Postman

### Step 2: UI Integration (F1)
Add the button to trigger the export.
- Add Button to toolbar
- Implement handleExport function
- Wire up to API route

### Step 3: Error Handling (E1)
Add empty state handling.
- Add items.length check
- Add toast notification
- Test empty state

### Step 4: Polish (U1)
Final UI adjustments.
- Verify button placement
- Add loading state if needed
- Screenshot for HUMAN_VERIFY
```

---

## 8. Phase 4: Risk Assessment

### 8.1 Technical Risks

```markdown
## Risk Assessment

### Risk 1: Large Dataset Performance
**Criteria affected:** P1
**Risk:** Export of 1000+ items may exceed 5s threshold
**Probability:** Medium
**Mitigation:** Use streaming response from start
**Fallback:** If streaming insufficient, add pagination to export

### Risk 2: CSV Special Characters
**Criteria affected:** F3, F4
**Risk:** Names with commas/quotes may break CSV format
**Probability:** High (LEGO sets often have commas)
**Mitigation:** Proper CSV escaping (wrap in quotes, escape quotes)
**Fallback:** Use library if manual escaping fails

### Risk 3: Memory on Large Export
**Criteria affected:** P1
**Risk:** Building full CSV in memory may cause issues
**Probability:** Low (650 items is small)
**Mitigation:** Streaming approach
**Fallback:** Chunked processing
```

### 8.2 Scope Risks

```markdown
### Risk 4: Scope Creep
**Risk:** Temptation to add filters, formats, scheduling
**Mitigation:** done-criteria.md is the contract. Build only what's specified.
**Out of scope (per criteria):**
- Filtered export
- Excel format
- Scheduled exports
- Email delivery
```

### 8.3 Integration Risks

```markdown
### Risk 5: Auth Token Expiry During Export
**Criteria affected:** F2
**Risk:** Long export may fail if session expires
**Probability:** Low (export should be < 5s)
**Mitigation:** Standard auth middleware handles this
**Fallback:** If issue arises, refresh token before export
```

---

## 9. Phase 5: Criteria Feasibility Validation

### 9.1 Feasibility Check

For each criterion, confirm it's achievable:

```markdown
## Feasibility Validation

| Criterion | Feasible | Confidence | Notes |
|-----------|----------|------------|-------|
| F1: Button exists | ✅ Yes | High | Simple UI addition |
| F2: CSV downloads | ✅ Yes | High | Standard pattern |
| F3: CSV columns | ✅ Yes | High | Data available in DB |
| F4: Data matches | ✅ Yes | High | Same query as table |
| E1: Empty toast | ✅ Yes | High | Sonner toast available |
| P1: < 5s for 1000 | ✅ Yes | Medium | Streaming should achieve |
| U1: Button placement | ✅ Yes | High | Toolbar exists |

**Overall:** All criteria feasible with planned approach.
```

### 9.2 Criteria Conflicts

Check for conflicting criteria:

```markdown
## Conflict Analysis

No conflicts detected.

**Potential tension:**
- P1 (performance) vs F3 (all columns): More columns = slightly slower
- Resolution: 7 columns is reasonable, not a real conflict
```

### 9.3 Criteria Gaps

Identify anything the criteria don't cover that might matter:

```markdown
## Gap Analysis

**Gaps identified:**
1. No criterion for filename format - will use "inventory-{timestamp}.csv"
2. No criterion for column order - will use logical order
3. No criterion for date format - will use ISO 8601

**Recommendation:** These are reasonable defaults. No criteria update needed.

**Suggestion for future:**
- Consider adding filter support (different feature)
- Consider adding format selection (different feature)
```

### 9.4 Feasibility Issues

If any criteria are not feasible:

```markdown
## Feasibility Issue Template

### Issue: [Criterion ID] is not feasible as written

**Criterion:** [Full text]

**Problem:** [Why it can't be done]

**Options:**
A) Modify criterion to: [alternative]
B) Remove criterion (descope)
C) Requires additional work: [what's needed]

**Recommendation:** [A/B/C]

**Action required:** Update done-criteria.md before proceeding to build
```

---

## 10. Phase 6: Output Generation

### 10.1 Generate feature-spec.md

Compile all analysis into the final spec document.

### 10.2 File Location

```
docs/features/<feature-name>/
├── done-criteria.md    ← From Define Done
├── feature-spec.md     ← THIS OUTPUT
├── build-state.json    ← Created by Build Feature
├── build-log.md        ← Created by Build Feature
└── verify-report.md    ← Created by Verify Done
```

### 10.3 Spec Sections

The output must include:

1. **Summary** - One paragraph overview
2. **Criteria Mapping** - How spec addresses each criterion
3. **Architecture** - Integration points, diagrams
4. **File Changes** - Create/modify list
5. **Implementation Details** - Component, API, data specs
6. **Build Order** - Sequence of implementation
7. **Risks** - Technical, scope, integration
8. **Validation** - Feasibility confirmation

---

## 11. State Management

### 11.1 Directory Structure

```
docs/
└── agents/
    └── feature-spec/
        ├── spec.md           # This document
        ├── state.json        # Agent state
        └── templates/
            └── spec-template.md
```

### 11.2 State File Schema

```json
{
  "agent": "feature-spec",
  "lastRun": "2026-01-16T10:00:00Z",
  "lastCommit": "abc123",
  "specsGenerated": 5,
  "recentSpecs": [
    {
      "feature": "inventory-export",
      "generatedAt": "2026-01-16T10:00:00Z",
      "criteriaCount": 7,
      "filesPlanned": 2,
      "feasibilityIssues": 0
    }
  ],
  "commonPatterns": {
    "exportFeature": "API route + button trigger",
    "crudFeature": "Repository + API + UI form",
    "integrationFeature": "Service + adapter + sync"
  }
}
```

---

## 12. Error Handling

| Error | Response |
|-------|----------|
| done-criteria.md not found | EXIT - Run /define-done first |
| Criteria unparseable | EXIT - Malformed criteria file |
| CLAUDE.md not found | WARN - Continue with defaults |
| Feasibility issue found | FLAG - Include in output, recommend criteria update |
| Project structure unclear | ASK - Request clarification on architecture |

---

## 13. Output Templates

### 13.1 Feature Spec Template

```markdown
# Feature Specification: <feature-name>

**Generated:** <timestamp>
**Based on:** done-criteria.md (v<hash>)
**Status:** READY_FOR_BUILD | NEEDS_CRITERIA_UPDATE

---

## 1. Summary

<One paragraph describing what this feature does and how it will be built>

---

## 2. Criteria Mapping

| Criterion | Implementation Approach |
|-----------|------------------------|
| F1: ... | ... |
| F2: ... | ... |

---

## 3. Architecture

### 3.1 Integration Points
<Where this connects to existing code>

### 3.2 Diagram
<ASCII diagram if helpful>

### 3.3 Technology Decisions
<Key tech choices with rationale>

---

## 4. File Changes

### 4.1 New Files
| File | Purpose | Est. Lines |
|------|---------|------------|

### 4.2 Modified Files
| File | Changes | Est. Lines |
|------|---------|------------|

---

## 5. Implementation Details

### 5.1 Components
<Component specs>

### 5.2 API Endpoints
<API specs>

### 5.3 Data Flow
<How data moves through the system>

---

## 6. Build Order

1. <First step>
2. <Second step>
3. ...

---

## 7. Risk Assessment

### Technical Risks
<Risk table>

### Mitigations
<How risks are addressed>

---

## 8. Feasibility Validation

| Criterion | Feasible | Confidence |
|-----------|----------|------------|

**Issues:** <None or list>

---

## 9. Notes for Build Agent

<Any specific guidance for Build Feature Agent>

- <Hint 1>
- <Hint 2>
```

---

## 14. Handoffs

### 14.1 From Define Done Agent

```markdown
## Define Done → Feature Spec

Feature: inventory-export
Criteria: docs/features/inventory-export/done-criteria.md (7 criteria)

Ready for: /feature-spec inventory-export
```

### 14.2 To Build Feature Agent

```markdown
## Feature Spec → Build Feature

**Feature:** inventory-export
**Spec:** docs/features/inventory-export/feature-spec.md
**Status:** READY_FOR_BUILD

**Summary:**
- 2 files to change (1 new, 1 modified)
- ~70 lines of code
- No database changes
- No new dependencies

**Build order:**
1. API route (30 min)
2. UI button (15 min)
3. Error handling (10 min)

**Risks flagged:** 1 medium (performance - mitigated with streaming)

Ready for: /build-feature inventory-export
```

### 14.3 To Human (if criteria issues)

```markdown
## Feature Spec → Human

**Feature:** inventory-export
**Status:** NEEDS_CRITERIA_UPDATE

**Issue found:**
Criterion P1 requires export in < 2 seconds, but with current data volume
and architecture, minimum achievable is ~4 seconds.

**Options:**
A) Revise P1 threshold to < 5 seconds
B) Add caching infrastructure (scope increase)
C) Limit export to first 500 items

**Recommendation:** Option A

Please update done-criteria.md and re-run:
/feature-spec inventory-export
```

### 14.4 To Database Agent (if schema changes needed)

```markdown
## Feature Spec → Database Agent

**Feature:** inventory-export
**Schema changes required:** Yes

**Changes needed:**
1. Add `last_exported_at` column to inventory_items
2. Add index on `created_at` for export sorting

Please run:
/database migrate --name add-export-columns

Then continue with:
/feature-spec inventory-export --validate
```

---

## 15. Examples

### 15.1 Example: Simple Feature (Inventory Export)

```
Human: /feature-spec inventory-export

Agent: ## Feature Spec Agent - Boot Complete

**Feature:** inventory-export
**Criteria:** 7 loaded from done-criteria.md

Analyzing architecture...

---

## Architecture Analysis

### Integration Points
- **UI:** Inventory page has toolbar, will add button there
- **Data:** inventoryRepository.getAll() exists, can reuse
- **API:** /api/inventory/ exists, will add /export route

### Technology Decisions
- CSV generation: Manual string building (simple, no deps)
- Download: Content-Disposition header (standard approach)
- Performance: Streaming response for large datasets

---

## Implementation Plan

### Files to Change

| Type | File | Purpose |
|------|------|---------|
| NEW | `apps/web/app/api/inventory/export/route.ts` | Export API |
| MOD | `apps/web/app/(dashboard)/inventory/page.tsx` | Add button |

### Build Order
1. Create API route with CSV generation
2. Add export button to page
3. Add empty state handling

---

## Risk Assessment

| Risk | Probability | Mitigation |
|------|-------------|------------|
| CSV special chars | High | Proper escaping |
| Large dataset perf | Medium | Streaming |

---

## Feasibility Validation

All 7 criteria feasible with planned approach. ✅

---

## Generating feature-spec.md...

✅ Spec generated: docs/features/inventory-export/feature-spec.md

**Status:** READY_FOR_BUILD

**Next step:**
/build-feature inventory-export
```

### 15.2 Example: Complex Feature with Issues

```
Human: /feature-spec real-time-sync

Agent: ## Feature Spec Agent - Boot Complete

**Feature:** real-time-sync
**Criteria:** 12 loaded from done-criteria.md

Analyzing architecture...

---

## Feasibility Issues Detected ⚠️

### Issue 1: Criterion P3 Not Feasible

**Criterion:** P3: Sync latency < 100ms globally
**Problem:** Supabase real-time has ~200-500ms latency. 
            100ms is not achievable without edge infrastructure.

**Options:**
A) Revise to < 500ms (achievable with Supabase)
B) Add edge caching (significant scope increase)
C) Remove global requirement (sync fast for same region)

**Recommendation:** Option A

### Issue 2: Criterion F8 Conflicts with Security

**Criterion:** F8: Sync works without authentication for demo mode
**Problem:** Conflicts with RLS policies requiring auth.

**Options:**
A) Remove demo mode (simplify)
B) Create separate demo database (complexity)
C) Use anon key with limited table (security risk)

**Recommendation:** Option A

---

## Status: NEEDS_CRITERIA_UPDATE

Cannot proceed with build until criteria issues resolved.

**Human action required:**
1. Review issues above
2. Update done-criteria.md
3. Re-run: /feature-spec real-time-sync

```

### 15.3 Example: Feature Requiring Database Changes

```
Human: /feature-spec inventory-tags

Agent: ## Feature Spec Agent - Boot Complete

**Feature:** inventory-tags
**Criteria:** 9 loaded from done-criteria.md

Analyzing architecture...

---

## Database Changes Required

This feature requires schema changes:

### New Table: inventory_tags
```sql
CREATE TABLE inventory_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color TEXT,
  user_id UUID REFERENCES auth.users NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### New Table: inventory_item_tags (junction)
```sql
CREATE TABLE inventory_item_tags (
  item_id UUID REFERENCES inventory_items ON DELETE CASCADE,
  tag_id UUID REFERENCES inventory_tags ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);
```

### RLS Policies Needed
- Users can only see/edit their own tags
- Junction table follows item ownership

---

## Prerequisite: Database Migration

Before proceeding with feature spec, schema must be created.

**Run:**
```
/database migrate --name add-inventory-tags
```

**Then re-run:**
```
/feature-spec inventory-tags --validate
```

---

## Status: BLOCKED_ON_DATABASE

Spec generation paused until database changes complete.
```

---

## Appendix A: Checklist for Good Specs

```markdown
## Spec Quality Checklist

### Completeness
- [ ] Every criterion has implementation approach
- [ ] All files to change are listed
- [ ] Build order is clear

### Clarity
- [ ] Non-technical person could understand summary
- [ ] Technical details are specific enough to implement
- [ ] No ambiguous language ("should", "might", "possibly")

### Feasibility
- [ ] All criteria validated as achievable
- [ ] Risks identified and mitigated
- [ ] No known blockers

### Traceability
- [ ] Every spec element traces to a criterion
- [ ] No gold-plating (features not in criteria)

### Right-Sized
- [ ] Simple features have simple specs
- [ ] Complex features have detailed specs
- [ ] Not over-engineered
```

---

## Appendix B: Common Patterns Library

```markdown
## Pattern: Export Feature
- API route with Content-Disposition
- Button in toolbar
- Empty state check
- Streaming for performance

## Pattern: CRUD Feature
- Repository methods
- API routes (GET, POST, PUT, DELETE)
- Form component with validation
- Table/list component
- Detail view component

## Pattern: Integration Feature
- External service adapter
- Credential storage
- Sync mechanism
- Error handling + retry
- Status tracking

## Pattern: Real-time Feature
- Supabase subscription
- Optimistic updates
- Conflict resolution
- Connection status handling
```

---

**End of Feature Spec Agent Specification**
