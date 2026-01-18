# User Journey: BrickLink Uploads

> **Journey:** Track inventory batches uploaded to BrickLink/BrickOwl stores
> **Entry Point:** `/bricklink-uploads`
> **Complexity:** Medium

## Overview

The BrickLink Uploads feature allows you to track inventory batches that have been uploaded to BrickLink or BrickOwl stores. Each upload record captures the quantity, selling price, cost, and source of items, enabling profit tracking and inventory analysis.

## User Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BrickLink Uploads                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ BrickLink Uploads                          [Bricqer Connected]      │   │
│  │ Track inventory batches uploaded to BrickLink/BrickOwl stores       │   │
│  │                                    Last sync: Jan 18, 2026          │   │
│  │                                                                      │   │
│  │                            [Sync from Bricqer]  [Add Upload]        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Filters                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ [Search...]  [Date From]  [Date To]  [Source ▼]  [Clear Filters]   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Summary                                                                    │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐   │
│  │  Uploads  │ │   Parts   │ │   Value   │ │   Cost    │ │  Margin   │   │
│  │    156    │ │  45,230   │ │ £12,456   │ │  £8,234   │ │  £4,222   │   │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘ └───────────┘   │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Date       │ Parts │ Lots │ Value   │ Cost   │ Margin │ Source │ ⋮ │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │ 18/01/2026 │  450  │  32  │ £234.50 │ £120.00│ +£114.50│Auction│ ⋮ │  │
│  │ 15/01/2026 │  890  │  56  │ £567.00 │ £350.00│ +£217.00│eBay   │ ⋮ │  │
│  │ 10/01/2026 │  234  │  18  │ £145.00 │ —      │ —      │FB Mkt │ ⋮ │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  Showing 1-25 of 156                              [Previous] [Next]        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Concepts

### Upload Record Fields

| Field | Description | Required |
|-------|-------------|----------|
| Upload Date | When the batch was uploaded to stores | Yes |
| Total Quantity (Parts) | Total item count in the batch | Yes |
| Selling Price (Value) | Total listing value | Yes |
| Lots | Number of unique lots | No |
| Cost | Purchase cost of items | No |
| Condition | New (N) or Used (U) | No |
| Source | Where items came from | No |
| Reference | Batch reference or ID | No |
| Notes | Additional notes | No |

### Sources

| Source | Description |
|--------|-------------|
| Auction | Local auction purchases |
| FB Marketplace | Facebook Marketplace |
| Car Boot | Car boot sale |
| eBay | eBay purchases |
| Various | Mixed sources |
| Lego.com | Direct from LEGO |
| BL | BrickLink purchases |
| Other | Other sources |

### Bricqer Integration

If you use Bricqer for inventory management, uploads can be automatically synced:
- Badge shows "Bricqer Connected" when linked
- "Sync from Bricqer" button imports batch data
- Synced uploads are marked with `synced_from_bricqer = true`

---

## Steps

### 1. View Upload List

**Action:** Navigate to `/bricklink-uploads`

**What's Shown:**
- Header with sync status (if Bricqer connected)
- Filter controls
- Summary cards with totals
- Paginated table of uploads

**Table Columns:**
| Column | Description |
|--------|-------------|
| Date | Upload date |
| Parts | Total item quantity |
| Lots | Unique lot count |
| Value | Total selling price |
| Cost | Purchase cost |
| Margin | Calculated profit (Value - Cost) |
| Source | Item source |
| Actions | View, Edit, Delete |

### 2. Add New Upload

**Action:** Click "Add Upload" button

**Form Fields:**

**Upload Details Card:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│  Upload Details                                                         │
│  Core upload information                                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Upload Date *                                                          │
│  [2026-01-18        ]                                                  │
│  When the batch was uploaded to stores                                 │
│                                                                         │
│  Parts *                    Lots                                        │
│  [450         ]             [32          ]                             │
│  Total item count           Unique lot count                           │
│                                                                         │
│  Condition                                                              │
│  [Select condition ▼]                                                   │
│  • New                                                                  │
│  • Used                                                                 │
│                                                                         │
│  Source                                                                 │
│  [Select source ▼]                                                      │
│  Where the items came from                                             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Financial Details Card:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│  Financial Details                                                      │
│  Pricing and cost information                                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Selling Price (Value) *                                                │
│  [234.50      ]                                                        │
│  Total listing value                                                    │
│                                                                         │
│  Cost                                                                   │
│  [120.00      ]                                                        │
│  Purchase cost of items                                                 │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ Calculated Margin                                                  │ │
│  │ +£114.50 (48.8%)                                                  │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  Reference                                                              │
│  [Batch reference or ID                                  ]             │
│  Optional reference code                                               │
│                                                                         │
│  Notes                                                                  │
│  [Any additional notes...                                              │
│   _______________________________________________________________     │
│   _______________________________________________________________]    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**What Happens:**
1. Fill required fields (date, parts, value)
2. Optionally add cost for margin calculation
3. Click "Create Upload"
4. Redirected to upload detail page

### 3. View Upload Detail

**Action:** Click on a table row or use view action

