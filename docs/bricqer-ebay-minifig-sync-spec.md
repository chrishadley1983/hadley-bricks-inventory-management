# Feature Specification: Bricqer → eBay Minifigure Sync

## Overview

Automated pipeline to identify used LEGO minifigures in Bricqer inventory, research eBay market data, create optimised eBay listings with high-quality images, and keep both platforms in sync when sales occur — all managed through Hadley Bricks, bypassing Bricqer's native eBay integration entirely (avoiding the 3.5% fee).

## Architecture Principles

- **Bricqer = inventory source only** — queried for minifig data, updated on eBay sales
- **eBay = managed entirely by Hadley Bricks** — listings created, monitored, and ended via direct API calls
- **Hadley Bricks = orchestrator** — owns the mapping table, sync logic, and all automation
- **Staging before publishing** — all listings land in a review queue before going live
- **SKU prefix `HB-MF-`** — all minifig listings use this prefix so Bricqer never touches them

---

## Phase 1: Inventory Discovery

### 1.1 Pull Used Minifigures from Bricqer

**Endpoint:** `GET https://hadleybricks.bricqer.com/api/v1/inventory/`

**Filters required:**
- Category: Minifigures
- Condition: Used
- Status: Available (not already in an order)
- Bricqer listed price: ≥ £3.00 (skip low-value figs not worth dual-listing)

**Data to extract per minifigure:**
- `bricqer_item_id` — unique inventory item identifier
- `bricklink_id` — e.g. `sw0001a` (BrickLink minifig catalogue ID)
- `name` — minifigure name/description
- `condition_notes` — any seller notes on condition
- `bricqer_price` — current listed price on Bricqer
- `quantity` — should be 1 per used fig, but verify
- `color` / `variant` — if available
- `image_url` — Bricqer's stored image (if any)

**CC Verification Tasks:**
1. Run `OPTIONS https://hadleybricks.bricqer.com/api/v1/inventory/` with API key to confirm available filters and response schema
2. Confirm how minifigures are categorised (category ID, item type, or tag)
3. Confirm condition field values (used vs new distinction)
4. Check pagination — if >100 minifigs, confirm offset/cursor pagination support

### 1.2 Database: Minifigure Sync Table

```sql
CREATE TABLE IF NOT EXISTS minifig_sync_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Bricqer source
  bricqer_item_id VARCHAR(100) NOT NULL UNIQUE,
  bricklink_id VARCHAR(50),
  name TEXT NOT NULL,
  condition_notes TEXT,
  bricqer_price DECIMAL(10,2),
  bricqer_image_url TEXT,
  
  -- eBay market research
  ebay_avg_sold_price DECIMAL(10,2),
  ebay_min_sold_price DECIMAL(10,2),
  ebay_max_sold_price DECIMAL(10,2),
  ebay_sold_count INTEGER,
  ebay_active_count INTEGER,
  ebay_sell_through_rate DECIMAL(5,2), -- percentage
  ebay_avg_shipping DECIMAL(10,2),
  ebay_research_date TIMESTAMP,
  
  -- Listing decision
  meets_threshold BOOLEAN DEFAULT FALSE,
  recommended_price DECIMAL(10,2),
  
  -- eBay listing (once created)
  ebay_sku VARCHAR(50), -- HB-MF-{bricqer_item_id}
  ebay_inventory_item_id VARCHAR(100),
  ebay_offer_id VARCHAR(100),
  ebay_listing_id VARCHAR(50),
  ebay_listing_url TEXT,
  listing_status VARCHAR(30) DEFAULT 'NOT_LISTED',
    -- NOT_LISTED, STAGED, REVIEWING, PUBLISHED,
    -- SOLD_EBAY_PENDING_REMOVAL, SOLD_EBAY,
    -- SOLD_BRICQER_PENDING_REMOVAL, SOLD_BRICQER,
    -- ENDED
  
  -- Images
  images JSONB DEFAULT '[]', -- array of {source, url, type: "stock"|"sourced"|"original"}
  
  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_synced_at TIMESTAMP
);

CREATE INDEX idx_minifig_sync_bricqer ON minifig_sync_items(bricqer_item_id);
CREATE INDEX idx_minifig_sync_ebay ON minifig_sync_items(ebay_listing_id);
CREATE INDEX idx_minifig_sync_status ON minifig_sync_items(listing_status);
CREATE INDEX idx_minifig_sync_sku ON minifig_sync_items(ebay_sku);
CREATE INDEX idx_minifig_sync_bricklink ON minifig_sync_items(bricklink_id);
```

