# User Journey: eBay Listing Creation

> **Journey:** Create AI-powered eBay listings from inventory items
> **Entry Point:** `/inventory/[id]` → "List on eBay" or `/listing-assistant`
> **Complexity:** High

## Overview

The Listing Creation journey enables users to create professional eBay listings from inventory items using a 9-step AI-powered process. It includes product research via Brickset API, AI content generation with Claude, image upload, and quality review with Gemini.

## User Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│              Listing Assistant - Create eBay Listing                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Step 1: Select Inventory Item                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ [Search inventory...]                                       │   │
│  │                                                             │   │
│  │ ○ 75192 Millennium Falcon - New Sealed     £0    A-01      │   │
│  │ ● 10281 Bonsai Tree - Used Complete        £35   B-03      │   │
│  │ ○ 42141 McLaren F1 - New Sealed            £120  C-12      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Step 2: Set Price and Options                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Price: £ [45.99]                                            │   │
│  │                                                             │   │
│  │ ☑ Enable Best Offer                                         │   │
│  │   Auto Accept: [95]% (£43.69)                               │   │
│  │   Auto Decline: [80]% (£36.79)                              │   │
│  │                                                             │   │
│  │ Listing Type: ● Publish Now  ○ Scheduled                    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Step 3: Add Photos                                                 │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ [+] [📷] [📷] [📷] [📷]                                     │   │
│  │                                                             │   │
│  │ Drag photos here or click to upload                         │   │
│  │ (Max 12 photos, JPG/PNG, max 12MB each)                     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Step 4: Description Style                                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ ● Professional (Recommended)                                │   │
│  │ ○ Friendly                                                  │   │
│  │ ○ Detailed                                                  │   │
│  │ ○ Concise                                                   │   │
│  │                                                             │   │
│  │ Template: [Default LEGO Used ▼]                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                              [Cancel]  [Create Listing]             │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Concepts

### 9-Step Creation Process

| Step | Name | Duration | Description |
|------|------|----------|-------------|
| 1 | Validate | ~200ms | Check inventory item eligibility |
| 2 | Research | ~500ms | Query Brickset API for product data |
| 3 | Policies | ~300ms | Get eBay business policies |
| 4 | Generate | ~3-5s | AI content generation (Claude) |
| 5 | Images | ~2-5s | Upload and process images |
| 6 | Create | ~1-2s | eBay API calls (item, offer, publish) |
| 7 | Update | ~200ms | Mark inventory as Listed |
| 8 | Audit | ~100ms | Record audit trail |
| 9 | Review | ~5-10s | Quality review (Gemini, async) |

### AI Models Used

| Model | Purpose |
|-------|---------|
| Claude Opus 4.5 | Listing content generation (title, description, specifics) |
| Claude Sonnet | Research data fallback when Brickset unavailable |
| Gemini 3 Pro | Quality review (runs asynchronously) |

### Condition Mapping

| Inventory Condition | eBay Condition ID | eBay Display |
|---------------------|-------------------|--------------|
| New, Sealed, Brand New | 1000 | New |
| Everything else | 3000 | Used |

---

## Steps

### 1. Select Inventory Item

**Action:** Choose an unlisted inventory item

**Eligibility Requirements:**
- Item must not have `ebay_listing_id` set
- Item status must not be "SOLD"
- Item must have a valid set number

**What's Shown:**
- Set number and name
- Condition
- Cost price
- Storage location
- Current status

### 2. Configure Listing Options

**Action:** Set price and listing parameters

**Options:**
| Field | Description | Default |
|-------|-------------|---------|
| Price | Listing buy-it-now price | Suggested based on market |
| Best Offer | Enable/disable offers | Enabled |
| Auto Accept % | Auto-accept threshold | 95% |
| Auto Decline % | Auto-decline threshold | 80% |
| Listing Type | Publish Now or Scheduled | Publish Now |
| Scheduled Date | Date/time for scheduled | - |

### 3. Upload Photos

**Action:** Add product photos

