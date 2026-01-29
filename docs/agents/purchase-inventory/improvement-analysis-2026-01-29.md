# Purchase Inventory Skill - Improvement Analysis

**Date**: 2026-01-29
**Session Duration**: ~45 minutes
**Items Processed**: 4 LEGO sets (40756, 40491, 40575, 40728)
**Outcome**: Successful (with manual correction needed for source)

---

## Executive Summary

The purchase-inventory skill successfully created 1 purchase and 4 inventory items, but the session revealed significant friction points that extended the process unnecessarily. Key issues include:

1. **Source misidentification** - Vinted receipt identified as eBay
2. **API authentication failures** - Direct curl/bash calls failed; required Playwright workaround
3. **Amazon API rate limiting** - 35-second waits between pricing calls
4. **Missing required questions** - Location not asked; notes format not defined
5. **Incomplete review table** - User requested all fields be shown
6. **Timestamp handling** - Initially used fabricated time instead of actual approval time

---

## Detailed Issue Analysis

### Issue 1: Source Misidentification (CRITICAL)

**What happened**: The receipt image showed Vinted's distinctive UI (red circle icon, "Bundle X items", "Package delivered" status), but I incorrectly identified it as eBay.

**Root cause**: The skill lacks a visual pattern library for common purchase platforms.

**Impact**: User had to manually correct the source after records were created.

**Recommended fix**:

Add a **Platform Visual Recognition Guide** section to the skill:

```markdown
## Platform Visual Recognition

### Vinted
- Red/coral circle icon with item image
- Format: "Bundle X items" or item name
- Price in format: "£XX.XX"
- Status: "Package delivered" or shipping status
- App-style receipt layout

### eBay
- Blue/multi-color eBay logo
- "Order details" or "Purchase history" header
- Seller name prominently displayed
- Item number format: 12-digit number
- "Paid" or payment status shown

### Facebook Marketplace
- Blue Facebook header
- Seller profile picture visible
- "Marked as sold" or similar status
- Chat-style interface elements

### Amazon
- Orange/black Amazon logo
- "Order placed" with date
- Order number format: XXX-XXXXXXX-XXXXXXX
- "Arriving" or delivery status
```

---

### Issue 2: API Authentication Failures (HIGH)

**What happened**: Direct API calls via `curl` returned `{"error":"Unauthorized"}` because:
- The Bash tool doesn't have access to browser session cookies
- The API routes require authenticated Supabase sessions

**Workaround used**: Playwright MCP to navigate to API endpoints through an authenticated browser session.

**Time wasted**: ~10 minutes troubleshooting

**Recommended fixes**:

