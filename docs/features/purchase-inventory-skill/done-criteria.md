# Done Criteria: purchase-inventory-skill

**Created:** 2026-01-28
**Author:** Define Done Agent + Chris
**Status:** APPROVED

---

## Feature Summary

A Claude Code skill (`/purchase-inventory`) that enables rapid creation of purchase and inventory records via photos and/or natural language descriptions. Claude analyses input, conducts an interactive interview to fill missing required fields, enriches data from Brickset (set names) and ASIN lookup (for Amazon listings), presents a markdown review table, and on approval creates the purchase record with linked inventory items. Supports flexible creation modes: one purchase with multiple items (1:X) or multiple separate purchases (1:1).

**Problem:** Manual data entry for purchases and inventory is tedious and error-prone. You want a "backdoor" to quickly add records using photos of receipts/sets and natural language, with Claude handling parsing, enrichment, and creation.

**User:** Chris (CLI user via Claude Code)

**Trigger:** `/purchase-inventory` skill command with optional photos and/or text description

**Outcome:**
1. Claude analyses photos/text to extract purchase and inventory details
2. Claude asks interview questions one-by-one for any missing required fields
3. Claude enriches with Brickset data (set names, themes) and ASIN (if Amazon platform)
4. Markdown table shown for review (purchase + inventory items)
5. On approval: Purchase created → Inventory items created with status BACKLOG, linked to purchase
6. On failure: Rollback, report reason, save progress for editing and re-submission

---

## Success Criteria

### Functional - Skill Infrastructure

#### F1: Skill File Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** A skill definition file exists at `.claude/commands/purchase-inventory.md`
- **Evidence:** File exists and contains skill instructions
- **Test:** `Test-Path ".claude/commands/purchase-inventory.md"` returns true

#### F2: Skill Invocable
- **Tag:** AUTO_VERIFY
- **Criterion:** Running `/purchase-inventory` in Claude Code loads the skill without errors
- **Evidence:** Skill loads and Claude responds with initial prompt
- **Test:** Manual invocation returns greeting/instruction (not "skill not found")

---

### Functional - Input Handling

#### F3: Photo Input Accepted
- **Tag:** AUTO_VERIFY
- **Criterion:** Skill accepts image file paths (PNG, JPG, JPEG) as input and processes them using Claude's vision capability
- **Evidence:** Providing an image path results in Claude analysing the image content
- **Test:** Invoke with test image, Claude describes image contents

#### F4: Text Input Accepted
- **Tag:** AUTO_VERIFY
- **Criterion:** Skill accepts natural language text descriptions of purchases/inventory
- **Evidence:** Providing text like "Bought 3x 75192 from eBay for £450" is parsed correctly
- **Test:** Invoke with text, Claude extracts set numbers, cost, source

#### F5: Mixed Input Accepted
- **Tag:** AUTO_VERIFY
- **Criterion:** Skill accepts combination of photos and text in single invocation
- **Evidence:** User can provide 2 photos + text description, all are processed
- **Test:** Invoke with photo + text, both are incorporated into analysis

#### F6: Multiple Photos Accepted
- **Tag:** AUTO_VERIFY
- **Criterion:** Skill accepts up to 10 photos in a single invocation
- **Evidence:** Providing 10 image paths results in all 10 being analysed
- **Test:** Invoke with 10 test images, Claude references all 10

---

### Functional - Creation Mode

#### F7: Creation Mode Question Asked
- **Tag:** AUTO_VERIFY
- **Criterion:** Claude asks whether to create 1:X (one purchase, multiple items) or 1:1 (separate purchases per item/photo)
- **Evidence:** Interview includes explicit question about creation mode
- **Test:** Start skill with multiple items, observe mode question

#### F8: 1:X Mode Creates Single Purchase
- **Tag:** AUTO_VERIFY
- **Criterion:** When 1:X mode selected, one purchase record is created with total cost, and all inventory items link to it
- **Evidence:** Database query shows 1 purchase with N inventory items referencing its ID
- **Test:** Complete 1:X flow, query `purchases` and `inventory_items` tables

