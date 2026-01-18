# User Journey: Adding Inventory

> **Journey:** Add new items to inventory using multiple input methods
> **Entry Point:** `/inventory/new`
> **Complexity:** High

## Overview

The Add Inventory feature provides five different methods for adding items, accommodating different use cases from single items to bulk imports. All methods ultimately create inventory items in the database.

## Input Methods

| Method | Best For | Description |
|--------|----------|-------------|
| **Single** | One item at a time | Traditional form with all fields |
| **Natural Language** | Quick bulk entry | Describe items in plain English, AI parses |
| **Photo** | Items with boxes | Upload photo, AI extracts set details |
| **CSV Import** | Large imports | Upload spreadsheet data |
| **Bulk Grid** | Spreadsheet-like entry | Multi-row grid for fast data entry |

## User Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                      /inventory/new                                 │
├─────────────────────────────────────────────────────────────────────┤
│  ← Back to Inventory                                                │
│                                                                     │
│  Add Inventory                                                      │
│  Add items to your inventory using your preferred method            │
├─────────────────────────────────────────────────────────────────────┤
│  ┌────────┬─────────────────┬───────┬────────────┬───────┐         │
│  │ Single │ Natural Language│ Photo │ CSV Import │ Bulk  │         │
│  └────────┴─────────────────┴───────┴────────────┴───────┘         │
│                                                                     │
│  [Tab Content Area]                                                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Method 1: Single Item Form

**Use Case:** Adding one item with full control over all fields

### Flow

1. **Select "Single" tab** (default)
2. **Fill in required fields:**
   - Set Number (required)
   - Item Name (optional, can auto-fill from Brickset)
3. **Fill in optional fields:**
   - Condition (New/Used)
   - Status (defaults to "Not Yet Received")
   - Cost
   - Purchase Date
   - Source
   - Storage Location
   - Listing Platform
   - Listing Value
   - Amazon ASIN
   - Linked Lot
   - Notes
   - Link to Purchase (with lookup/create)
4. **Click "Create"**
5. **Redirected to inventory list**

### Fields Reference

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| Set Number | Yes | Text | LEGO set number, e.g., "75192" |
| Item Name | No | Text | Auto-populated from set lookup |
| Condition | No | Select | "New" or "Used" |
| Status | No | Select | Default: "NOT YET RECEIVED" |
| Cost | No | Number | Purchase cost in GBP |
| Purchase Date | No | Date | When purchased |
| Source | No | Text | Where purchased |
| Storage Location | No | Text | Physical location |
| Listing Platform | No | Select | eBay, Amazon, etc. |
| Listing Value | No | Number | Listed/expected price |
| Listing Date | No | Date | When listed |
| Amazon ASIN | No | Text | For Amazon listings |
| SKU | No | Text | Auto-generated if blank |
| Linked Lot | No | Text | Group related items |
| Notes | No | Textarea | Additional notes |
| Linked Purchase | No | Lookup | Link to purchase record |

---

## Method 2: Natural Language Input

**Use Case:** Quickly adding multiple items by describing them in plain English

### Flow

1. **Select "Natural Language" tab**
2. **Type description in text area**

   Example inputs:
   ```
   3x 75192 Millennium Falcon from eBay for £120 each, new sealed
   ```
   ```
   Bought 10294, 42100, and 75313 from car boot for £50 total, used condition
   ```
   ```
   New sealed 75192, 10294 from LEGO Store at £200 each
   ```

3. **Click "Parse with AI"**
4. **Review parsed items:**
   - Shared fields section (source, date, condition, status)
   - Individual items table with all extracted data
   - Confidence scores shown per item
5. **Edit any incorrect values**
6. **Add/remove items as needed**
7. **Click "Create X Items"**
8. **Redirected to inventory list**

### AI Parsing Capabilities

The AI extracts:
- **Set numbers** from natural references
- **Quantities** (default: 1)
- **Costs** - total or per-item, handles "each" notation
- **Condition** from keywords like "new", "sealed", "used"
- **Source** from context
- **Notes** from additional details

### Confidence Scores

| Score | Display | Meaning |
|-------|---------|---------|
| ≥ 80% | Green badge | High confidence, likely correct |
| 50-79% | Yellow badge | Medium confidence, review recommended |
| < 50% | Red badge | Low confidence, likely needs correction |

### Shared Fields

After parsing, you can set shared values that apply to all items:
- Source
- Purchase Date
- Condition
- Status
- Storage Location
- Listing Platform
- Listing Date
- Listing Value
- SKU
- Linked Lot
- Amazon ASIN

---

## Method 3: Photo Input

**Use Case:** Adding items by photographing boxes/sets