#### Option A: Update skill to always use Playwright for API calls
```markdown
## API Access Method

**IMPORTANT**: All API calls MUST be made via Playwright browser automation, not direct HTTP requests.

The APIs require authenticated Supabase sessions. Use this pattern:

```javascript
// Via Playwright browser_evaluate
async () => {
  const response = await fetch('http://localhost:3000/api/endpoint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return response.json();
}
```
```

#### Option B: Create a dedicated skill API endpoint with API key auth
Create `/api/skill/purchase-inventory` that accepts an API key header for non-browser access.

---

### Issue 3: Amazon Competitive Pricing API Rate Limits (MEDIUM)

**What happened**: The Amazon SP-API `getCompetitiveSummary` endpoint has a rate limit of ~0.033 requests/second (one request per 30 seconds).

**Time wasted**: ~3 minutes of mandatory waiting (35 seconds × 4 ASINs, though first call succeeded without wait)

**Current behavior**: Sequential calls with 35-second delays between each.

**Recommended fixes**:

#### Option A: Batch API endpoint
Create a new endpoint that accepts multiple ASINs and handles the rate limiting internally:

```
GET /api/amazon/pricing/batch?asins=B0DTV6K5HC,B09CZKMVZW,B0BHRZ44L1,B0DJLTXMW4
```

The endpoint would:
1. Accept up to 20 ASINs
2. Make a single batch call to Amazon's batch API (if available)
3. Or queue and process with internal rate limiting
4. Return all results in one response

#### Option B: Cached pricing data
Create a pricing cache table that stores recent Amazon pricing:

```sql
CREATE TABLE amazon_pricing_cache (
  asin TEXT PRIMARY KEY,
  buy_box_price DECIMAL(10,2),
  lowest_offer_price DECIMAL(10,2),
  offer_count INTEGER,
  fetched_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);
```

The skill would:
1. Check cache first (TTL: 24 hours for pricing data)
2. Only call Amazon API for cache misses
3. Background job refreshes cache for active ASINs

#### Option C: Skill instruction to inform user of wait time
```markdown
**Amazon Pricing Lookup**

I need to fetch current buy box prices from Amazon for proportional cost allocation.

This will take approximately {N × 35} seconds due to Amazon API rate limits.

- Proceed with Amazon pricing lookup?
- Or use equal cost split instead?
```

---

### Issue 4: Missing Required Questions (HIGH)

**What happened**:
- **Location** was not asked - user had to specify "Loft- S1" after seeing the review table
- **Notes format** was not defined - user requested specific format "Created by Purchase Inventory Skill on {date} {time}"

**Recommended fix**:

Add to Required Fields section:

```markdown
## Required Fields

The following fields are REQUIRED and must be collected:
- **cost** - Total purchase cost in GBP (£)
- **source** - Where purchased (see Platform Visual Recognition)
- **payment_method** - How paid (PayPal, Bank Transfer, Cash, Credit Card, Debit Card)
- **purchase_date** - When purchased (YYYY-MM-DD format)
- **condition** - Item condition (New or Used)
- **set_numbers** - At least one LEGO set number (e.g., 75192, 10294)
- **listing_platform** - Where to list for sale (amazon, ebay, bricklink, brickowl)
- **location** - Storage location (e.g., "Loft- S1", "Garage- B2") ← NEW

## Auto-Populated Fields

The following fields are auto-populated and should NOT be asked:
- **notes** - Always set to: "Created by Purchase Inventory Skill on {YYYY-MM-DD HH:MM}"
  - Use the actual timestamp when user approves the insert (says "yes")
  - Do NOT fabricate or estimate timestamps
```

Add location question to interview phase:
```markdown
- **Location**: "Where will you store these items? (e.g., Loft- S1, Garage- B2)"
```

---

### Issue 5: Incomplete Review Table (MEDIUM)

**What happened**: User requested to see ALL fields that can be populated, including blank ones, so they could verify nothing was missing.

**Recommended fix**:

Update Phase 6 (Review Table) to show complete field list:

```markdown
### Phase 6: Review Table (Full Field View)

Display ALL fields for both record types, showing blanks explicitly:

**Purchase Record:**

| Field | Value |
|-------|-------|
| **purchase_date** | 2026-01-29 |
| **short_description** | eBay - 75192, 10294 |
| **cost** | £450.00 |
| **source** | eBay |
| **payment_method** | PayPal |
| notes | Created by Purchase Inventory Skill on 2026-01-29 14:45 |
| supplier_name | *blank* |
| supplier_contact | *blank* |
| invoice_number | *blank* |
| shipping_cost | *blank* |
| tax_amount | *blank* |

**Inventory Items:**

| Field | Item 1 | Item 2 | ... |
|-------|--------|--------|-----|
| **set_number** | 75192 | 75192 | |
| **item_name** | Millennium Falcon | Millennium Falcon | |
| **condition** | New | New | |
| **status** | BACKLOG | BACKLOG | |
| **source** | eBay | eBay | |
| **purchase_date** | 2026-01-29 | 2026-01-29 | |
| **cost** | £225.00 | £225.00 | |
| **listing_platform** | amazon | amazon | |
| **amazon_asin** | B075SDMMMV | B075SDMMMV | |
| **location** | Loft- S1 | Loft- S1 | |
| **notes** | Created by... | Created by... | |
| purchase_id | *auto-linked* | *auto-linked* | |
| sku | *auto-generated* | *auto-generated* | |
| quantity | *blank* | *blank* | |
| ebay_listing_id | *blank* | *blank* | |
| ... | | | |

Bold = populated, *blank* = not set, *auto-X* = system-generated
```

---

### Issue 6: Timestamp Handling (MEDIUM)

**What happened**: When showing the review table, I used a fabricated timestamp "14:32" instead of waiting for actual approval time. User correctly challenged this.

**Recommended fix**:

Add explicit instruction:

```markdown
## Timestamp Rules

1. **Never fabricate timestamps** - Do not guess or estimate times
2. **Capture on approval** - Record the actual time when user says "yes" to create
3. **Format**: Use 24-hour format: `YYYY-MM-DD HH:MM`
4. **In review table**: Show placeholder `{timestamp on approval}` until user confirms
5. **On creation**: Capture current time and use for notes field
```

---

### Issue 7: Cost Allocation - Proportional by Listing Value (NEW FEATURE)

**What happened**: User requested proportional cost allocation based on Amazon buy box prices, rounded down to nearest .99 or .49.

**Current skill**: Only offers equal split or custom manual entry.

**Recommended addition**:

```markdown
## Cost Allocation

When creating inventory items, calculate cost per item:

### Option 1: Equal Split
Total cost / number of items

### Option 2: Custom
User specifies cost for each item manually

### Option 3: Proportional by Listing Value (Amazon only)
When listing_platform is "amazon":

1. Fetch buy box price for each ASIN via Amazon Competitive Summary API
2. Round each price DOWN to nearest .99 or .49:
   - £38.98 → £38.49
   - £27.99 → £27.49
   - £23.99 → £23.49
   - £21.96 → £21.49
3. Calculate proportion: item_list_value / total_list_value
4. Allocate: proportion × total_purchase_cost
5. Show allocation table for approval:

| Set | ASIN | Buy Box | Rounded | Proportion | Allocated Cost |
|-----|------|---------|---------|------------|----------------|
| 40756 | B0DTV6K5HC | £38.98 | £38.49 | 34.69% | £11.04 |
| 40491 | B09CZKMVZW | £27.99 | £27.49 | 24.77% | £7.89 |
| ... | | | | | |

**Note**: This requires ~35 seconds per ASIN due to Amazon API rate limits.
```

---

### Issue 8: Incorrect Payment Method Values (HIGH)

**What happened**: The skill uses generic payment methods ("Debit Card", "Credit Card") instead of the actual values from the system dropdown. I entered "Debit Card" when I should have used "Card".

**System dropdown values**:
- Cash
- Card
- PayPal
- Bank Transfer
- HSBC - Cash
- Monzo - Card

**Recommended fix**:

Update the skill's Payment Methods section:

```markdown
## Payment Methods

**Use ONLY these exact values from the system dropdown:**
- Cash
- Card
- PayPal
- Bank Transfer
- HSBC - Cash
- Monzo - Card

**IMPORTANT**:
- Do NOT use "Debit Card" or "Credit Card" → use "Card"
- Do NOT use "Monzo" alone → use "Monzo - Card"
- Do NOT use "HSBC" alone → use "HSBC - Cash"
```

---

### Issue 9: Missing Mileage/Collection Question (MEDIUM)

**What happened**: The purchase form has a "Collection & Mileage" section for tracking travel costs, but the skill never asked about this.

**Impact**: For collection purchases (FB Marketplace, Car Boot, etc.), mileage is a real cost that affects profit calculations.

**Recommended fix**:

Add to interview phase when source is a collection-type:

```markdown
## Collection Sources (require mileage question)

If source is one of:
- Facebook Marketplace
- Car Boot
- Charity Shop
- Other (with collection)

Ask:
**Collection & Mileage**: "Did you collect this in person? If yes, what was the round-trip mileage? (Enter 0 if posted/delivered)"

If mileage > 0, calculate travel cost:
- HMRC rate: 45p/mile for first 10,000 miles
- Add to purchase record as mileage expense
```

---

### Issue 10: Stock Photos Not Attached (HIGH)

**What happened**: User provided a photo of the LEGO sets, but the skill did not attach it to the purchase record. The "Photos & Receipts" section remained empty.

**Impact**: Lose visual record of items purchased; harder to verify condition/contents later.

**Recommended fix**:

Add photo attachment step after record creation:

```markdown
## Phase 9: Photo Attachment (if photos provided)

If user provided photos during input:

1. After successful record creation, upload photos to purchase record
2. Use the purchase photos API:

```javascript
// Upload photo to purchase
const formData = new FormData();
formData.append('file', photoBlob);

POST /api/purchases/{purchase_id}/photos
Content-Type: multipart/form-data
```

3. Confirm attachment:
```
**Photos Attached**
- {N} photo(s) attached to purchase record
- View at: /purchases/{purchase_id}
```

**Photo types to attach:**
- Receipt images → attach to purchase
- Stock/set photos → attach to purchase (for reference)
- Individual item photos → could attach to inventory items if feature exists
```

---

### Issue 11: Playwright Browser Lock (TOOLING)

**What happened**: Playwright MCP showed "Browser is already in use" errors. Required multiple attempts to close/reset.

**Workaround**: Force-closed Chrome processes via PowerShell, removed lock files.

**Recommended fix**: This is a tooling issue outside the skill itself, but add a note:

```markdown
## Troubleshooting

### Playwright "Browser already in use" error

If Playwright fails with browser lock errors:

1. The skill should attempt `mcp__playwright__browser_close` first
2. If that fails, inform user to close Chrome manually
3. As last resort, use: `powershell "Stop-Process -Name chrome -Force -EA 0"`
```

---

## Priority Matrix

| Issue | Severity | Effort | Priority |
|-------|----------|--------|----------|
| 1. Source misidentification | Critical | Low | **P1** |
| 4. Missing location question | High | Low | **P1** |
| 8. Incorrect payment method values | High | Low | **P1** |
| 10. Stock photos not attached | High | Medium | **P1** |
| 2. API authentication | High | Medium | **P2** |
| 5. Incomplete review table | Medium | Low | **P2** |
| 6. Timestamp handling | Medium | Low | **P2** |
| 9. Missing mileage/collection question | Medium | Low | **P2** |
| 7. Proportional cost allocation | Medium | High | **P3** |
| 3. Amazon API rate limits | Medium | High | **P3** |
| 11. Playwright browser lock | Low | N/A | **P4** |

---

## Recommended Skill Updates

### Immediate (P1) - Add to current skill file

1. Add **Platform Visual Recognition** section with Vinted, eBay, FB Marketplace, Amazon patterns
2. Add **location** to required fields and interview questions
3. Add **notes auto-population** rule with timestamp-on-approval
4. Update **payment methods** to use exact system dropdown values (Card, not Debit Card)
5. Add **photo attachment** phase to upload provided photos to purchase record

### Short-term (P2) - Next iteration

6. Update API access instructions to use Playwright
7. Expand review table to show all fields
8. Add explicit timestamp handling rules
9. Add **mileage/collection question** for FB Marketplace, Car Boot, etc.

### Medium-term (P3) - Future enhancement

7. Add proportional cost allocation option with Amazon pricing
8. Create batch pricing endpoint or caching layer

---

## Session Metrics

| Metric | Value |
|--------|-------|
| Total messages exchanged | ~35 |
| API calls made | 8 (4 pricing + 1 purchase + 1 inventory batch + 2 DB lookups) |
| Time spent on rate limit waits | ~105 seconds |
| Time spent on troubleshooting | ~10 minutes |
| Manual corrections needed | 1 (source: eBay → Vinted) |
| Records created successfully | 5 (1 purchase + 4 inventory) |

---

## Appendix: Full Session Flow

1. User invoked `/purchase-inventory` with 2 images (receipt + sets photo)
2. Skill analysed images, identified sets (40756, 40491, 40575, 40728)
3. **ERROR**: Misidentified source as eBay (was Vinted)
4. Asked for: payment method, condition, listing platform, creation mode
5. User selected: Card, New, amazon, 1:X mode
6. Skill attempted API calls via curl → **FAILED** (Unauthorized)
7. Attempted Playwright → **FAILED** (browser lock)
8. Fixed browser lock, successfully connected
9. Fetched Amazon pricing for 4 ASINs (with 35s waits)
10. Calculated proportional costs
11. User requested full field view in review table
12. User requested location field → added "Loft- S1"
13. User requested notes format → added timestamp pattern
14. User challenged fabricated timestamp → corrected approach
15. User approved → records created successfully
16. User noticed source error → will fix manually
17. User requested this improvement analysis

---

*Document generated: 2026-01-29*