**Requirements:**
- Minimum: 1 photo
- Maximum: 12 photos
- Formats: JPG, PNG
- Max size: 12MB per image
- First photo becomes gallery image

**Photo Processing:**
1. Client-side compression if needed
2. Upload to Supabase storage
3. Get public URLs for eBay

### 4. Select Description Style

**Action:** Choose AI generation style

**Styles:**
| Style | Description |
|-------|-------------|
| Professional | Formal, business-like tone |
| Friendly | Warm, conversational tone |
| Detailed | Extra technical information |
| Concise | Brief, to-the-point |

**Templates:**
- LEGO New - For sealed items
- LEGO Used - For open/complete items
- General - For non-LEGO items
- Custom - User-defined templates

### 5. Create Listing

**Action:** Click "Create Listing" button

**Progress Display:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  Creating eBay Listing                                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ■■■■■■■■■■■■■■■■□□□□□□□□ 65%                                       │
│                                                                     │
│  Step 4 of 8: Generating listing content...                         │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ ✓ Validating inventory data                                 │   │
│  │ ✓ Researching product details                               │   │
│  │ ✓ Retrieving eBay policies                                  │   │
│  │ ● Generating listing content...                             │   │
│  │ ○ Processing and uploading images                           │   │
│  │ ○ Creating eBay listing                                     │   │
│  │ ○ Updating inventory                                        │   │
│  │ ○ Recording audit trail                                     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 6. View Results

**Success State:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  ✓ Listing Created Successfully                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Title: LEGO 10281 Bonsai Tree - Complete with Box & Instructions  │
│  Price: £45.99                                                      │
│  Item ID: 123456789012                                              │
│                                                                     │
│  [View on eBay]  [Create Another]  [Close]                         │
│                                                                     │
│  ────────────────────────────────────────────────────────────────   │
│                                                                     │
│  Quality Review (pending...)                                        │
│  AI review running in background. Check Listing Optimiser for      │
│  improvement suggestions.                                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## AI Content Generation

### Generated Content

| Field | Description |
|-------|-------------|
| Title | 80-char optimised title with keywords |
| Description | HTML description from template |
| Category ID | eBay leaf category |
| Item Specifics | Required and recommended aspects |
| Condition Description | Detailed condition notes |
| Confidence Score | AI confidence (0-100) |
| Recommendations | Improvement suggestions |

### Item Specifics Generated

| Specific | Example |
|----------|---------|
| Brand | LEGO |
| Set Number | 10281 |
| Theme | Creator Expert |
| Piece Count | 878 |
| Age Level | 18+ |
| Features | Botanical Collection |
| Year Released | 2021 |
| Country/Region of Manufacture | Denmark |

### Research Data Sources

1. **Brickset API** (primary)
   - Set name, theme, subtheme
   - Piece count, minifig count
   - Year released, retired status
   - Age range, dimensions

2. **Claude AI** (fallback)
   - When Brickset unavailable
   - Fills missing data fields
   - Lower confidence score

---

## Technical Details

### API Endpoint

```
POST /api/listing-creation

Headers:
  Content-Type: application/json

Body:
{
  "inventoryItemId": "uuid",
  "price": 45.99,
  "bestOffer": {
    "enabled": true,
    "autoAcceptPercent": 95,
    "autoDeclinePercent": 80
  },
  "photos": [
    { "id": "uuid", "base64": "...", "mimeType": "image/jpeg", "filename": "photo1.jpg" }
  ],
  "enhancePhotos": false,
  "descriptionStyle": "professional",
  "templateId": "uuid" | null,
  "listingType": "immediate" | "scheduled",
  "scheduledDate": "2026-01-20T10:00:00Z" | null,
  "policyOverrides": {
    "fulfillmentPolicyId": "uuid" | null,
    "paymentPolicyId": "uuid" | null,
    "returnPolicyId": "uuid" | null
  },
  "conditionDescriptionOverride": "..." | null
}

Response (SSE stream):
event: progress
data: {"currentStep": 4, "totalSteps": 8, "percentage": 50, "stepName": "Generating listing content"}

event: complete
data: {"success": true, "listingId": "123456789012", "listingUrl": "https://..."}
```

