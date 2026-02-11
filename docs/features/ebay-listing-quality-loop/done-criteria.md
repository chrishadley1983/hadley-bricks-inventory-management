# Done Criteria: eBay Listing Quality Loop

## Feature Overview

**Name:** ebay-listing-quality-loop
**Created:** 2026-01-28
**Status:** Draft

### Problem Statement

Currently, eBay listings are created and posted immediately, with quality review happening **after** the listing is live. This results in suboptimal listings being published. Users want to review and refine listings **before** they go live, with AI suggestions automatically applied.

### User Story

As a LEGO reseller, I want the system to review and improve my listing quality before posting to eBay, and show me the final listing for approval, so that I can ensure high-quality listings without manual effort.

### Success Outcome

- Listings are reviewed and improved **before** posting to eBay
- User sees a preview of the complete listing with edit capability
- Storage location can be set during listing creation
- Quality score is shown before posting

---

## Scope

### In Scope

1. Pre-publish quality review (single iteration)
2. Auto-apply review suggestions to listing content
3. Editable listing preview before posting
4. Storage location field with autocomplete
5. Display final quality score before publish

### Out of Scope

- Multiple review iterations (future enhancement)
- Manual suggestion selection (auto-apply only)
- Bulk listing creation
- Image quality review
- Price optimization suggestions

---

## Done Criteria

### Functional Requirements

#### F1: Pre-Publish Quality Review
`AUTO_VERIFY`

**Criterion:** After content generation (Step 4), the system runs quality review BEFORE creating the eBay listing (Step 6).

**Evidence:**
- Quality review executes between generate and create steps
- Review results available before eBay API is called
- Logs show: `[Quality Review] Running pre-publish review...`

---

#### F2: Auto-Apply Suggestions
`AUTO_VERIFY`

**Criterion:** The system automatically applies quality review suggestions to improve title, description, and item specifics.

**Evidence:**
- Generated content is modified based on review feedback
- Title updated if review suggests keyword additions
- Description updated if review suggests missing information
- Item specifics populated if review identifies missing fields
- Logs show: `[Quality Review] Applied N suggestions`

---

#### F3: Listing Preview Screen
`AUTO_VERIFY`

**Criterion:** Before posting, user sees a preview screen showing the complete listing with all fields editable.

**Evidence:**
- New preview step visible in progress UI
- Preview displays: title, description (rendered HTML), item specifics, photos, price, condition
- All text fields are editable
- "Post to eBay" button only appears after preview
- Preview step appears after quality review, before "Creating eBay listing"

---

#### F4: Quality Score Display
`AUTO_VERIFY`

**Criterion:** The preview screen displays the quality score (0-100) and grade (A-F) prominently.

**Evidence:**
- Score badge visible on preview screen
- Grade letter (A+, A, B, C, D, F) displayed
- Score breakdown available (title, specifics, description, condition, SEO)
- Color coding: green (85+), yellow (70-84), red (<70)

---

#### F5: Storage Location Field
`AUTO_VERIFY`

**Criterion:** The listing creation modal includes a storage location field that updates the inventory item.

**Evidence:**
- Storage location input visible in modal (on Publish tab)
- Field has autocomplete from previously used locations
- On successful listing creation, inventory_items.storage_location is updated
- Autocomplete queries distinct storage_location values from user's inventory

---

#### F6: Storage Location Autocomplete
`AUTO_VERIFY`

**Criterion:** The storage location field suggests previously used locations as user types.

**Evidence:**
- Typing triggers autocomplete dropdown
- Suggestions filtered by user input
- Selecting suggestion populates field
- User can still type custom value not in suggestions

---

#### F7: Editable Preview Fields
`AUTO_VERIFY`

**Criterion:** User can edit title, description, and condition description on the preview screen.

**Evidence:**
- Title field is editable (with character counter, max 80)
- Description field is editable (textarea or rich editor)
- Condition description is editable
- Changes persist when "Post to eBay" is clicked
- Edited values used in eBay API call (not original generated values)

---

### Error Handling

#### E1: Quality Review Failure
`AUTO_VERIFY`

**Criterion:** If quality review fails (API error, timeout), the system shows the preview without a score and allows user to proceed.

**Evidence:**
- Preview still displays on review failure
- Message shown: "Quality review unavailable - please review manually"
- "Post to eBay" button still enabled
- Error logged: `[Quality Review] Failed: {error}`

---

#### E2: Storage Location Update Failure
`AUTO_VERIFY`

**Criterion:** If storage location update fails after listing creation, the listing still succeeds and error is logged.

**Evidence:**
- eBay listing creation not blocked by storage update failure
- Warning shown to user: "Listing created but storage location update failed"
- Error logged with inventory item ID

---

### Integration

#### I1: Step Order Changed
`AUTO_VERIFY`

**Criterion:** The listing creation steps are reordered to: Validate → Research → Policies → Generate → **Review** → **Preview** → Images → Create → Update → Audit

**Evidence:**
- Progress UI shows 10 steps (was 9)
- Step 5 is "Reviewing quality"
- Step 6 is "Preview & confirm" (blocks until user clicks Post)
- Images upload happens after user confirms (Step 7)

---

#### I2: Audit Record Includes Review Data
`AUTO_VERIFY`

**Criterion:** The listing_creation_audit record includes pre-publish quality review results.

**Evidence:**
- `quality_score` populated before listing creation
- `quality_feedback` JSON contains breakdown
- `ai_recommendations` includes applied suggestions
- New field `suggestions_applied` (integer count)

---

### Performance

#### P1: Review Does Not Block Excessively
`AUTO_VERIFY`

**Criterion:** Quality review completes within 30 seconds.

**Evidence:**
- Timer in logs shows review duration < 30s
- If review exceeds 30s, timeout and proceed without score

---

---

## Technical Notes

### Modified Files (Expected)

1. `listing-creation.service.ts` - Reorder steps, add preview pause
2. `listing-quality-review.service.ts` - Add suggestion application logic
3. `CreateEbayListingModal.tsx` - Add storage field, preview screen
4. `listing-creation.types.ts` - Add preview state types
5. `/api/ebay/listing/route.ts` - Handle preview confirmation
6. New: `/api/inventory/storage-locations/route.ts` - Autocomplete endpoint

### New API Endpoints

- `GET /api/inventory/storage-locations` - Returns distinct storage locations for autocomplete

### UI Changes

- New preview step in modal after quality review
- Storage location field on Publish tab with autocomplete
- Quality score badge on preview
- Editable fields on preview

---

## Iteration Budget

**Maximum Iterations:** 5

This feature involves multiple interconnected changes. The Build Feature Agent should:
1. Implement storage location field first (simpler, isolated)
2. Add quality review to pre-publish flow
3. Add preview screen with edit capability
4. Wire up the full flow

---

## Verification Checklist

For Verify Done Agent:

- [ ] F1: Check logs for pre-publish review execution
- [ ] F2: Compare generated vs final content for applied suggestions
- [ ] F3: Visually confirm preview screen exists (or DOM check)
- [ ] F4: Check score display on preview
- [ ] F5: Check storage location field exists and updates DB
- [ ] F6: Test autocomplete functionality
- [ ] F7: Edit fields and verify edits used in API call
- [ ] E1: Simulate review failure, verify preview still shows
- [ ] E2: Simulate storage update failure, verify listing succeeds
- [ ] I1: Verify step order in progress UI
- [ ] I2: Check audit record schema
- [ ] P1: Measure review duration