---

## Phase 2: eBay Market Research

### 2.1 Pricing Data Collection

Since the eBay Browse API and Finding API are both deprecated for sold listing data, pricing research uses **Terapeak as the primary source**, accessed via Playwright.

#### Primary Source: Terapeak (via Playwright)

Use Playwright running in headless mode, authenticated with eBay session cookies, to access Terapeak Research at `https://www.ebay.co.uk/sh/research`.

**Search settings per minifigure:**
1. Navigate to Terapeak Research
2. Enter search: `LEGO {minifig_name} {bricklink_id}`
3. Apply filters:
   - **Condition:** Used
   - **Buying format:** All (captures both Buy It Now and Auction)
   - **Item type:** Sold items
4. Extract from results:
   - Sold price (Terapeak shows actual Best Offer Accepted prices — this is its key advantage)
   - Sale date
   - Shipping cost
   - Number sold
   - Total listings (for sell-through calculation)
5. Calculate:
   - Average sold price (last 90 days)
   - Min/max sold price
   - Sell-through rate: `sold_count / (sold_count + active_count)`
   - Average shipping cost

**Terapeak implementation notes:**
- Run via CLI: `npx playwright` or as a Node.js script called from Next.js API route
- Store eBay session cookies in encrypted credentials (same pattern as other platform auth)
- Rate limit: 3-5 second delay between searches (Terapeak is slower to load than search pages)
- Terapeak provides true Best Offer Accepted prices, solving the strikethrough problem entirely
- Free with any eBay Store subscription (which you already have)

#### Supplementary Source: BrickLink Price Guide API

**Endpoint:** `GET /price_guide/MINIFIG/{bricklink_id}?guide_type=sold&new_or_used=U`

Returns last 6 months of BrickLink sold data:
- Average sold price
- Min/max
- Quantity sold
- Number of lots

Use as a cross-reference and fallback when Terapeak scraping fails or returns insufficient data.

**Note:** BrickLink prices tend to be lower than eBay for common figs but higher for rare ones. The pricing algorithm should weight Terapeak/eBay data more heavily since that's the target platform.

#### Fallback Source: eBay Sold Listings Scraping (via Playwright)

If Terapeak is unavailable or returns no results, fall back to scraping eBay sold listings directly:

Navigate to `https://www.ebay.co.uk/sch/i.html` with params:
- `_nkw` = minifigure name + "LEGO minifigure"
- `LH_Sold=1`, `LH_Complete=1`
- `_sop=13` (sort by end date: recent first)

**Limitation:** Cannot capture actual Best Offer Accepted prices (shows strikethrough instead). Use only as fallback.

### 2.2 Pricing Cache

All pricing research is cached for **6 months** to avoid redundant lookups. A minifigure's market data is only refreshed if the cache has expired or a manual refresh is triggered.

```sql
CREATE TABLE IF NOT EXISTS minifig_price_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bricklink_id VARCHAR(50) NOT NULL,
  
  -- Terapeak data
  terapeak_avg_sold_price DECIMAL(10,2),
  terapeak_min_sold_price DECIMAL(10,2),
  terapeak_max_sold_price DECIMAL(10,2),
  terapeak_sold_count INTEGER,
  terapeak_active_count INTEGER,
  terapeak_sell_through_rate DECIMAL(5,2),
  terapeak_avg_shipping DECIMAL(10,2),
  terapeak_raw_data JSONB, -- full scraped results for audit
  
  -- BrickLink data (supplementary)
  bricklink_avg_sold_price DECIMAL(10,2),
  bricklink_sold_count INTEGER,
  
  -- Cache control
  researched_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '6 months'),
  source VARCHAR(20) NOT NULL DEFAULT 'terapeak', -- 'terapeak', 'bricklink', 'ebay_scrape'
  
  UNIQUE(bricklink_id)
);

CREATE INDEX idx_price_cache_bricklink ON minifig_price_cache(bricklink_id);
CREATE INDEX idx_price_cache_expires ON minifig_price_cache(expires_at);
```