#### F9: 1:1 Mode Creates Multiple Purchases
- **Tag:** AUTO_VERIFY
- **Criterion:** When 1:1 mode selected, separate purchase records are created, each with its own inventory items
- **Evidence:** Database query shows N purchases, each with their linked items
- **Test:** Complete 1:1 flow with 3 items, verify 3 purchases created

---

### Functional - Interview Flow

#### F10: Interview Questions Asked Sequentially
- **Tag:** AUTO_VERIFY
- **Criterion:** Claude asks missing required fields one question at a time, not as a batch
- **Evidence:** Each question waits for user response before asking next
- **Test:** Start with minimal input, observe sequential questions

#### F11: Required Fields Prompted If Missing
- **Tag:** AUTO_VERIFY
- **Criterion:** Claude prompts for all required fields not extractable from input: cost, source, payment_method, purchase_date, condition, set_numbers (at least one), listing_platform
- **Evidence:** When field cannot be extracted, Claude asks for it
- **Test:** Invoke with photo only (no text), observe prompts for missing fields

#### F12: Extracted Fields Not Re-Asked
- **Tag:** AUTO_VERIFY
- **Criterion:** If Claude successfully extracts a field from photos/text, it does not ask for it again
- **Evidence:** Providing "eBay £450" in text means source and cost are not asked
- **Test:** Invoke with partial text, verify extracted fields skipped in interview

#### F13: Interview Confirms Understanding
- **Tag:** AUTO_VERIFY
- **Criterion:** Before proceeding to review table, Claude summarises what it understood and asks for confirmation
- **Evidence:** Summary shown after interview, before table
- **Test:** Complete interview, observe summary confirmation step

---

### Functional - Data Enrichment

#### F14: Brickset Set Name Lookup
- **Tag:** AUTO_VERIFY
- **Criterion:** For each set number, Claude calls `/api/brickset/search` to get set name, theme, year
- **Evidence:** Review table shows set names populated from Brickset, not just numbers
- **Test:** Provide set number "75192", table shows "Millennium Falcon"

#### F15: Brickset Cache Used First
- **Tag:** AUTO_VERIFY
- **Criterion:** Set lookup uses `brickset_sets` table cache before calling external API
- **Evidence:** Network logs show `/api/brickset/search?useApi=false` called first
- **Test:** Provide known cached set number, verify cache hit

#### F16: Unknown Set Triggers API Lookup
- **Tag:** AUTO_VERIFY
- **Criterion:** If set not in cache, Claude offers to search Brickset API
- **Evidence:** For uncached set, Claude asks "Search Brickset API for [number]?"
- **Test:** Provide rare/new set number not in cache

#### F17: ASIN Lookup When Amazon Platform
- **Tag:** AUTO_VERIFY
- **Criterion:** When listing_platform is "Amazon", Claude calls `AsinMatchingService.matchMultiple()` to get ASINs for each set
- **Evidence:** Review table shows ASIN column populated for Amazon items
- **Test:** Set listing_platform to Amazon, verify ASINs populated

#### F18: ASIN Not Looked Up For Non-Amazon
- **Tag:** AUTO_VERIFY
- **Criterion:** When listing_platform is not Amazon, ASIN lookup is skipped
- **Evidence:** No ASIN service calls made, ASIN column shows empty/N/A
- **Test:** Set listing_platform to eBay, verify no ASIN lookup

---

### Functional - Review Table

#### F19: Purchase Summary Shown
- **Tag:** AUTO_VERIFY
- **Criterion:** Review displays purchase details in a markdown table: short_description, total_cost, source, payment_method, purchase_date
- **Evidence:** Markdown table with purchase row(s) visible in CLI output
- **Test:** Complete interview, verify purchase table rendered

#### F20: Inventory Items Table Shown
- **Tag:** AUTO_VERIFY
- **Criterion:** Review displays inventory items in a markdown table: set_number, item_name (from Brickset), condition, quantity, cost_per_item, listing_platform, ASIN (if Amazon), status (BACKLOG)
- **Evidence:** Markdown table with one row per inventory item
- **Test:** Complete interview with 3 items, verify 3 rows in table

