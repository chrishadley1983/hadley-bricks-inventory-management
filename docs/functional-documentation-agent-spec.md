# Functional Documentation Agent Specification

**Version:** 1.0  
**Type:** Analyser + Generator (Initializer Agent)  
**Command:** `/docs <mode> [target]`  
**Project:** Hadley Bricks (embedded, pattern reusable)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Design Principles](#2-design-principles)
3. [Modes](#3-modes)
4. [Standard Boot Sequence](#4-standard-boot-sequence)
5. [Phase 1: Discovery](#5-phase-1-discovery)
6. [Phase 2: Planning](#6-phase-2-planning)
7. [Phase 3: Documentation Generation](#7-phase-3-documentation-generation)
8. [Phase 4: UI Inspection](#8-phase-4-ui-inspection)
9. [Phase 5: Business Logic Extraction](#9-phase-5-business-logic-extraction)
10. [Phase 6: Output & Indexing](#10-phase-6-output--indexing)
11. [Incremental Updates](#11-incremental-updates)
12. [State Management](#12-state-management)
13. [Error Handling](#13-error-handling)
14. [Output Templates](#14-output-templates)
15. [Folder Structure](#15-folder-structure)
16. [Examples](#16-examples)

---

## 1. Overview

### 1.1 Purpose

The Functional Documentation Agent generates and maintains comprehensive documentation describing **what the application does** and **how it works**. It serves as the living reference for features, user journeys, business logic, and system capabilities.

### 1.2 The Problem This Solves

**Without Functional Documentation Agent:**
- Features built months ago become mysterious
- Business logic buried in code is forgotten
- New functionality undocumented after shipping
- "How does X work again?" requires code archaeology
- No single source of truth for app capabilities

**With Functional Documentation Agent:**
- Every feature has clear, current documentation
- Business logic explained in plain English with code references
- UI behaviours captured with screenshots and interaction docs
- Incremental updates keep docs fresh after changes
- Progress tracked toward 100% documentation coverage

### 1.3 Agent Classification

| Property | Value |
|----------|-------|
| Type | Analyser + Generator |
| Modifies Code | No (docs only) |
| Requires Running App | Yes (for UI inspection) |
| State Tracking | Yes |
| Human Interaction | Plan approval required |

### 1.4 Audience

Documentation is written for **you** as both:
- **Developer** — Understanding coded business logic, data flows, integration points
- **Functional User** — Remembering what features exist and how to use them

### 1.5 Separation from Future Agent

| Agent | Focus |
|-------|-------|
| **Functional Documentation Agent** (this) | What the app does, user journeys, business logic, UI behaviours |
| **Knowledge/Training Agent** (future) | CLAUDE.md management, agent context, developer onboarding, coding patterns |

---

## 2. Design Principles

### 2.1 Domain Memory Pattern Alignment

This agent follows the **5 Design Principles** established for all agents:

| Principle | Application in Docs Agent |
|-----------|---------------------------|
| **Externalise the Goal** | Coverage targets and documentation queue in state file |
| **Atomic Progress** | Document ONE journey → update state → next journey |
| **Clean Campsite** | Every run ends with consistent state, even on failure |
| **Standard Boot-up** | Lock → Read state → Check recovery → Detect changes → Act |
| **State as Truth** | `state.json` is authoritative for what's documented |

### 2.2 Documentation as Discovery

The agent doesn't just transcribe — it **explores** the codebase and running app to surface what exists, even if you've forgotten it.

### 2.3 Plain English First

Business logic is explained in human-readable language, then linked to source code. Documentation should be useful without opening an IDE.

### 2.4 Evidence-Based

Every documented behaviour should be verifiable:
- UI claims backed by screenshots
- Logic claims reference specific code
- Interactions confirmed via app inspection

### 2.5 Incremental by Default

Full regeneration is expensive. The agent tracks what changed and updates only affected documentation.

### 2.6 Plan Before Execute

Discovery and planning phases produce visible output for approval. No bulk documentation without human sign-off.

---

## 3. Modes

### 3.1 Discovery Mode

```
/docs discover
```

Explores the entire codebase and running app. Produces:
- Priority-ranked list of documentation candidates
- Coverage dashboard showing progress toward 100%

**Waits for approval before proceeding.**

### 3.2 Document Mode

```
/docs document <target>
```

Generates documentation for a specific target:
- `/docs document inventory` — Document the inventory feature area
- `/docs document adding-inventory` — Document a specific user journey
- `/docs document all` — Document everything (use with caution)

### 3.3 Update Mode

```
/docs update [target]
```

Incremental update based on what changed since last run:
- `/docs update` — Check all docs, update stale ones
- `/docs update ebay` — Force update eBay documentation

### 3.4 Status Mode

```
/docs status
```

Shows current documentation coverage dashboard without making changes.

### 3.5 Inspect Mode

```
/docs inspect <page-or-feature>
```

Runs UI inspection only — captures screenshots and interaction documentation for a specific area without full documentation generation.

---

## 4. Standard Boot Sequence

Every invocation follows this sequence:

```
┌─────────────────────────────────────────────────────────┐
│ 1. CHECK LOCK                                           │
│    └─ Check /docs/agents/functional-docs/run.lock      │
│    └─ If locked and fresh → ABORT                      │
│    └─ If locked and stale → WARN, offer to clear       │
│    └─ If unlocked → Create lock, proceed               │
├─────────────────────────────────────────────────────────┤
│ 2. READ STATE                                           │
│    └─ Load /docs/agents/functional-docs/state.json     │
│    └─ If missing → First run or recovery flow          │
│    └─ If corrupted → Recovery flow                     │
│    └─ Validate version, migrate if needed              │
├─────────────────────────────────────────────────────────┤
│ 3. CHECK RECOVERY                                       │
│    └─ Check for recovery.json from previous crash      │
│    └─ If exists → Offer to resume or start fresh       │
├─────────────────────────────────────────────────────────┤
│ 4. DETECT CHANGES                                       │
│    └─ Compare source file timestamps vs last doc run   │
│    └─ Identify stale documentation                     │
├─────────────────────────────────────────────────────────┤
│ 5. CHECK PREREQUISITES                                  │
│    └─ Verify app is running (for UI inspection modes)  │
│    └─ Verify Playwright MCP available                  │
├─────────────────────────────────────────────────────────┤
│ 6. EXECUTE MODE                                         │
│    └─ Run requested mode (discover/document/update)    │
│    └─ Process queue atomically (one item at a time)    │
├─────────────────────────────────────────────────────────┤
│ 7. CLEAN UP (always runs, even on failure)             │
│    └─ Update state with final metrics                  │
│    └─ Clear inProgress queue item                      │
│    └─ Remove lock file                                 │
│    └─ Clear or update recovery.json                    │
└─────────────────────────────────────────────────────────┘
```

---

## 5. Phase 1: Discovery

**Trigger:** `/docs discover`

### 5.1 Codebase Analysis

The agent scans:

```
apps/web/
├── app/                    # Pages and routes
├── components/             # UI components
├── lib/
│   ├── services/          # Business logic
│   ├── repositories/      # Data access
│   └── adapters/          # External integrations
└── ...
```

**Extraction targets:**
- Route definitions → User-accessible pages
- Service files → Business logic functions
- Repository files → Data operations
- Adapter files → External integrations
- Component files → UI elements

### 5.2 Feature Area Identification

The agent groups discovered elements into feature areas:

```typescript
interface FeatureArea {
  name: string;
  description: string;
  files: string[];
  routes: string[];
  services: string[];
  components: string[];
  integrations: string[];
  complexity: 'low' | 'medium' | 'high';
  existingDocs: string[];
  coveragePercent: number;
}
```

### 5.3 User Journey Mapping

From routes and UI flows, the agent identifies user journeys:

```typescript
interface UserJourney {
  name: string;                    // e.g., "Adding Inventory"
  description: string;
  steps: string[];                 // High-level flow
  involvedFeatures: string[];
  entryPoints: string[];           // Starting routes/buttons
  documented: boolean;
}
```

### 5.4 Discovery Output

**Priority List:**

```markdown
## Documentation Priorities (Proposed)

### High Priority
1. **Inventory Management** 
   - 47 files, complex business logic
   - Core feature, likely most forgotten
   - Includes: stock levels, purchase parsing, cost tracking

2. **eBay Integration**
   - 23 files, OAuth flows, listing sync
   - Complex external integration
   - Includes: auth, listing creation, order sync

3. **Purchase Parsing (AI)**
   - AI-powered text extraction
   - Undocumented edge cases and prompts
   - Critical for inventory accuracy

### Medium Priority
4. **BrickLink Sync** — OAuth 1.0a, inventory reconciliation
5. **Reporting Dashboard** — Calculated metrics, charts
6. **Google Sheets Integration** — Legacy data source

### Lower Priority
7. **Authentication** — Standard Supabase auth
8. **Settings & Configuration** — User preferences
```

**Coverage Dashboard:**

```markdown
## Documentation Coverage

| Feature Area | Files | Documented | Coverage | Status |
|--------------|-------|------------|----------|--------|
| Inventory Management | 47 | 0 | 0% | 🔴 |
| eBay Integration | 23 | 0 | 0% | 🔴 |
| Purchase Parsing | 12 | 0 | 0% | 🔴 |
| BrickLink Sync | 18 | 0 | 0% | 🔴 |
| Reporting | 15 | 0 | 0% | 🔴 |
| Sheets Integration | 9 | 0 | 0% | 🔴 |
| Authentication | 8 | 0 | 0% | 🔴 |
| Settings | 6 | 0 | 0% | 🔴 |
| **TOTAL** | **138** | **0** | **0%** | 🔴 |

Progress: ░░░░░░░░░░░░░░░░░░░░ 0%
```

### 5.5 Approval Gate

After discovery output, the agent **stops and waits**:

```
Discovery complete. 

Proposed documentation plan:
- 8 feature areas identified
- 12 user journeys mapped
- Estimated effort: ~2 hours for full documentation

How would you like to proceed?
1. Document all (start with highest priority)
2. Document specific area: /docs document <area>
3. Adjust priorities first
```

---

## 6. Phase 2: Planning

**Trigger:** User approves discovery or runs `/docs document <target>`

### 6.1 Documentation Plan Generation

For the approved target, the agent creates a detailed plan:

```markdown
## Documentation Plan: Inventory Management

### Pages to Document
- [ ] /inventory — Main inventory list
- [ ] /inventory/[id] — Item detail view
- [ ] /inventory/add — Add new item
- [ ] /inventory/import — Bulk import

### Services to Document
- [ ] inventory.service.ts — Core CRUD operations
- [ ] pricing.service.ts — Margin calculations
- [ ] stock.service.ts — Stock level management

### Business Logic to Extract
- [ ] Margin calculation formula
- [ ] Stock status rules (in-stock, low, out)
- [ ] Purchase price averaging
- [ ] Fee calculations (eBay, PayPal)

### UI Inspections Required
- [ ] Inventory list — filters, sorting, actions
- [ ] Item detail — all displayed fields, edit modes
- [ ] Add item form — required fields, validation
- [ ] Import flow — file upload, mapping, preview

### Estimated Outputs
- 1 overview.md
- 4 page documentation files
- 8-12 screenshots
- ~2,500 words total
```

### 6.2 Plan Display

The plan is shown but **execution proceeds automatically** (you chose "just do it" for output review).

---

## 7. Phase 3: Documentation Generation

### 7.1 Per-Feature Documentation

For each feature area, generate:

**overview.md:**
```markdown
# Inventory Management

## Purpose
Tracks all LEGO inventory items including stock levels, costs, pricing, 
and listing status across platforms.

## Key Capabilities
- Add individual items or bulk import from CSV
- Track purchase costs and calculate margins
- Monitor stock levels with low-stock alerts
- Link items to eBay and BrickLink listings

## User Journeys
- [Adding Inventory](./adding-inventory.md)
- [Managing Stock Levels](./managing-stock.md)
- [Viewing Item Details](./item-details.md)

## Related Features
- [eBay Integration](../ebay/overview.md) — List items on eBay
- [Purchase Parsing](../purchases/overview.md) — Auto-extract from receipts
- [Reporting](../reporting/overview.md) — Inventory value reports
```

### 7.2 Per-Journey Documentation

For each user journey:

```markdown
# Adding Inventory

## Overview
Add new LEGO items to your inventory, either individually or via bulk import.

## Entry Points
- Dashboard → "Add Item" button
- Inventory list → "+" floating action button
- Navigation → Inventory → Add

## Manual Entry Flow

### Step 1: Basic Information
Navigate to `/inventory/add`

![Add Item Form](../screenshots/inventory-add-form.png)

**Required Fields:**
| Field | Description | Validation |
|-------|-------------|------------|
| Set Number | LEGO set number (e.g., 75192) | Must be valid format |
| Name | Item name | Auto-filled from set number |
| Condition | New / Used / Damaged | Required selection |
| Quantity | Number of units | Minimum 1 |

**Optional Fields:**
- Purchase Price — Cost per unit
- Purchase Date — When acquired
- Notes — Free text

### Step 2: Pricing
...

### Step 3: Confirmation
...

## Bulk Import Flow
...

## Business Logic

### Price Calculation
When a purchase price is entered, the system calculates:

**Margin Calculation:**
```
margin = (salePrice - costPrice - fees) / salePrice × 100
```

Where fees include:
- eBay Final Value Fee: 12.8% of sale price
- PayPal Fee: 2.9% + £0.30 per transaction

*Source: `apps/web/lib/services/pricing.service.ts:calculateMargin()`*

### Stock Status Rules
| Status | Condition |
|--------|-----------|
| 🟢 In Stock | quantity > lowStockThreshold |
| 🟡 Low Stock | quantity <= lowStockThreshold AND quantity > 0 |
| 🔴 Out of Stock | quantity = 0 |

Default `lowStockThreshold`: 2 units

*Source: `apps/web/lib/services/stock.service.ts:getStockStatus()`*

## Error Handling
| Error | Cause | Resolution |
|-------|-------|------------|
| "Invalid set number" | Format not recognised | Check format: numbers only, 4-6 digits |
| "Duplicate item" | Set+condition already exists | Edit existing item instead |

## Related
- [Managing Stock Levels](./managing-stock.md)
- [Item Details](./item-details.md)
```

---

## 8. Phase 4: UI Inspection

### 8.1 Prerequisites

- App running at `localhost:3000`
- Playwright MCP available
- Authenticated session (if required)

### 8.2 Inspection Process

For each page/feature:

```
1. Navigate to route
2. Wait for load complete
3. Capture full-page screenshot
4. Identify interactive elements:
   - Buttons (with labels/actions)
   - Form inputs (with types/validation)
   - Data displays (tables, cards, lists)
   - Navigation elements
5. Document interactions:
   - Click button → what happens
   - Form submission → result
   - Filter/sort → effect
6. Capture state variations:
   - Empty state
   - Loaded state
   - Error state (if triggerable)
```

### 8.3 Screenshot Management

**Storage:**
```
/docs/functional/screenshots/
├── inventory/
│   ├── inventory-list.png
│   ├── inventory-add-form.png
│   ├── inventory-item-detail.png
│   └── ...
├── ebay/
│   └── ...
└── ...
```

**Naming Convention:**
`{feature}-{page-or-component}-{state}.png`

Examples:
- `inventory-list-default.png`
- `inventory-list-filtered.png`
- `inventory-add-form-validation-error.png`

### 8.4 Element Inventory

For each inspected page, capture:

```markdown
## Page Elements: /inventory

### Data Display
| Element | Type | Content |
|---------|------|---------|
| Inventory Table | Table | Lists all items with columns: Image, Name, Set#, Qty, Price, Status |
| Summary Cards | Stats | Total items, Total value, Low stock count |
| Pagination | Navigation | Page size selector, page numbers |

### Interactive Elements
| Element | Type | Action |
|---------|------|--------|
| Add Item | Button | Opens /inventory/add |
| Search | Input | Filters table by name/set number |
| Condition Filter | Dropdown | Filters by New/Used/All |
| Sort | Dropdown | Sort by name, price, date, quantity |
| Row Click | Row Action | Opens item detail |
| Quick Edit Qty | Inline Input | Updates quantity without navigation |

### States Observed
- Empty state: "No inventory items yet. Add your first item."
- Loading: Skeleton placeholders
- Error: Toast notification with retry option
```

---

## 9. Phase 5: Business Logic Extraction

### 9.1 Identification

Scan service files for:
- Calculation functions
- Validation rules
- Status determination
- Transformation logic
- Business rules with conditionals

### 9.2 Extraction Format

For each piece of business logic:

```markdown
### [Logic Name]

**Plain English:**
[Human-readable explanation of what the logic does and why]

**Formula/Rules:**
[Pseudo-code or formula representation]

**Example:**
[Concrete example with numbers]

**Edge Cases:**
- [Edge case 1 and how it's handled]
- [Edge case 2 and how it's handled]

**Source:** `[file path]:[function name]()`
```

### 9.3 Example Extraction

```markdown
### Fee Calculation

**Plain English:**
When an item sells on eBay, the system calculates total fees to determine 
actual profit. This accounts for eBay's final value fee and payment 
processing fees.

**Formula:**
```
ebayFee = salePrice × 0.128
paypalFee = (salePrice × 0.029) + 0.30
totalFees = ebayFee + paypalFee
```

**Example:**
Item sells for £50.00:
- eBay Fee: £50 × 12.8% = £6.40
- PayPal Fee: (£50 × 2.9%) + £0.30 = £1.75
- Total Fees: £8.15
- Net Revenue: £41.85

**Edge Cases:**
- Items under £1: PayPal fixed fee (£0.30) may exceed percentage fee
- Multi-item orders: Fees calculated per-item, not on order total
- Refunds: Fees are not refunded by eBay (documented in returns flow)

**Source:** `apps/web/lib/services/pricing.service.ts:calculateFees()`
```

---

## 10. Phase 6: Output & Indexing

### 10.1 Index Generation

After documentation generation, create/update the main index:

```markdown
# Hadley Bricks — Functional Documentation

> Auto-generated documentation of application features and capabilities.
> Last updated: 2026-01-18T10:30:00Z

## Coverage

| Feature Area | Coverage | Last Updated |
|--------------|----------|--------------|
| [Inventory Management](./inventory/overview.md) | 100% | 2026-01-18 |
| [eBay Integration](./ebay/overview.md) | 85% | 2026-01-17 |
| [Purchase Parsing](./purchases/overview.md) | 0% | — |
| ... | ... | ... |

**Overall Progress:** ████████░░░░░░░░░░░░ 42%

## User Journeys

### Inventory
- [Adding Inventory](./inventory/adding-inventory.md)
- [Managing Stock Levels](./inventory/managing-stock.md)
- [Viewing Item Details](./inventory/item-details.md)

### Sales
- [Listing on eBay](./ebay/listing-item.md)
- [Processing Orders](./ebay/processing-orders.md)
- [Reconciling Payments](./payments/reconciliation.md)

### Reporting
- [Viewing Inventory Value](./reporting/inventory-value.md)
- [Sales Performance](./reporting/sales-performance.md)

## Quick Reference

- [All Business Logic](./reference/business-logic.md)
- [Data Models](./reference/data-models.md)
- [API Endpoints](./reference/api-endpoints.md)
```

### 10.2 Cross-Referencing

All documentation includes:
- Links to related features
- Links to related user journeys
- Back-links to index
- Source code references

---

## 11. Incremental Updates

### 11.1 Timestamp Tracking

State file (`/docs/agents/functional-docs/state.json`) tracks:

```json
{
  "lastFullRun": "2026-01-15T14:30:00Z",
  "documentedFiles": {
    "apps/web/lib/services/inventory.service.ts": {
      "lastModified": "2026-01-15T10:00:00Z",
      "lastDocumented": "2026-01-15T14:30:00Z",
      "outputFiles": ["inventory/overview.md", "inventory/adding-inventory.md"]
    }
  },
  "coverage": {
    "inventory": 100,
    "ebay": 85,
    "purchases": 0
  }
}
```

### 11.2 Change Detection

On `/docs update`:

```
1. Scan all tracked source files
2. Compare file modified timestamps vs lastDocumented
3. Identify stale documentation:
   - Source newer than docs → needs update
   - Source deleted → docs need removal notice
   - New source files → needs initial documentation
4. Report findings
5. Update only affected documentation
```

### 11.3 Update Report

```markdown
## Documentation Update Report

**Scan completed:** 2026-01-18T10:30:00Z

### Changes Detected

| File | Change | Action |
|------|--------|--------|
| `pricing.service.ts` | Modified 2h ago | Re-document fee calculation |
| `new-report.tsx` | New file | Add to reporting docs |
| `old-feature.ts` | Deleted | Mark docs as deprecated |

### Updated Documentation
- ✅ inventory/adding-inventory.md — Updated fee calculation section
- ✅ reporting/overview.md — Added new report reference

### Coverage Change
- Before: 42%
- After: 45%
- Progress: +3%
```

---

## 12. State Management

### 12.1 Design Principles

State management follows the **Domain Memory Pattern** established across all agents:

| Principle | Implementation |
|-----------|----------------|
| **Externalise the Goal** | Coverage targets and documentation queue in state file |
| **Atomic Progress** | Document ONE journey, update state, then next |
| **Clean Campsite** | Every run ends with consistent state, even on failure |
| **Standard Boot-up** | Read state → Detect changes → Check prerequisites → Act |
| **State as Truth** | State file is authoritative for what's documented |

### 12.2 State File Location

Aligned with other agents:

```
/docs/agents/functional-docs/
├── state.json              # Main state file (truth)
├── discovery-cache.json    # Cached discovery results
├── screenshots-manifest.json  # Screenshot metadata
├── run.lock                # Prevents concurrent runs
└── recovery.json           # Partial progress for crash recovery
```

### 12.3 State Schema

```typescript
interface DocsState {
  // Versioning
  version: string;                        // Schema version for migrations
  
  // Run tracking
  lastFullRun: string | null;             // ISO timestamp
  lastIncrementalRun: string | null;      // ISO timestamp
  runInProgress: boolean;                 // Lock flag
  lastRunStatus: 'success' | 'failed' | 'partial';
  
  // Coverage metrics
  coverage: {
    [featureArea: string]: number;        // 0-100
  };
  overallCoverage: number;                // 0-100
  
  // Documentation queue (for atomic progress)
  queue: {
    pending: string[];                    // Journeys/features to document
    inProgress: string | null;            // Currently documenting
    completed: string[];                  // Done this run
    failed: string[];                     // Failed this run
  };
  
  // File tracking
  documentedFiles: {
    [filePath: string]: {
      lastModified: string;
      lastDocumented: string;
      outputFiles: string[];
      checksum: string;                   // For change detection
    }
  };
  
  // Journey tracking
  userJourneys: {
    [journeyName: string]: {
      documented: boolean;
      lastUpdated: string;
      sourceFiles: string[];
      outputFile: string;
    }
  };
  
  // Screenshot tracking
  screenshots: {
    [screenshotPath: string]: {
      capturedAt: string;
      forPage: string;
      dimensions: { width: number; height: number };
      checksum: string;
    }
  };
}
```

### 12.4 State Updates

State is updated **atomically after each unit of work**:

```
Document Journey A → Update state (A complete) → Document Journey B → Update state (B complete)
```

Never:
```
Document A, B, C, D → Update state (all complete)  ❌ Risk of lost progress
```

### 12.5 Atomic Progress Enforcement

The agent maintains a **queue** in state:

```json
{
  "queue": {
    "pending": ["managing-stock", "item-details", "bulk-import"],
    "inProgress": "adding-inventory",
    "completed": [],
    "failed": []
  }
}
```

**Workflow:**
1. Pop item from `pending` → set as `inProgress`
2. Update state file (commit the intent)
3. Document the journey
4. On success: move to `completed`, clear `inProgress`
5. On failure: move to `failed`, clear `inProgress`, log error
6. Update state file
7. Repeat until `pending` is empty

This ensures a crash mid-documentation loses at most ONE journey's work.

### 12.6 Run Locking

Prevents concurrent runs from corrupting state:

**Lock file:** `/docs/agents/functional-docs/run.lock`

```json
{
  "lockedAt": "2026-01-18T10:30:00Z",
  "lockedBy": "session-abc123",
  "mode": "document",
  "target": "inventory"
}
```

**Boot sequence checks:**
```
1. Check for run.lock
2. If exists and < 1 hour old → ABORT with message
3. If exists and > 1 hour old → WARN about stale lock, offer to clear
4. If not exists → Create lock, proceed
5. On completion (success or failure) → Remove lock
```

**Stale lock handling:**
```
⚠️ WARNING: Stale lock detected

A previous run started at 2026-01-17T15:30:00Z but never completed.
This may indicate a crash or interrupted session.

Options:
1. Clear lock and continue (may need to verify state consistency)
2. Abort and investigate manually

Proceed with option 1? (y/n)
```

### 12.7 Clean Campsite

**Principle:** Every run ends with consistent state, even on failure.

**On successful completion:**
```
1. All queue items processed (completed or failed)
2. State file updated with final metrics
3. Lock file removed
4. Recovery file cleared
5. Index regenerated with current coverage
```

**On failure/interruption:**
```
1. Current item marked as failed in state
2. Remaining queue preserved for retry
3. Recovery file written with failure context
4. Lock file removed
5. State remains consistent (partial progress saved)
```

**Recovery file format:**
```json
{
  "failedAt": "2026-01-18T10:45:00Z",
  "failedDuring": "adding-inventory",
  "error": "Playwright timeout on /inventory/add",
  "stateBeforeFailure": { ... },
  "partialOutput": "/docs/agents/functional-docs/.partial/adding-inventory.md"
}
```

### 12.8 Error Recovery

#### Corrupted State File

```
❌ ERROR: State file corrupted or invalid JSON

Recovery options:
1. Rebuild state from existing documentation (scan /docs/functional/)
2. Start fresh (reset to zero coverage)
3. Restore from backup (if available)

Select option:
```

**Rebuild process:**
- Scan all `.md` files in `/docs/functional/`
- Extract metadata from "Generated" timestamps
- Reconstruct coverage metrics
- Mark all source files as "needs verification"

#### Missing State File (First Run vs Lost)

```
ℹ️ No state file found at /docs/agents/functional-docs/state.json

This could mean:
A) First run of the documentation agent
B) State file was deleted

Checking for existing documentation...
- Found: 12 markdown files in /docs/functional/
- Found: 24 screenshots in /docs/functional/screenshots/

This appears to be scenario B (existing docs, no state).

Options:
1. Rebuild state from existing docs (recommended)
2. Start fresh (will overwrite existing docs)

Select option:
```

#### State/Reality Mismatch

Detected when state claims X% coverage but files don't match:

```
⚠️ WARNING: State/reality mismatch detected

State claims:
- inventory/adding-inventory.md: documented ✓
- inventory/managing-stock.md: documented ✓

Reality:
- inventory/adding-inventory.md: EXISTS ✓
- inventory/managing-stock.md: MISSING ✗

Options:
1. Update state to match reality (mark managing-stock as undocumented)
2. Regenerate missing documentation
3. Abort and investigate

Select option:
```

### 12.9 State Versioning & Migration

State file includes version for future migrations:

```json
{
  "version": "1.0",
  ...
}
```

On boot, agent checks version:
```
1. Read state.version
2. Compare to agent's expected version
3. If older → Run migration scripts
4. If newer → ABORT (agent outdated, don't corrupt state)
5. If match → Proceed
```

### 12.10 Backup Strategy

Before any state modification:
```
1. Copy state.json → state.backup.json
2. Perform modification
3. On success → Keep backup for one more run, then delete
4. On failure → Backup available for manual recovery
```

---

## 13. Error Handling

### 13.1 App Not Running

```
❌ ERROR: Cannot reach application at localhost:3000

UI inspection requires the app to be running.

Options:
1. Start the app: `npm run dev`
2. Run without UI inspection: /docs document --no-ui
3. Abort
```

### 13.2 Playwright Unavailable

```
⚠️ WARNING: Playwright MCP not available

UI inspection will be skipped. Documentation will be generated 
from code analysis only.

Proceed? (y/n)
```

### 13.3 Source File Errors

```
⚠️ WARNING: Could not parse apps/web/lib/services/broken.service.ts

TypeScript errors in file. Skipping business logic extraction.
Documentation will note: "Unable to document — source file has errors"

Continuing with remaining files...
```

### 13.4 Screenshot Failures

```
⚠️ WARNING: Screenshot capture failed for /inventory/[id]

Possible causes:
- Page requires specific data (no items exist)
- Authentication required
- Page crashed

Marking as "screenshot pending" — retry with: /docs inspect inventory-detail
```

---

## 14. Output Templates

### 14.1 Feature Overview Template

```markdown
# {Feature Name}

## Purpose
{One paragraph describing what this feature does and why it exists}

## Key Capabilities
- {Capability 1}
- {Capability 2}
- {Capability 3}

## User Journeys
- [{Journey 1}](./{journey-1}.md)
- [{Journey 2}](./{journey-2}.md)

## Pages
| Page | Route | Purpose |
|------|-------|---------|
| {Page 1} | {/route} | {Purpose} |

## Business Logic
Summary of key business rules — see individual journey docs for details.

## Related Features
- [{Related 1}](../{related}/overview.md) — {relationship}

---
*Generated: {timestamp}*
*Source files: {count}*
```

### 14.2 User Journey Template

```markdown
# {Journey Name}

## Overview
{One paragraph describing this user journey}

## Entry Points
- {Entry point 1}
- {Entry point 2}

## Flow

### Step 1: {Step Name}
{Description}

![{Screenshot alt}](../screenshots/{feature}/{screenshot}.png)

**Fields/Elements:**
| Element | Type | Description |
|---------|------|-------------|
| {Element} | {Type} | {Description} |

### Step 2: {Step Name}
...

## Business Logic

### {Logic Name}
**Plain English:**
{Explanation}

**Formula/Rules:**
```
{formula or pseudo-code}
```

**Source:** `{file path}:{function}()`

## Error Handling
| Error | Cause | Resolution |
|-------|-------|------------|
| {Error} | {Cause} | {Resolution} |

## Related
- [{Related journey}](./{related}.md)

---
*Generated: {timestamp}*
*Sources: {file list}*
```

---

## 15. Folder Structure

```
/docs/
├── agents/
│   └── functional-docs/           # Agent state (aligned with other agents)
│       ├── state.json             # Main state file (truth)
│       ├── discovery-cache.json   # Cached discovery results
│       ├── screenshots-manifest.json
│       ├── run.lock               # Prevents concurrent runs
│       ├── recovery.json          # Crash recovery context
│       ├── state.backup.json      # Rolling backup
│       └── .partial/              # Incomplete outputs during run
│
└── functional/                    # Documentation output
    ├── index.md                   # Main index with coverage dashboard
    ├── screenshots/
    │   ├── inventory/
    │   ├── ebay/
    │   └── ...
    ├── inventory/
    │   ├── overview.md
    │   ├── adding-inventory.md
    │   ├── managing-stock.md
    │   └── item-details.md
    ├── ebay/
    │   ├── overview.md
    │   ├── listing-item.md
    │   └── processing-orders.md
    ├── purchases/
    │   └── ...
    ├── reporting/
    │   └── ...
    └── reference/
        ├── business-logic.md       # All business logic in one place
        ├── data-models.md          # Entity documentation
        └── api-endpoints.md        # API reference
```

---

## 16. Examples

### 16.1 Discovery Run

```
User: /docs discover

Agent: Starting discovery scan...

Scanning codebase:
- apps/web/app/ — 45 routes found
- apps/web/lib/services/ — 23 service files
- apps/web/components/ — 156 components
- apps/web/lib/repositories/ — 18 repositories

Analysing feature areas...
Mapping user journeys...
Checking existing documentation...

---

## Documentation Priorities (Proposed)

### High Priority
1. **Inventory Management** 
   - 47 files, complex business logic
   - Core feature, critical for daily operations
   - Includes: stock levels, purchase parsing, cost tracking

2. **eBay Integration**
   - 23 files, OAuth flows, listing sync
   - Complex external integration with multiple API calls
   - Includes: auth, listing CRUD, order sync, fee calculation

3. **Purchase Parsing (AI)**
   - 12 files, AI-powered extraction
   - Undocumented prompts and edge case handling

### Medium Priority
4. **BrickLink Sync** — OAuth 1.0a, inventory reconciliation
5. **Reporting Dashboard** — Calculated metrics, value tracking
6. **Google Sheets Integration** — Legacy sync, dual-write pattern

### Lower Priority  
7. **Authentication** — Standard Supabase auth
8. **Settings** — User preferences, thresholds

---

## Documentation Coverage

| Feature Area | Files | Documented | Coverage | Status |
|--------------|-------|------------|----------|--------|
| Inventory Management | 47 | 0 | 0% | 🔴 |
| eBay Integration | 23 | 0 | 0% | 🔴 |
| Purchase Parsing | 12 | 0 | 0% | 🔴 |
| BrickLink Sync | 18 | 0 | 0% | 🔴 |
| Reporting | 15 | 0 | 0% | 🔴 |
| Sheets Integration | 9 | 0 | 0% | 🔴 |
| Authentication | 8 | 0 | 0% | 🔴 |
| Settings | 6 | 0 | 0% | 🔴 |
| **TOTAL** | **138** | **0** | **0%** | 🔴 |

Progress: ░░░░░░░░░░░░░░░░░░░░ 0%

---

Discovery complete.

How would you like to proceed?
1. `/docs document all` — Start with highest priority, document everything
2. `/docs document inventory` — Document inventory feature only
3. `/docs document <specific>` — Document a specific area
4. Adjust priorities and re-run discovery
```

### 16.2 Incremental Update

```
User: /docs update

Agent: Scanning for changes since last documentation run (2026-01-15)...

Changes detected:

| File | Change | Last Modified |
|------|--------|---------------|
| pricing.service.ts | Modified | 2h ago |
| new-bulk-export.tsx | New | 1d ago |
| old-manual-sync.ts | Deleted | 3d ago |

Updating affected documentation...

✅ inventory/adding-inventory.md — Updated fee calculation (pricing.service.ts changed)
✅ inventory/overview.md — Added bulk export reference
⚠️ sheets/manual-sync.md — Marked as deprecated (source deleted)
✅ index.md — Updated coverage metrics

---

## Update Summary

- Documents updated: 3
- Documents deprecated: 1
- Screenshots refreshed: 0

## Coverage Change
- Before: 42%
- After: 44%
- Delta: +2%

Progress: ████████░░░░░░░░░░░░ 44%
```

---

## Appendix A: Handoffs

| From | To | Trigger |
|------|-----|---------|
| Feature merged | Docs Agent | `/docs update` after merge |
| Docs Agent | Human | Review via git diff |
| Discovery | Human | Approval required before documenting |

---

## Appendix B: Configuration

Future: Could add `.docsrc.json` for:
- Custom feature area groupings
- Excluded files/folders
- Screenshot settings
- Custom templates

For now, conventions are hardcoded in agent.

---

*Last Updated: January 2026*
*Version: 1.0*
