# Listing Refresh

## Overview

The Refresh feature ends and recreates eBay listings older than 90 days. This "refreshes" the listing's creation date, potentially improving search ranking and visibility. eBay's algorithm tends to favor newer listings.

## Accessing Listing Refresh

**Navigation**: Dashboard sidebar → Listing Assistant → Refresh tab

## Prerequisites

### Required eBay OAuth Scopes

The refresh feature requires enhanced eBay permissions:
- `https://api.ebay.com/oauth/api_scope/sell.inventory`
- `https://api.ebay.com/oauth/api_scope/sell.inventory.readonly`

If you don't have these scopes:
1. A prompt appears explaining the requirement
2. Click to re-authorize with eBay
3. Grant the additional permissions
4. Return to the Refresh tab

## Workflow Overview

```
1. Select eligible listings (90+ days old)
       │
       ▼
2. Choose mode: Review or Immediate
       │
       ├── Review Mode ──────────────────────┐
       │   - Review each listing individually │
       │   - Edit title, price, quantity     │
       │   - Approve or skip each item       │
       │                                      │
       └── Immediate Mode ────────────────────┤
           - Process all selected listings    │
           - No individual review             │
                                              │
       ┌──────────────────────────────────────┘
       ▼
3. Execute refresh
   - End original listing
   - Create new listing with same details
   - Keep same SKU for inventory tracking
       │
       ▼
4. View results
   - Success/failure summary
   - Individual item status
   - Error messages if any
```

## Eligible Listings Table

The table shows listings that can be refreshed:

| Column | Description |
|--------|-------------|
| Checkbox | Select for refresh |
| Image | Thumbnail preview |
| Title | Listing title |
| Price | Current price |
| Age | Days since listing created |
| Views | View count (if loaded) |
| Watchers | Watcher count |

### Loading View Data

Click **Load Views** to fetch view counts:
- Makes additional API calls
- Shows progress during fetch
- Helpful for prioritizing which listings to refresh

### Selection

- Click checkbox to select individual listings
- Use header checkbox for select all
- Selected count shown at bottom

## Refresh Modes

### Review Mode (Default)

1. Select listings and click **Start Review**
2. Review each listing one by one
3. For each listing:
   - See current details
   - Edit title, price, or quantity
   - Click **Approve** to include in refresh
   - Click **Skip** to exclude
4. After reviewing all, click **Start Processing**

Use when:
- You want to update prices
- You need to review listing quality
- You're refreshing a small batch

### Immediate Mode

1. Toggle off "Review before processing"
2. Select listings and click **Start Refresh**
3. All selected listings are processed immediately
4. Watch progress bar during execution

Use when:
- Listings need no changes
- You're refreshing many listings
- You trust current listing quality

## Review Interface

For each listing in review mode:

### Original Details
- Thumbnail image
- Current title
- Current price
- Current quantity

### Editable Fields
- **Title**: Modify before refresh
- **Price**: Update pricing
- **Quantity**: Change stock level

### Actions
| Button | Action |
|--------|--------|
| **Approve** | Include in refresh with any changes |
| **Skip** | Exclude from refresh |

### Approve All

Click **Approve All** to approve all remaining items without individual review.

## Execution Progress

During refresh execution:

### Progress Indicator
- Total items to process
- Current item number
- Progress bar percentage

### Status Updates
- "Ending listing..."
- "Creating new listing..."
- "Completed" or "Failed"

### Error Handling
- Failed items shown with error message
- Processing continues with remaining items
- Summary shows success/failure counts

## Results Summary

After completion:

| Metric | Description |
|--------|-------------|
| Successful | Items refreshed successfully |
| Failed | Items that encountered errors |
| Skipped | Items excluded during review |

### Result Actions
- **View Details**: See individual item results
- **Done**: Return to selection view

## History

Click **History** button to view past refresh jobs:

| Column | Description |
|--------|-------------|
| Date | When job was run |
| Items | Number of items processed |
| Status | Completed, Partial, Failed |
| Results | Success/failure breakdown |

Click a job to view detailed results.

## Technical Details

### Refresh Process

For each listing:
1. Fetch full listing details from eBay
2. End the original listing
3. Create new listing with:
   - Same or modified title/price/quantity
   - Same SKU (critical for inventory linking)
   - Same photos (copied from original)
   - Same description
   - Same item specifics
4. Record result in database

### Database Tables

```sql
-- Refresh jobs
CREATE TABLE listing_refresh_jobs (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users,
  status VARCHAR(20) NOT NULL,
  review_mode BOOLEAN DEFAULT TRUE,
  items_total INTEGER,
  items_completed INTEGER,
  items_failed INTEGER,
  created_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Job items
CREATE TABLE listing_refresh_items (
  id UUID PRIMARY KEY,
  job_id UUID REFERENCES listing_refresh_jobs,
  ebay_item_id VARCHAR(20) NOT NULL,
  original_title TEXT,
  original_price DECIMAL,
  modified_title TEXT,
  modified_price DECIMAL,
  status VARCHAR(20) NOT NULL,
  new_item_id VARCHAR(20),
  error_message TEXT,
  processed_at TIMESTAMPTZ
);
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/listing-refresh/eligible` | GET | List eligible listings |
| `/api/listing-refresh/jobs` | POST | Create refresh job |
| `/api/listing-refresh/jobs/[id]` | GET | Get job details |
| `/api/listing-refresh/jobs/[id]/items` | PUT | Update job items |
| `/api/listing-refresh/jobs/[id]/execute` | POST | Execute refresh |

## Best Practices

1. **Refresh strategically** - Focus on listings with low views
2. **Update prices** - Use refresh as opportunity to reprice
3. **Batch wisely** - Don't refresh hundreds at once
4. **Monitor results** - Check for failures and address issues
5. **Time it right** - Refresh when eBay traffic is low

## Troubleshooting

### "No eligible listings"
- All listings are under 90 days old
- Check back later

### Scope upgrade prompt persists
- Re-authorize with eBay
- Ensure you grant all requested permissions
- Clear browser cache and retry

### Refresh fails for specific item
- Check error message in results
- Item may have been sold/ended
- eBay may have restricted the listing

### Views not loading
- eBay API rate limiting
- Try again after a few minutes
- Views are optional - proceed without them

### Progress stuck
- eBay API may be slow
- Wait or refresh the page
- Check job history for status

## Related Files

| File | Purpose |
|------|---------|
| `apps/web/src/components/features/listing-assistant/tabs/RefreshTab.tsx` | Main refresh UI |
| `apps/web/src/hooks/listing-refresh/use-eligible-listings.ts` | Fetch eligible listings |
| `apps/web/src/hooks/listing-refresh/use-execute-refresh.ts` | Execute refresh job |
| `apps/web/src/hooks/listing-refresh/use-refresh-job.ts` | Job management hooks |