#### F21: Approval Prompt Shown
- **Tag:** AUTO_VERIFY
- **Criterion:** After review table, Claude asks for explicit approval before creating records ("Create these records? (yes/no/edit)")
- **Evidence:** Prompt appears after table, waits for user input
- **Test:** Reach review step, observe approval prompt

#### F22: Edit Option Available
- **Tag:** AUTO_VERIFY
- **Criterion:** User can respond "edit" to modify entries before submission
- **Evidence:** Responding "edit" allows user to specify changes, table re-renders
- **Test:** At approval prompt, respond "edit", modify a value, see updated table

---

### Functional - Record Creation

#### F23: Purchase Created Via Service
- **Tag:** AUTO_VERIFY
- **Criterion:** On approval, purchase record created using existing `PurchaseService.create()` method
- **Evidence:** Purchase appears in `purchases` table with correct fields
- **Test:** Complete flow, query database for new purchase

#### F24: Inventory Items Created Via Service
- **Tag:** AUTO_VERIFY
- **Criterion:** Inventory items created using existing `InventoryService.createMany()` method with auto-generated SKUs
- **Evidence:** Items appear in `inventory_items` table with SKU pattern `HB-{CONDITION}-{SET}-{TIMESTAMP}-{INDEX}`
- **Test:** Complete flow, query database for new inventory items

#### F25: Items Linked To Purchase
- **Tag:** AUTO_VERIFY
- **Criterion:** Each inventory item has `purchase_id` set to the created purchase's ID
- **Evidence:** Database query shows `purchase_id` foreign key populated
- **Test:** Query `inventory_items WHERE purchase_id = <new_purchase_id>`, count matches

#### F26: Status Set To BACKLOG
- **Tag:** AUTO_VERIFY
- **Criterion:** All created inventory items have `status = 'BACKLOG'`
- **Evidence:** Database query confirms status field
- **Test:** Query created items, all have BACKLOG status

#### F27: Quantity Expansion
- **Tag:** AUTO_VERIFY
- **Criterion:** If quantity > 1 for a set (e.g., "3x 75192"), that many individual inventory items are created
- **Evidence:** 3x 75192 creates 3 separate rows in inventory_items
- **Test:** Create with quantity 3, verify 3 rows created

---

### Error Handling

#### E1: API Failure Rollback
- **Tag:** AUTO_VERIFY
- **Criterion:** If inventory item creation fails after purchase created, the purchase is deleted (rollback)
- **Evidence:** On partial failure, no orphan purchase remains in database
- **Test:** Mock inventory service failure, verify purchase rolled back

#### E2: Failure Reason Reported
- **Tag:** AUTO_VERIFY
- **Criterion:** On creation failure, Claude displays specific error reason to user
- **Evidence:** Error message includes which operation failed and why
- **Test:** Trigger failure, observe error message content

#### E3: Progress Saved On Failure
- **Tag:** AUTO_VERIFY
- **Criterion:** On failure, the collected data (purchase, items) is preserved in Claude's context for editing and retry
- **Evidence:** User can say "try again" or "edit" after failure without re-entering all data
- **Test:** Trigger failure, then say "edit cost to £500", verify retained data

#### E4: Network Error Handled
- **Tag:** AUTO_VERIFY
- **Criterion:** If Brickset or ASIN lookup fails due to network error, Claude reports gracefully and continues with manual entry option
- **Evidence:** Lookup failure shows message like "Could not lookup set name - please enter manually"
- **Test:** Mock network failure, observe graceful degradation

#### E5: Invalid Set Number Handled
- **Tag:** AUTO_VERIFY
- **Criterion:** If a set number doesn't exist in Brickset, Claude flags it and asks user to confirm or correct
- **Evidence:** Unknown set shows "Set not found in Brickset - continue anyway or enter different number?"
- **Test:** Provide fake set number "99999", observe handling

#### E6: No Photos Or Text Provided
- **Tag:** AUTO_VERIFY
- **Criterion:** If user invokes skill with no photos and no text, Claude prompts for at least one input type
- **Evidence:** Message like "Please provide photos of the receipt/sets, or describe the purchase in text"
- **Test:** Invoke `/purchase-inventory` with no arguments

---

### Performance