**Cache lookup logic:**
```
IF price_cache EXISTS for bricklink_id AND expires_at > NOW()
  → Use cached data, skip research
ELSE
  → Run Terapeak research, upsert into cache
```

**Manual refresh:** The review UI should include a "Refresh pricing" button per minifig that bypasses the cache and re-runs Terapeak research.

The `minifig_sync_items` table references cached data rather than storing its own copy — on research, populate the cache and then update the sync item's pricing fields from the cache.

### 2.3 Popularity Threshold

A minifigure qualifies for eBay listing if it meets **all** of these criteria:

| Criterion | Default Threshold | Configurable? |
|-----------|------------------|---------------|
| Minimum sold count (90 days) | ≥ 3 | Yes |
| Sell-through rate | ≥ 30% | Yes |
| Minimum average sold price | ≥ £3.00 | Yes |
| Estimated profit after fees | ≥ £1.50 | Yes |

**Profit calculation:**
```
estimated_profit = avg_sold_price - ebay_final_value_fee(avg_sold_price) - avg_shipping - packaging_cost
```

Where:
- `ebay_final_value_fee` = ~12.8% for most categories (verify current rate)
- `avg_shipping` = from research data
- `packaging_cost` = configurable, default £0.50

**Store thresholds in a config table:**
```sql
CREATE TABLE IF NOT EXISTS minifig_sync_config (
  key VARCHAR(50) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Default values
INSERT INTO minifig_sync_config (key, value) VALUES
  ('min_bricqer_listing_price', '3.00'),
  ('min_sold_count', '3'),
  ('min_sell_through_rate', '30'),
  ('min_avg_sold_price', '3.00'),
  ('min_estimated_profit', '1.50'),
  ('packaging_cost', '0.50'),
  ('ebay_fvf_rate', '0.128'),
  ('price_cache_months', '6'),
  ('reprice_after_days', '85'),
  ('poll_interval_minutes', '15');
```

### 2.4 Pricing Algorithm

```
recommended_price = ROUND(avg_sold_price * 1.05, 2)
```

- 5% above average to account for Best Offer negotiation
- Always enable Best Offer with:
  - Auto-accept: ≥ 95% of listed price
  - Auto-decline: ≤ 75% of listed price