**Detail Page:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│  ← Back to Uploads                                                      │
│                                                                         │
│  Upload: 18/01/2026                                     [Edit] [Delete] │
│  450 parts • £234.50 value                                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Upload Details                          Financial Summary              │
│  ──────────────                          ─────────────────             │
│  Date: 18 January 2026                   Value: £234.50                │
│  Parts: 450                              Cost: £120.00                 │
│  Lots: 32                                Margin: +£114.50 (48.8%)      │
│  Condition: New                                                         │
│  Source: Auction                                                        │
│  Reference: LOT-2026-001                                               │
│                                                                         │
│  Notes                                                                  │
│  ─────                                                                 │
│  Local auction lot, mixed themes                                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4. Edit Upload

**Action:** Click "Edit" on detail page or row action menu

**Form:**
- Same as create form, pre-populated with existing values
- "Save Changes" button saves updates

### 5. Delete Upload

**Action:** Click "Delete" on detail page or row action menu

**Confirmation Dialog:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│  Confirm Delete                                                   [✕]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Are you sure you want to delete this upload? This action cannot       │
│  be undone.                                                            │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                              [Cancel]  [Delete]         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6. Filter Uploads

**Action:** Use filter controls

**Available Filters:**
| Filter | Description |
|--------|-------------|
| Search | Text search in source, notes, reference |
| Date From | Start of date range |
| Date To | End of date range |
| Source | Filter by item source |

**Filtering Behavior:**
- Filters apply immediately
- Page resets to 1 when filters change
- Clear Filters resets all filters

### 7. Sync from Bricqer

**Action:** Click "Sync from Bricqer" button (if connected)

**What Happens:**
1. Button shows "Syncing..." with spinner
2. API fetches batch data from Bricqer
3. Creates/updates upload records
4. Last sync timestamp updates
5. List refreshes with new data

---

## Technical Details

### Upload Data Structure

```typescript
interface BrickLinkUpload {
  id: string;
  user_id: string;
  bricqer_batch_id: number | null;
  bricqer_purchase_id: number | null;
  upload_date: string;
  total_quantity: number;
  selling_price: number;
  cost: number | null;
  source: string | null;
  notes: string | null;
  purchase_id: string | null;
  linked_lot: string | null;
  lots: number | null;
  condition: string | null;
  reference: string | null;
  is_activated: boolean | null;
  remaining_quantity: number | null;
  remaining_price: number | null;
  raw_response: unknown | null;
  synced_from_bricqer: boolean | null;
  created_at: string;
  updated_at: string;
}
```

### Summary Calculation

```typescript
interface UploadSummary {
  totalUploads: number;        // Count of uploads
  totalQuantity: number;       // Sum of total_quantity
  totalSellingPrice: number;   // Sum of selling_price
  totalCost: number;           // Sum of cost (non-null)
  totalMargin: number;         // totalSellingPrice - totalCost
  recentUploads: BrickLinkUpload[]; // Last 5 uploads
}
```

### Pagination

```typescript
interface PaginatedResult<T> {
  data: T[];
  page: number;
  pageSize: number;       // Default: 25
  total: number;
  totalPages: number;
}
```

### Query Keys

```typescript
const uploadKeys = {
  all: ['bricklink-uploads'],
  lists: () => [...uploadKeys.all, 'list'],
  list: (filters?, pagination?) => [...uploadKeys.lists(), { filters, pagination }],
  details: () => [...uploadKeys.all, 'detail'],
  detail: (id) => [...uploadKeys.details(), id],
  sync: () => [...uploadKeys.all, 'sync'],
};
```

---

## Error Handling

### Load Error
```
┌─────────────────────────────────────────────────────────────────────────┐
│ Failed to load uploads: Network error                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Delete Error
- Toast notification with error message
- Upload remains in list

### Bricqer Sync Error
- Error toast with message
- Sync button re-enabled
- Partial data may have been imported

---

## Source Files

| File | Purpose |
|------|---------|
| [page.tsx](../../../apps/web/src/app/(dashboard)/bricklink-uploads/page.tsx) | Main list page |
| [new/page.tsx](../../../apps/web/src/app/(dashboard)/bricklink-uploads/new/page.tsx) | Create page |
| [BrickLinkUploadTable.tsx](../../../apps/web/src/components/features/bricklink-uploads/BrickLinkUploadTable.tsx) | Data table component |
| [BrickLinkUploadForm.tsx](../../../apps/web/src/components/features/bricklink-uploads/BrickLinkUploadForm.tsx) | Create/edit form |
| [BrickLinkUploadFilters.tsx](../../../apps/web/src/components/features/bricklink-uploads/BrickLinkUploadFilters.tsx) | Filter controls |
| [BrickLinkUploadSummary.tsx](../../../apps/web/src/components/features/bricklink-uploads/BrickLinkUploadSummary.tsx) | Summary cards |
| [bricklink-upload.service.ts](../../../apps/web/src/lib/services/bricklink-upload.service.ts) | Service class |
| [use-bricklink-uploads.ts](../../../apps/web/src/hooks/use-bricklink-uploads.ts) | React Query hooks |

## Related Journeys

- [BrickLink Authentication](./bricklink-authentication.md) - Connect BrickLink account
- [Order Sync](./order-sync.md) - Sync sales orders
- [Transactions](../transactions/bricklink.md) - View BrickLink transactions
