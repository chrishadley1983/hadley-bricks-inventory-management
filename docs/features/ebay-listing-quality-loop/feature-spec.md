# Feature Specification: eBay Listing Quality Loop

**Generated:** 2026-01-28
**Based on:** done-criteria.md (12 criteria)
**Status:** READY_FOR_BUILD

---

## 1. Summary

This feature transforms the eBay listing creation flow from a "post-then-review" model to a "review-then-post" model. After AI generates listing content, the system will:
1. Run quality review using Gemini 3 Pro (currently Step 9, moved to Step 5)
2. Auto-apply quality suggestions to improve title, description, and item specifics
3. Display an editable preview screen showing the complete listing with quality score
4. Only create the eBay listing after the user clicks "Post to eBay"

Additionally, the modal gains a storage location field with autocomplete from previously used values, which updates the inventory item upon successful listing.

---

## 2. Criteria Mapping

| Criterion | Implementation Approach |
|-----------|------------------------|
| F1: Pre-Publish Quality Review | Move quality review from Step 9 to Step 5, run BEFORE eBay API call |
| F2: Auto-Apply Suggestions | New `applySuggestions()` function in quality review service |
| F3: Listing Preview Screen | New preview step in modal (replaces immediate posting) |
| F4: Quality Score Display | Score badge component on preview with grade and breakdown |
| F5: Storage Location Field | Add input to Publish tab with autocomplete |
| F6: Storage Location Autocomplete | New API endpoint returning distinct locations |
| F7: Editable Preview Fields | Controlled inputs for title, description, condition on preview |
| E1: Quality Review Failure | Preview shows without score, user can still post |
| E2: Storage Location Update Failure | Log warning, don't fail listing creation |
| I1: Step Order Changed | Reorder steps: 5=Review, 6=Preview, 7=Images |
| I2: Audit Record Updates | Add `suggestions_applied` count to audit |
| P1: Review Under 30s | Add timeout to quality review call |

---

## 3. Architecture

### 3.1 Current vs New Flow

**Current Flow (9 steps):**
```
Validate → Research → Policies → Generate → Images → Create → Update → Audit → Review
                                                                              ↑
                                                                    (async, after response)
```

**New Flow (10 steps):**
```
Validate → Research → Policies → Generate → Review → Preview → Images → Create → Update → Audit
                                     ↑          ↑
                               (blocking)  (user confirm)
```

### 3.2 Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           CreateEbayListingModal                              │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │ Tabs: Pricing | Photos | Content | Publish                              │ │
│  │                                                                          │ │
│  │  Publish Tab (Modified):                                                 │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐    │ │
│  │  │ Storage Location: [___________________] ← Combobox w/ autocomplete  │ │
│  │  │                   Suggestions: Box A, Shelf 1, Drawer 3...          │ │
│  │  │                                                                      │ │
│  │  │ Postage Policy:   [Small Parcel ▼]                                  │ │
│  │  │ Listing Type:     ○ Live  ○ Scheduled                               │ │
│  │  └─────────────────────────────────────────────────────────────────┘    │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │ Preview Screen (NEW - after Step 5 completes):                         │ │
│  │                                                                          │ │
│  │  ┌──────────────────────────────────────────────────────────────────┐   │ │
│  │  │ Quality Score: [85/100 - B]  ← Color-coded badge                 │   │ │
│  │  │                                                                   │   │ │
│  │  │ Title: [LEGO Star Wars 75192 Millennium Falcon - 7541 Pieces] ✏️│   │ │
│  │  │                                                          79/80 chars │ │
│  │  │                                                                   │   │ │
│  │  │ Description:                                                      │   │ │
│  │  │ ┌────────────────────────────────────────────────────────────┐   │   │ │
│  │  │ │ <rendered HTML preview>                         [Edit] btn │   │   │ │
│  │  │ └────────────────────────────────────────────────────────────┘   │   │ │
│  │  │                                                                   │   │ │
│  │  │ Condition: [_____Excellent, complete with all pieces_____] ✏️   │   │ │
│  │  │                                                                   │   │ │
│  │  │ Item Specifics:                                                   │   │ │
│  │  │  Brand: LEGO | Theme: Star Wars | Set Number: 75192              │   │ │
│  │  │  MPN: 75192 | Piece Count: 7541 | Age Level: 16+                 │   │ │
│  │  │                                                                   │   │ │
│  │  │ Price: £649.99 | Best Offer: ✓ (Auto-accept: 95%, Decline: 75%)  │   │ │
│  │  │                                                                   │   │ │
│  │  │ Photos: [📷] [📷] [📷] [📷]                                      │   │ │
│  │  │                                                                   │   │ │
│  │  │ Score Breakdown: ▼ (expandable)                                   │   │ │
│  │  │  - Title: 23/25 - Good keywords                                   │   │ │
│  │  │  - Item Specifics: 18/20 - All required present                   │   │ │
│  │  │  - Description: 22/25 - Clear and detailed                        │   │ │
│  │  │  - Condition: 13/15 - Accurate                                    │   │ │
│  │  │  - SEO: 9/15 - Could add more search terms                        │   │ │
│  │  │                                                                   │   │ │
│  │  │ [Cancel]                                       [Post to eBay →]   │   │ │
│  │  └──────────────────────────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Data Flow