#### P1: Interview Completes In Reasonable Time
- **Tag:** AUTO_VERIFY
- **Criterion:** Full interview flow (with all questions) completes in under 60 seconds of Claude processing time
- **Evidence:** Measured from first response to review table shown
- **Test:** Time full interview with 3 items

#### P2: Brickset Lookup Under 2 Seconds
- **Tag:** AUTO_VERIFY
- **Criterion:** Each Brickset set lookup completes in under 2 seconds
- **Evidence:** Response time for `/api/brickset/search` < 2000ms
- **Test:** Measure lookup time for known set

#### P3: ASIN Lookup Under 3 Seconds
- **Tag:** AUTO_VERIFY
- **Criterion:** ASIN lookup for up to 10 sets completes in under 3 seconds
- **Evidence:** AsinMatchingService.matchMultiple response time < 3000ms
- **Test:** Measure lookup for 5 set numbers

#### P4: Record Creation Under 5 Seconds
- **Tag:** AUTO_VERIFY
- **Criterion:** Creating 1 purchase + 10 inventory items completes in under 5 seconds
- **Evidence:** Time from approval to "Records created" confirmation < 5000ms
- **Test:** Create 10-item batch, measure creation time

---

### Integration

#### I1: Uses Existing Purchase Service
- **Tag:** AUTO_VERIFY
- **Criterion:** Skill calls `PurchaseService.create()` from `apps/web/src/lib/services/purchase.service.ts`
- **Evidence:** Code inspection shows import and usage of existing service
- **Test:** Grep skill implementation for PurchaseService

#### I2: Uses Existing Inventory Service
- **Tag:** AUTO_VERIFY
- **Criterion:** Skill calls `InventoryService.createMany()` from `apps/web/src/lib/services/inventory.service.ts`
- **Evidence:** Code inspection shows import and usage of existing service
- **Test:** Grep skill implementation for InventoryService

#### I3: Uses Existing Brickset Search API
- **Tag:** AUTO_VERIFY
- **Criterion:** Set lookup uses `/api/brickset/search` endpoint with `useApi=false` for cache, `useApi=true` for live
- **Evidence:** Network calls match existing API pattern
- **Test:** Inspect network calls during skill execution

#### I4: Uses Existing ASIN Matching Service
- **Tag:** AUTO_VERIFY
- **Criterion:** ASIN lookup uses `AsinMatchingService.matchMultiple()` from `apps/web/src/lib/services/asin-matching.service.ts`
- **Evidence:** Code inspection shows import and usage of existing service
- **Test:** Grep skill implementation for AsinMatchingService

#### I5: Dual-Write To Google Sheets
- **Tag:** AUTO_VERIFY
- **Criterion:** Inventory creation triggers async Google Sheets sync (existing dual-write pattern)
- **Evidence:** Sheets updated after inventory creation (fire-and-forget)
- **Test:** Create items, check Google Sheets for new rows

---

## Out of Scope

- Web UI for this skill (CLI only)
- Editing existing purchases/inventory (create only)
- Import from CSV/Excel files
- Batch import from multiple receipts in one invocation (beyond 10 photos)
- Photo storage/attachment to purchase record
- OCR for receipt text extraction (relies on Claude vision)
- Automatic listing creation on platforms
- Cost allocation/splitting logic (user specifies per-item or total)

---

## Dependencies

- Claude Code CLI functional
- Claude API with vision capability available
- Supabase cloud database accessible
- Brickset API credentials configured (or cache populated)
- `PurchaseService` and `InventoryService` functional
- `AsinMatchingService` functional (for Amazon listings)
- `/api/brickset/search` endpoint functional

---

## Iteration Budget

- **Max iterations:** 5
- **Escalation:** If not converged after 5 iterations, pause for human review

---

## Verification Summary