- Floor: never list below `bricqer_price + £1.00` (don't undercut yourself)
- Ceiling: never list above `max_sold_price` (won't sell)

---

## Phase 3: Listing Creation

### 3.1 Image Sourcing (3 images per listing)

The goal is 3 high-quality images per minifigure, sourced in priority order:

#### Image Priority Stack:

1. **Non-stock sourced images** (preferred — more authentic, better conversion)
2. **Rebrickable catalogue images** (high quality, multiple angles available)
3. **BrickLink catalogue images** (good quality, single angle)
4. **Bricqer stored image** (if seller uploaded their own photo)

#### 3.1.1 Non-Stock Image Hunting

Use Playwright to search for high-quality, non-stock photos of the specific minifigure. These perform better on eBay because they look like real seller photos rather than catalogue shots.

**Search sources (in order):**
1. **Google Images** — search `LEGO {minifig_name} {bricklink_id} minifigure -stock -render -official`
   - Filter: Large images, photo type
   - Look for: real photos on white/neutral backgrounds, good lighting, multiple angles
   - Avoid: watermarked images, catalogue renders, images with other items
2. **Flickr** — LEGO community posts high-quality minifig photos
   - Search via API: `https://api.flickr.com/services/rest/?method=flickr.photos.search&tags=lego,minifigure,{bricklink_id}`
   - Filter for Creative Commons licensed images
3. **Reddit** (r/lego, r/legomarket) — real photos from collectors
   - Only use where licensing permits

**Image validation criteria:**
- Minimum resolution: 800x800px
- Single minifigure in frame (not a group shot)
- Clean background (white/light grey preferred)
- Good lighting, no heavy shadows
- No watermarks or text overlays
- Not obviously a catalogue/render image

**Implementation:**
```typescript
interface SourcedImage {
  url: string;
  source: 'google' | 'flickr' | 'reddit' | 'rebrickable' | 'bricklink' | 'bricqer';
  type: 'sourced' | 'stock' | 'original';
  width: number;
  height: number;
  license?: string; // For Creative Commons tracking
}
```

If fewer than 3 non-stock images are found, fill remaining slots from Rebrickable/BrickLink.

#### 3.1.2 Rebrickable Images

**Endpoint:** `GET https://rebrickable.com/api/v3/lego/minifigs/{fig_num}/`

Returns minifigure details including `set_img_url` (high-res catalogue image). Additional images may be available via the parts breakdown.

**API Key:** Stored in platform_credentials (already configured for Hadley Bricks).

#### 3.1.3 BrickLink Images

BrickLink catalogue images follow a predictable URL pattern:
```
https://img.bricklink.com/ItemImage/MN/0/{bricklink_id}.png
```

These are reliable, consistent quality, and always available.

#### 3.1.4 Image Processing

Before uploading to eBay, process all images:
- Resize to eBay recommended: 1600x1600px (or nearest while maintaining aspect ratio)
- White background fill if transparent PNG
- Light sharpening pass
- JPEG compression at quality 85

Use Sharp (Node.js) for processing:
```bash
npm install sharp
```

### 3.2 Listing Description Generation

Use the Claude API to generate compelling eBay listing descriptions.

**Prompt template:**
```
You are writing an eBay listing description for a used LEGO minifigure.

Minifigure: {name}
BrickLink ID: {bricklink_id}
Condition: Used - {condition_notes}
Sets this figure appears in: {set_appearances}
Average sold price: £{avg_sold_price}

Write a professional, concise eBay listing description that includes:
1. Clear identification of the minifigure
2. Which LEGO sets it originally came from
3. Condition description (used, but specify what "used" means for LEGO - no cracks, stud grip good, etc.)
4. What's included (figure only, with accessories, etc.)
5. A brief note about why this fig is collectible/desirable (if applicable)

Format as HTML suitable for eBay. Keep it under 300 words. Use a clean, professional style.
Do NOT include shipping information, returns policy, or payment details (these are handled by eBay business policies).
```

**Set appearances** — look up via Rebrickable API:
```
GET https://rebrickable.com/api/v3/lego/minifigs/{fig_num}/sets/
```

### 3.3 Staging: Create as Unpublished Offer

All listings land in a **staging area** before going live. This uses the eBay Inventory API's natural workflow where an unpublished offer acts as a draft.

**Step 1: Create Inventory Item**
```
PUT /sell/inventory/v1/inventory_item/{sku}
```

Where `sku` = `HB-MF-{bricqer_item_id}`

Request body:
```json
{
  "product": {
    "title": "{generated_title}",
    "description": "{generated_html_description}",
    "imageUrls": ["{image1_url}", "{image2_url}", "{image3_url}"],
    "aspects": {
      "Brand": ["LEGO"],
      "Type": ["Minifigure"],
      "Character": ["{character_name}"],
      "Theme": ["{theme}"],
      "Condition": ["Used"]
    }
  },
  "condition": "USED_EXCELLENT",
  "conditionDescription": "{condition_notes}",
  "availability": {
    "shipToLocationAvailability": {
      "quantity": 1
    }
  }
}
```

**Step 2: Upload Images to eBay**

Before creating the inventory item, upload images via eBay's Image Upload API or include them as URLs that eBay will fetch.

If using externally hosted URLs, ensure they are publicly accessible. If images are processed locally, upload via:
```
POST /sell/inventory/v1/inventory_item/{sku}/upload_image
```

**Step 3: Create Offer (Unpublished = Staged)**
```
POST /sell/inventory/v1/offer
```

Request body:
```json
{
  "sku": "HB-MF-{bricqer_item_id}",
  "marketplaceId": "EBAY_GB",
  "format": "FIXED_PRICE",
  "listingDescription": "{generated_html_description}",
  "availableQuantity": 1,
  "categoryId": "{ebay_category_id}",
  "merchantLocationKey": "{your_location_key}",
  "pricingSummary": {
    "price": {
      "value": "{recommended_price}",
      "currency": "GBP"
    }
  },
  "listingPolicies": {
    "fulfillmentPolicyId": "{shipping_policy_id}",
    "paymentPolicyId": "{payment_policy_id}",
    "returnPolicyId": "{return_policy_id}",
    "bestOfferTerms": {
      "bestOfferEnabled": true,
      "autoAcceptPrice": {
        "value": "{auto_accept_price}",
        "currency": "GBP"
      },
      "autoDeclinePrice": {
        "value": "{auto_decline_price}",
        "currency": "GBP"
      }
    }
  }
}
```

**DO NOT call publish at this point.** The offer sits as a draft/staged listing.

**Step 4: Update sync table**
```sql
UPDATE minifig_sync_items SET
  listing_status = 'STAGED',
  ebay_sku = 'HB-MF-{bricqer_item_id}',
  ebay_offer_id = '{offer_id}',
  updated_at = NOW()
WHERE bricqer_item_id = '{bricqer_item_id}';
```

### 3.4 Review Queue UI

The Hadley Bricks UI needs a review screen showing all staged listings:

**Review Queue Page: `/minifigs/review`**

For each staged listing, display:
- Minifigure name + BrickLink ID
- 3 sourced images (with source labels: "Google", "Rebrickable", "BrickLink", etc.)
- Generated title and description (editable)
- Recommended price vs Bricqer price vs avg eBay sold price
- Market data summary (sold count, sell-through rate)
- Action buttons:
  - **Publish** → calls `POST /sell/inventory/v1/offer/{offerId}/publish` → status = `PUBLISHED`
  - **Edit** → opens editor for title/description/price/images
  - **Reject** → deletes the eBay inventory item and offer → status = `NOT_LISTED`
  - **Bulk Publish** → publish all staged listings that pass a quality check

**Quality check before publish:**
- At least 2 images present
- Description > 50 characters
- Price > £0
- All required eBay fields populated

---

## Phase 4: Cross-Platform Sync

### 4.1 eBay Sale → Review & Remove from Bricqer

**Trigger:** eBay sale detected

**Detection method:** Poll eBay Orders API every 15 minutes (or implement Platform Notifications webhook for near-real-time).

**Polling approach:**
```
GET /sell/fulfillment/v1/order?filter=creationdate:[{last_poll_time}..{now}]
```

For each new order:
1. Check if any line item SKU starts with `HB-MF-`
2. Look up `bricqer_item_id` from the mapping table
3. Update sync table: `listing_status = 'SOLD_EBAY_PENDING_REMOVAL'`
4. **Add to removal review queue** — do NOT auto-delete from Bricqer

**The removal is NOT automatic.** It lands in a review queue for approval.

**Webhook approach (better, implement after polling works):**

Subscribe to eBay Platform Notifications:
- Event: `FixedPriceTransaction`
- Delivery: HTTPS webhook to `https://your-domain/api/webhooks/ebay/sale`

The webhook handler follows the same steps — always queue for review, never auto-delete.

### 4.2 Bricqer Sale → Review & End eBay Listing

**Trigger:** Bricqer sale detected via polling

**Poll endpoint:** `GET https://hadleybricks.bricqer.com/api/v1/orders/`

**Poll frequency:** Every 15 minutes via cron job

**Process:**
1. Fetch recent Bricqer orders (filter by date since last poll)
2. For each order, check if any item matches a `bricqer_item_id` in the sync table
3. If matched and `listing_status = 'PUBLISHED'`:
   - Update sync table: `listing_status = 'SOLD_BRICQER_PENDING_REMOVAL'`
   - **Add to removal review queue** — do NOT auto-end the eBay listing

### 4.3 Removal Review Queue

Both directions (eBay sale → remove from Bricqer, Bricqer sale → end eBay listing) require explicit approval before any deletion occurs.

**Review Queue Page: `/minifigs/removals`**

For each pending removal, display:
- Minifigure name + BrickLink ID
- Which platform it sold on (eBay or Bricqer)
- Sale price and date
- What will be removed (Bricqer listing or eBay listing)
- Link to the sale/order on the selling platform
- Action buttons:
  - **Approve Removal** → executes the deletion on the other platform
  - **Approve All** → bulk approve all pending removals
  - **Dismiss** → marks as reviewed but takes no action (edge case: manual handling needed)

**On "Approve Removal" for eBay sale:**
1. Call Bricqer API to delete/zero the inventory item:
   ```
   DELETE https://hadleybricks.bricqer.com/api/v1/inventory/{bricqer_item_id}/
   ```
   (CC to verify: may need `PATCH` to set quantity to 0 instead of DELETE)
2. Update sync table: `listing_status = 'SOLD_EBAY'`

**On "Approve Removal" for Bricqer sale:**
1. End the eBay listing:
   ```
   POST /sell/inventory/v1/offer/{offerId}/withdraw
   ```
2. Delete the eBay inventory item:
   ```
   DELETE /sell/inventory/v1/inventory_item/{sku}
   ```
3. Update sync table: `listing_status = 'SOLD_BRICQER'`

**Notification:** When a new removal lands in the queue, send a notification (Discord via Peterbot, or email) so you can approve promptly. The longer the delay, the higher the risk of a double-sale.

### 4.4 Removal Queue Table

```sql
CREATE TABLE IF NOT EXISTS minifig_removal_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  minifig_sync_id UUID NOT NULL REFERENCES minifig_sync_items(id),
  
  -- Sale details
  sold_on VARCHAR(20) NOT NULL, -- 'EBAY' or 'BRICQER'
  sale_price DECIMAL(10,2),
  sale_date TIMESTAMP,
  order_id VARCHAR(100), -- eBay order ID or Bricqer order ID
  order_url TEXT, -- link to order on selling platform
  
  -- Removal target
  remove_from VARCHAR(20) NOT NULL, -- 'EBAY' or 'BRICQER'
  removal_details JSONB, -- stores offer_id, sku, bricqer_item_id etc. needed for removal
  
  -- Review state
  status VARCHAR(20) DEFAULT 'PENDING', -- 'PENDING', 'APPROVED', 'EXECUTED', 'FAILED', 'DISMISSED'
  reviewed_at TIMESTAMP,
  executed_at TIMESTAMP,
  error_message TEXT,
  
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_removal_queue_status ON minifig_removal_queue(status);
CREATE INDEX idx_removal_queue_sync ON minifig_removal_queue(minifig_sync_id);
```

### 4.5 Sync Job Table

Track poll state and errors:

```sql
CREATE TABLE IF NOT EXISTS minifig_sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type VARCHAR(30) NOT NULL, -- 'INVENTORY_PULL', 'MARKET_RESEARCH', 'EBAY_ORDER_POLL', 'BRICQER_ORDER_POLL'
  status VARCHAR(20) DEFAULT 'PENDING', -- 'PENDING', 'RUNNING', 'COMPLETED', 'FAILED'
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  items_processed INTEGER DEFAULT 0,
  items_created INTEGER DEFAULT 0,
  items_updated INTEGER DEFAULT 0,
  items_errored INTEGER DEFAULT 0,
  error_log JSONB DEFAULT '[]',
  last_poll_cursor TEXT, -- stores last order date or page token for incremental polling
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_sync_jobs_type ON minifig_sync_jobs(job_type);
CREATE INDEX idx_sync_jobs_status ON minifig_sync_jobs(status);
```

### 4.6 Race Condition Handling

Since there's a polling gap (up to 15 minutes), a minifig could sell on both platforms simultaneously.

**Mitigation:**
1. When an eBay sale is detected, immediately attempt Bricqer removal. If Bricqer returns a 404/not-found (already sold), log it but don't error.
2. When a Bricqer sale is detected, immediately attempt eBay withdrawal. If eBay returns an error (already sold), log it but don't error.
3. If both sales are detected, prioritise the first one chronologically and refund/cancel the second.
4. For high-value figs (>£50), consider reducing poll interval to 5 minutes.

---

## Phase 5: Ongoing Operations

### 5.1 Scheduled Jobs

| Job | Frequency | Purpose |
|-----|-----------|---------|
| Inventory Pull | Daily at 06:00 | Discover new minifigs in Bricqer (≥£3 listing price) |
| Market Research | Every 6 months per fig (cache-driven) | Refresh pricing data via Terapeak |
| eBay Order Poll | Every 15 minutes | Detect eBay sales → queue for removal review |
| Bricqer Order Poll | Every 15 minutes | Detect Bricqer sales → queue for removal review |
| Stale Listing Check | Weekly | Identify listings approaching reprice threshold |
| Image Refresh | Monthly | Check for better images for low-performing listings |

### 5.2 Repricing Logic

For listings unsold after **85 days**:
1. Re-run market research
2. If avg sold price has dropped, reduce price to match
3. If sell-through rate has dropped below threshold, consider ending listing
4. If competing listings have appeared at lower prices, adjust

### 5.3 Dashboard Metrics

Add to Hadley Bricks dashboard:

- Total minifigs in Bricqer inventory
- Total minifigs meeting threshold
- Total staged / published / sold
- Revenue from eBay minifig sales (vs what they'd earn on Bricqer)
- Fee savings (3.5% Bricqer fee avoided)
- Average time to sell on eBay vs Bricqer

---

## API Routes Summary

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/minifigs/sync/pull-inventory` | POST | Pull minifigs from Bricqer (≥£3 listing price) |
| `/api/minifigs/sync/research` | POST | Run Terapeak research for all/specific figs (respects 6-month cache) |
| `/api/minifigs/sync/research/refresh` | POST | Force-refresh pricing for a specific fig (bypass cache) |
| `/api/minifigs/sync/create-listings` | POST | Create staged eBay listings for qualifying figs |
| `/api/minifigs/sync/publish` | POST | Publish one or more staged listings |
| `/api/minifigs/sync/reject` | POST | Reject/delete a staged listing |
| `/api/minifigs/review` | GET | Get all staged listings for review |
| `/api/minifigs/removals` | GET | Get all pending removal queue items |
| `/api/minifigs/removals/approve` | POST | Approve one or more removals (executes delete on other platform) |
| `/api/minifigs/removals/dismiss` | POST | Dismiss a removal (manual handling) |
| `/api/minifigs/dashboard` | GET | Dashboard metrics |
| `/api/webhooks/ebay/sale` | POST | eBay sale webhook receiver → queues for removal review |
| `/api/cron/minifigs/poll-ebay-orders` | GET | Cron: poll eBay orders → queues for removal review |
| `/api/cron/minifigs/poll-bricqer-orders` | GET | Cron: poll Bricqer orders → queues for removal review |
| `/api/cron/minifigs/daily-inventory` | GET | Cron: daily inventory pull |
| `/api/cron/minifigs/research-refresh` | GET | Cron: refresh expired price cache (>6 months) |

---

## CC Verification Checklist

Before implementation, Claude Code should verify:

- [ ] `OPTIONS /api/v1/inventory/` — confirm filter parameters for category/condition
- [ ] `OPTIONS /api/v1/inventory/{id}/` — confirm DELETE and/or PATCH support
- [ ] `OPTIONS /api/v1/orders/` — confirm order listing with date filters
- [ ] Test creating an eBay inventory item with `HB-MF-` SKU prefix
- [ ] Test creating an unpublished offer (confirm it doesn't appear in Bricqer's eBay sync)
- [ ] Test publishing and withdrawing an offer
- [ ] Confirm eBay category ID for "LEGO Minifigures" on EBAY_GB
- [ ] Confirm merchant location key is set up
- [ ] Confirm business policy IDs (fulfillment, payment, return)
- [ ] Test Playwright eBay authentication and sold listing scraping
- [ ] Verify Rebrickable API key works for minifig lookups
- [ ] Confirm BrickLink API access for price guide data

---

## Do NOT

- Do NOT use Bricqer's native eBay integration for any part of this feature
- Do NOT create eBay listings without the `HB-MF-` SKU prefix
- Do NOT publish listings automatically — always stage first
- Do NOT scrape eBay without rate limiting (min 2-3 second delays)
- Do NOT store eBay session cookies in plaintext — use encrypted credentials
- Do NOT assume Bricqer supports DELETE on inventory — verify first, fall back to PATCH quantity=0
- Do NOT list minifigs below their Bricqer price (floor rule)
- Do NOT use watermarked or copyrighted images — verify licensing on sourced images
- Do NOT hardcode threshold values — use the config table

---

## File Structure

```
src/
├── app/
│   ├── minifigs/
│   │   ├── page.tsx                    # Minifig sync dashboard
│   │   ├── review/
│   │   │   └── page.tsx                # Staging review queue
│   │   └── removals/
│   │       └── page.tsx                # Removal approval queue
│   └── api/
│       ├── minifigs/
│       │   ├── sync/
│       │   │   ├── pull-inventory/route.ts
│       │   │   ├── research/route.ts
│       │   │   ├── create-listings/route.ts
│       │   │   ├── publish/route.ts
│       │   │   └── reject/route.ts
│       │   ├── review/route.ts
│       │   ├── removals/
│       │   │   ├── route.ts            # GET pending removals
│       │   │   ├── approve/route.ts    # POST approve removal
│       │   │   └── dismiss/route.ts    # POST dismiss removal
│       │   └── dashboard/route.ts
│       ├── webhooks/
│       │   └── ebay/
│       │       └── sale/route.ts
│       └── cron/
│           └── minifigs/
│               ├── poll-ebay-orders/route.ts
│               ├── poll-bricqer-orders/route.ts
│               ├── daily-inventory/route.ts
│               └── research-refresh/route.ts
├── lib/
│   ├── minifig-sync/
│   │   ├── bricqer-client.ts           # Bricqer API wrapper for minifig operations
│   │   ├── terapeak-scraper.ts         # Playwright-based Terapeak research
│   │   ├── ebay-research-fallback.ts   # Playwright-based sold listing scraper (fallback)
│   │   ├── image-sourcer.ts            # Multi-source image hunting + processing
│   │   ├── listing-generator.ts        # Claude API description generation
│   │   ├── pricing-engine.ts           # Threshold + pricing calculations
│   │   ├── price-cache.ts              # 6-month cache lookup/upsert logic
│   │   ├── removal-queue.ts            # Removal queue management
│   │   ├── sync-orchestrator.ts        # Coordinates the full pipeline
│   │   └── types.ts                    # TypeScript interfaces
│   └── adapters/
│       └── bricqer/
│           └── minifig-adapter.ts      # Bricqer-specific inventory operations
└── components/
    └── minifigs/
        ├── ReviewQueue.tsx              # Staged listing review UI
        ├── RemovalQueue.tsx             # Removal approval UI
        ├── MinifigCard.tsx              # Individual minifig display
        ├── MarketDataPanel.tsx          # Pricing/research data display
        ├── ImageGallery.tsx             # Image preview with source labels
        └── SyncDashboard.tsx            # Overview metrics
```

---

## Agent Workflow

After implementation of each phase:
1. `/test-plan` analyze — generate test plan for the implemented phase
2. `/test-build` — build the test suite
3. `/test-execute` — run tests
4. `/code-review` — review implementation
5. Commit only after all pass