### Flow

1. **Select "Photo" tab**
2. **Upload photo(s)** of LEGO boxes
3. **AI analyses images** to extract:
   - Set numbers (from barcode or box)
   - Set names
   - Condition (sealed vs opened)
4. **Review detected items**
5. **Edit/confirm details**
6. **Create items**

### Supported Images

- JPEG, PNG, WebP formats
- Multiple images can be processed
- Works best with clear box photos showing set number

---

## Method 4: CSV Import

**Use Case:** Importing large quantities from spreadsheet

### Flow

1. **Select "CSV Import" tab**
2. **Download template** (optional)
3. **Upload CSV file**
4. **Map columns** to inventory fields
5. **Preview imported data**
6. **Resolve any errors**
7. **Confirm import**
8. **Items created in bulk**

### CSV Template Columns

| Column | Required | Notes |
|--------|----------|-------|
| set_number | Yes | LEGO set number |
| item_name | No | Set name |
| condition | No | "New" or "Used" |
| status | No | Status value |
| cost | No | Number |
| purchase_date | No | YYYY-MM-DD format |
| source | No | Text |
| storage_location | No | Text |
| listing_platform | No | Platform name |
| listing_value | No | Number |
| notes | No | Text |

---

## Method 5: Bulk Grid Entry

**Use Case:** Spreadsheet-like fast data entry

### Flow

1. **Select "Bulk" tab**
2. **Enter data in grid rows**
   - Tab between cells
   - Enter to move to next row
   - Add rows as needed
3. **Paste from spreadsheet** (supported)
4. **Review entered data**
5. **Click "Create Items"**

### Grid Features

- Keyboard navigation (Tab, Enter, Arrow keys)
- Copy/paste from Excel/Google Sheets
- Add/remove rows
- Inline validation
- Auto-populate from set number lookup

---

## Technical Details

### Creation Flow

```
User Input → Parse/Validate → API Call → Repository → Database
                                 ↓
                          (If dual-write enabled)
                                 ↓
                          Google Sheets
```

### API Endpoint

**POST /api/inventory**

Accepts single object or array:

```typescript
// Single item
POST /api/inventory
{ "set_number": "75192", "condition": "New", ... }

// Multiple items
POST /api/inventory
[
  { "set_number": "75192", "condition": "New", ... },
  { "set_number": "10294", "condition": "Used", ... }
]
```

### SKU Generation

If SKU is not provided, it's auto-generated:

```
{PREFIX}-{SET_NUMBER}-{TIMESTAMP}

PREFIX: "HB-NEW" or "HB-USED"
SET_NUMBER: The LEGO set number
TIMESTAMP: Base36 encoded timestamp

Example: HB-NEW-75192-1A2B3C4D
```

For bulk creates with index:
```
HB-NEW-75192-1A2B3C4D-001
HB-NEW-75192-1A2B3C4D-002
```

### Validation Rules

| Field | Validation |
|-------|------------|
| set_number | Required, non-empty string |
| condition | Must be "New" or "Used" if provided |
| status | Must be valid status enum |
| cost | Must be positive number if provided |
| listing_value | Must be positive number if provided |

### Error Handling

- **Validation errors:** Displayed inline with field
- **API errors:** Toast notification with retry option
- **Partial failures:** In bulk create, successful items are saved, failures reported

## Source Files

| File | Purpose |
|------|---------|
| [inventory/new/page.tsx](apps/web/src/app/(dashboard)/inventory/new/page.tsx) | Add inventory page |
| [InventoryAddTabs.tsx](apps/web/src/components/features/inventory/InventoryAddTabs.tsx) | Tab interface |
| [InventoryForm.tsx](apps/web/src/components/features/inventory/InventoryForm.tsx) | Single item form |
| [NaturalLanguageInput.tsx](apps/web/src/components/features/inventory/NaturalLanguageInput.tsx) | AI-powered input |
| [PhotoInput.tsx](apps/web/src/components/features/inventory/PhotoInput.tsx) | Photo analysis input |
| [CsvImportWizard.tsx](apps/web/src/components/features/inventory/CsvImportWizard.tsx) | CSV import |
| [BulkEntryGrid.tsx](apps/web/src/components/features/inventory/BulkEntryGrid.tsx) | Grid entry |
| [use-parse-inventory.ts](apps/web/src/hooks/use-parse-inventory.ts) | AI parsing hook |
| [inventory.service.ts](apps/web/src/lib/services/inventory.service.ts) | Business logic |

## Related Journeys

- [Viewing Inventory](./viewing-inventory.md) - View created items
- [Bulk Operations](./bulk-operations.md) - Edit items after creation