| ID | Criterion | Tag | Status |
|----|-----------|-----|--------|
| F1 | Skill file exists | AUTO_VERIFY | PENDING |
| F2 | Skill invocable | AUTO_VERIFY | PENDING |
| F3 | Photo input accepted | AUTO_VERIFY | PENDING |
| F4 | Text input accepted | AUTO_VERIFY | PENDING |
| F5 | Mixed input accepted | AUTO_VERIFY | PENDING |
| F6 | Multiple photos accepted | AUTO_VERIFY | PENDING |
| F7 | Creation mode question asked | AUTO_VERIFY | PENDING |
| F8 | 1:X mode creates single purchase | AUTO_VERIFY | PENDING |
| F9 | 1:1 mode creates multiple purchases | AUTO_VERIFY | PENDING |
| F10 | Interview questions asked sequentially | AUTO_VERIFY | PENDING |
| F11 | Required fields prompted if missing | AUTO_VERIFY | PENDING |
| F12 | Extracted fields not re-asked | AUTO_VERIFY | PENDING |
| F13 | Interview confirms understanding | AUTO_VERIFY | PENDING |
| F14 | Brickset set name lookup | AUTO_VERIFY | PENDING |
| F15 | Brickset cache used first | AUTO_VERIFY | PENDING |
| F16 | Unknown set triggers API lookup | AUTO_VERIFY | PENDING |
| F17 | ASIN lookup when Amazon platform | AUTO_VERIFY | PENDING |
| F18 | ASIN not looked up for non-Amazon | AUTO_VERIFY | PENDING |
| F19 | Purchase summary shown | AUTO_VERIFY | PENDING |
| F20 | Inventory items table shown | AUTO_VERIFY | PENDING |
| F21 | Approval prompt shown | AUTO_VERIFY | PENDING |
| F22 | Edit option available | AUTO_VERIFY | PENDING |
| F23 | Purchase created via service | AUTO_VERIFY | PENDING |
| F24 | Inventory items created via service | AUTO_VERIFY | PENDING |
| F25 | Items linked to purchase | AUTO_VERIFY | PENDING |
| F26 | Status set to BACKLOG | AUTO_VERIFY | PENDING |
| F27 | Quantity expansion | AUTO_VERIFY | PENDING |
| E1 | API failure rollback | AUTO_VERIFY | PENDING |
| E2 | Failure reason reported | AUTO_VERIFY | PENDING |
| E3 | Progress saved on failure | AUTO_VERIFY | PENDING |
| E4 | Network error handled | AUTO_VERIFY | PENDING |
| E5 | Invalid set number handled | AUTO_VERIFY | PENDING |
| E6 | No photos or text provided | AUTO_VERIFY | PENDING |
| P1 | Interview completes in reasonable time | AUTO_VERIFY | PENDING |
| P2 | Brickset lookup under 2 seconds | AUTO_VERIFY | PENDING |
| P3 | ASIN lookup under 3 seconds | AUTO_VERIFY | PENDING |
| P4 | Record creation under 5 seconds | AUTO_VERIFY | PENDING |
| I1 | Uses existing purchase service | AUTO_VERIFY | PENDING |
| I2 | Uses existing inventory service | AUTO_VERIFY | PENDING |
| I3 | Uses existing Brickset search API | AUTO_VERIFY | PENDING |
| I4 | Uses existing ASIN matching service | AUTO_VERIFY | PENDING |
| I5 | Dual-write to Google Sheets | AUTO_VERIFY | PENDING |

**Total:** 39 criteria (39 AUTO_VERIFY, 0 HUMAN_VERIFY, 0 TOOL_VERIFY)

---

## Handoff

Ready for: `/build-feature purchase-inventory-skill`

**Key files to create:**
- `.claude/commands/purchase-inventory.md` (new) - Skill definition

**Key files likely affected:**
- None (skill uses existing services via API calls from Claude Code context)

**Services to reuse:**
- `PurchaseService.create()` - [purchase.service.ts](apps/web/src/lib/services/purchase.service.ts)
- `InventoryService.createMany()` - [inventory.service.ts](apps/web/src/lib/services/inventory.service.ts)
- `AsinMatchingService.matchMultiple()` - [asin-matching.service.ts](apps/web/src/lib/services/asin-matching.service.ts)
- `/api/brickset/search` - [route.ts](apps/web/src/app/api/brickset/search/route.ts)
- `/api/purchases` - [route.ts](apps/web/src/app/api/purchases/route.ts)
- `/api/inventory` - [route.ts](apps/web/src/app/api/inventory/route.ts)