```
1. User clicks "Create Listing" in modal
                    ↓
2. POST /api/ebay/listing (SSE stream)
                    ↓
3. Steps 1-4: Validate → Research → Policies → Generate
                    ↓
4. Step 5: Quality Review (ListingQualityReviewService.reviewListing)
           └── Timeout: 30 seconds
           └── On failure: proceed with null review
                    ↓
5. Step 6: Auto-Apply Suggestions (ListingQualityReviewService.applySuggestions)
           └── Modifies: title, description, itemSpecifics
           └── Returns: appliedCount
                    ↓
6. SSE sends: { event: 'preview', data: { generatedContent, qualityReview, appliedCount } }
                    ↓
7. Modal shows Preview Screen (blocking - waits for user)
                    ↓
8. User edits fields (optional), clicks "Post to eBay"
                    ↓
9. POST /api/ebay/listing/confirm (new endpoint)
   └── Request: { auditId, finalTitle, finalDescription, finalConditionDescription, storageLocation }
                    ↓
10. Steps 7-10: Images → Create eBay → Update Inventory (+ storage_location) → Audit
                    ↓
11. SSE sends: { event: 'complete', data: { listingId, listingUrl, ... } }
```

### 3.4 Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Preview blocking | New SSE event type `preview` | Keeps single connection, natural pause |
| Storage autocomplete | Combobox (shadcn) | Allows typed input + suggestions |
| Edit fields | Controlled inputs in modal state | Edits sent with confirm request |
| Review timeout | 30 seconds | Balance between quality and UX |
| Suggestion application | Service method | Reusable, testable, logged |

---

## 4. File Changes

### 4.1 New Files

| File | Purpose | Est. Lines |
|------|---------|------------|
| `apps/web/src/app/api/inventory/storage-locations/route.ts` | Autocomplete endpoint | 30-40 |
| `apps/web/src/app/api/ebay/listing/confirm/route.ts` | Resume listing after preview | 60-80 |
| `apps/web/src/components/features/inventory/ListingPreviewScreen.tsx` | Preview UI component | 200-250 |

### 4.2 Modified Files

| File | Changes | Est. Lines Changed |
|------|---------|-------------------|
| `apps/web/src/lib/ebay/listing-creation.service.ts` | Reorder steps, add preview pause, pass storage location | 80-100 |
| `apps/web/src/lib/ebay/listing-quality-review.service.ts` | Add `applySuggestions()` method | 80-100 |
| `apps/web/src/lib/ebay/listing-creation.types.ts` | Add preview state types, storage location | 30-40 |
| `apps/web/src/components/features/inventory/CreateEbayListingModal.tsx` | Add storage field, preview state, edit handling | 150-200 |
| `apps/web/src/app/api/ebay/listing/route.ts` | Add storage location to validation, handle preview event | 30-40 |
| `apps/web/src/hooks/useCreateListing.ts` | Handle preview event type | 20-30 |

### 4.3 Database Changes

**None required** - `storage_location` column already exists on `inventory_items` table. Only need to add `suggestions_applied` to audit record.