### eBay API Calls Made

1. **Create Inventory Item**
   - Endpoint: `PUT /sell/inventory/v1/inventory_item/{sku}`
   - Creates product with title, description, images, aspects

2. **Create Offer**
   - Endpoint: `POST /sell/inventory/v1/offer`
   - Creates offer with price, policies, category

3. **Publish Offer**
   - Endpoint: `POST /sell/inventory/v1/offer/{offerId}/publish`
   - Publishes to eBay marketplace

### Audit Trail

```sql
INSERT INTO listing_creation_audit (
  user_id,
  inventory_item_id,
  ebay_listing_id,
  action,
  status,
  listing_price,
  description_style,
  template_id,
  generated_title,
  generated_description,
  item_specifics,
  category_id,
  ai_model_used,
  ai_confidence_score,
  ai_recommendations,
  quality_score,
  quality_feedback,
  completed_at
) VALUES (...);
```

---

## Error Handling

### Validation Errors

```
┌─────────────────────────────────────────────────────────────────────┐
│  ❌ Cannot Create Listing                                           │
│                                                                     │
│  • Item already has an eBay listing                                │
│  • Cannot create listing for sold item                             │
│                                                                     │
│                                                    [Close]          │
└─────────────────────────────────────────────────────────────────────┘
```

### Image Upload Failed

```
┌─────────────────────────────────────────────────────────────────────┐
│  ❌ Image Upload Failed                                             │
│                                                                     │
│  Failed to upload images. Please try again with smaller files      │
│  or fewer images.                                                   │
│                                                                     │
│                                                    [Retry]          │
└─────────────────────────────────────────────────────────────────────┘
```

### eBay API Error

```
┌─────────────────────────────────────────────────────────────────────┐
│  ❌ Listing Creation Failed                                         │
│                                                                     │
│  eBay rejected the listing: "Category 19006 requires item specific │
│  'Piece Count' to be provided."                                    │
│                                                                     │
│  Draft saved for recovery.                                          │
│                                                                     │
│                              [View Draft]  [Close]                  │
└─────────────────────────────────────────────────────────────────────┘
```

### Draft Recovery

Failed listings save a draft for recovery:

```typescript
interface ListingDraft {
  id: string;
  user_id: string;
  inventory_item_id: string;
  draft_data: {
    price: number;
    bestOffer: BestOfferConfig;
    photos: PhotoMeta[];
    descriptionStyle: string;
    templateId?: string;
    listingType: string;
    scheduledDate?: string;
  };
  error_context: {
    error: string;
    failedStep: string;
    timestamp: string;
  };
  created_at: string;
}
```

---

## Source Files

| File | Purpose |
|------|---------|
| [listing-creation.service.ts](apps/web/src/lib/ebay/listing-creation.service.ts) | Main orchestration service |
| [listing-generation.service.ts](apps/web/src/lib/ebay/listing-generation.service.ts) | AI content generation |
| [listing-quality-review.service.ts](apps/web/src/lib/ebay/listing-quality-review.service.ts) | Gemini quality review |
| [ebay-image-upload.service.ts](apps/web/src/lib/ebay/ebay-image-upload.service.ts) | Image upload handling |
| [ebay-business-policies.service.ts](apps/web/src/lib/ebay/ebay-business-policies.service.ts) | Policy retrieval |
| [generate-listing.ts](apps/web/src/lib/ai/prompts/generate-listing.ts) | AI prompt templates |

## Related Journeys

- [eBay Authentication](./ebay-authentication.md) - Required connection
- [eBay Stock Management](./ebay-stock-management.md) - View created listings
- [Listing Optimiser](./listing-optimiser.md) - Improve listings after creation
- [Inventory Management](../inventory/inventory-management.md) - Source items