Migration for audit column (optional, can use existing JSON field):
```sql
ALTER TABLE listing_creation_audit
ADD COLUMN suggestions_applied INTEGER DEFAULT 0;
```

---

## 5. Implementation Details

### 5.1 New API: GET /api/inventory/storage-locations

```typescript
// Returns distinct storage locations for autocomplete
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data } = await supabase
    .from('inventory_items')
    .select('storage_location')
    .eq('user_id', user.id)
    .not('storage_location', 'is', null)
    .limit(100);

  // Deduplicate and sort
  const locations = [...new Set(data?.map(d => d.storage_location))]
    .filter(Boolean)
    .sort();

  return NextResponse.json({ locations });
}
```

### 5.2 New API: POST /api/ebay/listing/confirm

```typescript
const ConfirmSchema = z.object({
  auditId: z.string().uuid(),
  finalTitle: z.string().max(80),
  finalDescription: z.string(),
  finalConditionDescription: z.string().nullable(),
  storageLocation: z.string().nullable(),
});

export async function POST(request: NextRequest) {
  // 1. Auth check
  // 2. Validate request
  // 3. Load audit record (contains all original data)
  // 4. Resume listing creation from Step 7 (Images)
  // 5. Use final* fields instead of generated ones
  // 6. Update storage_location on inventory item
  // 7. Stream remaining progress events
}
```

### 5.3 applySuggestions() Method

```typescript
// In listing-quality-review.service.ts
applySuggestions(
  content: AIGeneratedListing,
  review: QualityReviewResult
): { updated: AIGeneratedListing; appliedCount: number } {
  let appliedCount = 0;
  const updated = { ...content };

  // Parse suggestions for actionable items
  for (const suggestion of review.suggestions) {
    if (suggestion.includes('keyword') && suggestion.includes('title')) {
      // Extract suggested keyword, add to title if fits
      // appliedCount++;
    }
    if (suggestion.includes('item specific') && suggestion.includes('missing')) {
      // Add missing item specific
      // appliedCount++;
    }
    // ... more patterns
  }

  console.log(`[Quality Review] Applied ${appliedCount} suggestions`);
  return { updated, appliedCount };
}
```

### 5.4 Preview Event in SSE

```typescript
// In listing-creation.service.ts, after Step 6 (Auto-Apply)
progressCallback({
  type: 'preview',
  data: {
    generatedContent: updatedContent,
    qualityReview: reviewResult,
    suggestionsApplied: appliedCount,
  }
});

// Wait for confirmation (handled by API route)
// Service returns partial result, API waits for confirm call
```

### 5.5 Modal Preview State

```typescript
// In CreateEbayListingModal.tsx
const [showPreview, setShowPreview] = useState(false);
const [previewData, setPreviewData] = useState<PreviewData | null>(null);
const [editedTitle, setEditedTitle] = useState('');
const [editedDescription, setEditedDescription] = useState('');
const [editedCondition, setEditedCondition] = useState('');

// On preview event from SSE:
if (event.type === 'preview') {
  setPreviewData(event.data);
  setEditedTitle(event.data.generatedContent.title);
  setEditedDescription(event.data.generatedContent.description);
  setEditedCondition(event.data.generatedContent.conditionDescription || '');
  setShowPreview(true);
}

// On "Post to eBay" click:
const handleConfirm = async () => {
  await confirmListing({
    auditId: previewData.auditId,
    finalTitle: editedTitle,
    finalDescription: editedDescription,
    finalConditionDescription: editedCondition,
    storageLocation,
  });
};
```

### 5.6 Storage Location Combobox

```tsx
// On Publish tab
<div className="space-y-2">
  <Label>Storage Location (optional)</Label>
  <Combobox
    value={storageLocation}
    onValueChange={setStorageLocation}
    options={storageLocations.map(loc => ({ label: loc, value: loc }))}
    placeholder="e.g., Shelf A, Box 3"
    allowCustomValue={true}
  />
  <p className="text-xs text-muted-foreground">
    Where is this item stored? Will be updated on your inventory.
  </p>
</div>
```

---

## 6. Build Order

### Step 1: Storage Location (F5, F6, E2)
- Create `/api/inventory/storage-locations` endpoint
- Add Combobox to Publish tab in modal
- Add `storageLocation` to request payload
- Wire up autocomplete hook

### Step 2: Quality Review Refactor (F1, F2, I2, P1)
- Add `applySuggestions()` to quality review service
- Move quality review from Step 9 to Step 5 in service
- Add 30-second timeout
- Add `suggestions_applied` to audit record

### Step 3: Preview Screen (F3, F4, F7, E1)
- Create `ListingPreviewScreen` component
- Add score badge with color coding
- Add editable fields (title, description, condition)
- Add score breakdown (collapsible)
- Handle review failure gracefully

### Step 4: SSE Flow Changes (I1)
- Add `preview` event type to SSE
- Create `/api/ebay/listing/confirm` endpoint
- Update useCreateListing hook to handle preview
- Wire modal state to show preview, then confirm

### Step 5: Integration & Polish
- Test full flow end-to-end
- Handle edge cases (no photos, scheduled listings)
- Verify audit trail captures all data
- Test review failure handling

---

## 7. Risk Assessment

### Technical Risks

| Risk | Probability | Mitigation |
|------|-------------|------------|
| Review timeout causes bad UX | Medium | 30s timeout, show preview without score |
| Suggestion parsing unreliable | Medium | Conservative parsing, log what was applied |
| SSE connection drop mid-flow | Low | Store state in audit, allow retry |
| Edit fields lose formatting | Low | Use textarea, preserve line breaks |

### Scope Risks

| Risk | Mitigation |
|------|------------|
| Preview becomes too complex | Keep it simple - 3 editable fields only |
| Multiple review iterations requested | Out of scope - single iteration per criteria |
| Price editing requested | Out of scope - price set in modal upfront |

### Integration Risks

| Risk | Probability | Mitigation |
|------|-------------|------------|
| Existing scheduled listing flow breaks | Medium | Test scheduled flow specifically |
| Template selection ignored after preview | Low | Carry template through to confirm |

---

## 8. Feasibility Validation

| Criterion | Feasible | Confidence | Notes |
|-----------|----------|------------|-------|
| F1: Pre-Publish Review | ✅ Yes | High | Move step ordering in service |
| F2: Auto-Apply Suggestions | ✅ Yes | Medium | Suggestion parsing may be imperfect |
| F3: Preview Screen | ✅ Yes | High | Standard modal state change |
| F4: Quality Score Display | ✅ Yes | High | Badge component |
| F5: Storage Location Field | ✅ Yes | High | Column exists, simple input |
| F6: Storage Autocomplete | ✅ Yes | High | Distinct query, Combobox |
| F7: Editable Fields | ✅ Yes | High | Controlled inputs |
| E1: Review Failure Handling | ✅ Yes | High | Null check, proceed |
| E2: Storage Update Failure | ✅ Yes | High | Try/catch, log warning |
| I1: Step Order | ✅ Yes | High | Service refactor |
| I2: Audit Record | ✅ Yes | High | Add field or use JSON |
| P1: 30s Timeout | ✅ Yes | High | Promise.race with timeout |

**Overall:** All criteria feasible. F2 (suggestion parsing) has medium confidence due to unpredictable AI feedback format, but graceful degradation handles this.

---

## 9. Notes for Build Agent

1. **Start with storage location** - It's isolated and can be tested independently
2. **Test review timeout** - Simulate slow Gemini response to verify timeout works
3. **Keep preview simple** - Resist adding more editable fields beyond the three specified
4. **Log applied suggestions** - This helps debug if suggestions aren't being applied correctly
5. **Handle null review** - Preview must work even if quality review returns null
6. **Preserve original data** - Audit record should have both generated and final (edited) content
7. **Test scheduled listings** - They have slightly different flow, ensure preview works for both live and scheduled

---

## 10. Estimated Complexity

| Metric | Value |
|--------|-------|
| Total files to change | 9 (3 new, 6 modified) |
| Estimated lines of code | 700-900 |
| Database changes | 1 column (optional) |
| New API endpoints | 2 |
| New components | 1 |
| Risk level | Medium |
| Complexity rating | Medium |

---

**Status:** READY_FOR_BUILD

**Next step:** `/build-feature ebay-listing-quality-loop`
