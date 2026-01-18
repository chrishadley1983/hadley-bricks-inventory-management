# User Journey: Bulk Operations

> **Journey:** Edit or delete multiple inventory items at once
> **Entry Point:** `/inventory` (with items selected)
> **Complexity:** Medium

## Overview

Bulk operations allow users to efficiently modify multiple inventory items simultaneously. This is essential for managing large inventories where updating items one-by-one would be impractical.

## Available Operations

| Operation | Description |
|-----------|-------------|
| **Bulk Edit** | Update one or more fields across all selected items |
| **Bulk Delete** | Remove all selected items from inventory |
| **Bulk Status Change** | Quick status update for selected items |

---

## Bulk Edit

### User Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                      /inventory                                     │
├─────────────────────────────────────────────────────────────────────┤
│  [Actions Bar when items selected]                                  │
│  ┌──────────────────────────────────────────────────────────────────┐
│  │ 5 items selected │ [Bulk Edit] │ [Delete] │ [Clear Selection]   │
│  └──────────────────────────────────────────────────────────────────┘
├─────────────────────────────────────────────────────────────────────┤
│  [Inventory Table with checkboxes]                                  │
│  ☑ │ 75192 │ Millennium Falcon │ New │ BACKLOG │ ...               │
│  ☑ │ 10294 │ Titanic │ Used │ BACKLOG │ ...                        │
│  ☐ │ 42100 │ Liebherr │ New │ LISTED │ ...                         │
│  ☑ │ 75313 │ AT-AT │ New │ BACKLOG │ ...                           │
│  ...                                                                │
└─────────────────────────────────────────────────────────────────────┘
```

### Steps

1. **Select Items**
   - Click checkboxes next to items to select
   - Or click header checkbox to select all visible items

2. **Click "Bulk Edit"**
   - Opens Bulk Edit Dialog modal

3. **Enable Fields to Update**
   - Each field has a checkbox - only checked fields will be modified
   - This prevents accidental overwrites

4. **Set New Values**
   - Enter the new value for each enabled field
   - Values apply to ALL selected items

5. **Click "Update X Items"**
   - Confirmation with item count
   - Button disabled until at least one field is enabled

6. **Items Updated**
   - Toast notification on success
   - Table refreshes with new values
   - Selection cleared

### Editable Fields

| Field | Description | Notes |
|-------|-------------|-------|
| **Status** | Item status | Dropdown: Not Yet Received, Backlog, Listed, Sold |
| **Condition** | New or Used | Dropdown selection |
| **Source** | Purchase source | Free text |
| **Listing Platform** | Where listed | Dropdown: eBay, Amazon, BrickLink, etc. |
| **Amazon ASIN** | Amazon identifier | Text input for Amazon listings |
| **Storage Location** | Physical location | Free text |
| **Linked Purchase** | Purchase record | Lookup with search and create option |
| **Purchase Date** | When purchased | Date picker |
| **Notes** | Additional info | Textarea |

### Bulk Edit Dialog UI

```
┌─────────────────────────────────────────────────────────────────────┐
│  Bulk Edit 5 Items                                              ✕   │
├─────────────────────────────────────────────────────────────────────┤
│  Select the fields you want to update. Only checked fields will    │
│  be modified.                                                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ☑ Status                                                          │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ Backlog                                                    ▼   │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ☐ Condition                                                       │
│                                                                     │
│  ☑ Storage Location                                                │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ Shelf A3                                                       │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ☑ Linked Purchase                                                 │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ [Search purchases...] or [Create New]                          │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ... more fields ...                                               │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                      [Cancel]  [Update 5 Items]    │
└─────────────────────────────────────────────────────────────────────┘
```

### Purchase Lookup Feature

When linking to a purchase:

1. **Search existing purchases**
   - Type to search by description, reference, or date
   - Results show with cost and items linked count

2. **Select from results**
   - Click to select purchase
   - Shows selected purchase details

3. **Or create new purchase**
   - Click "Create New" to open Quick Purchase Dialog
   - Creates purchase and auto-links

---

## Bulk Delete

### Steps

1. **Select Items** to delete
2. **Click "Delete"** button
3. **Confirm in dialog**
   - Shows count of items to be deleted
   - Warning about irreversibility
4. **Items Deleted**
   - Removed from database
   - Table refreshes
   - Toast notification

### Confirmation Dialog

```
┌─────────────────────────────────────────────────────────────────────┐
│  Delete 5 Items                                                 ✕   │
├─────────────────────────────────────────────────────────────────────┤
│  ⚠️ This action cannot be undone.                                  │
│                                                                     │
│  Are you sure you want to delete 5 inventory items?                │
├─────────────────────────────────────────────────────────────────────┤
│                                      [Cancel]  [Delete 5 Items]    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Technical Details

### Bulk Update API

**PUT /api/inventory/bulk**

```typescript
// Request
{
  "ids": ["uuid-1", "uuid-2", "uuid-3"],
  "updates": {
    "status": "LISTED",
    "storage_location": "Shelf A3"
  }
}

// Response
{
  "data": [
    { /* updated item 1 */ },
    { /* updated item 2 */ },
    { /* updated item 3 */ }
  ]
}
```

### Bulk Delete API

**DELETE /api/inventory/bulk**

```typescript
// Request
{
  "ids": ["uuid-1", "uuid-2", "uuid-3"]
}

// Response
{
  "count": 3
}
```

### React Query Integration

```typescript
// Bulk update hook
const bulkUpdateMutation = useMutation({
  mutationFn: (input: BulkUpdateInput) => bulkUpdateInventoryItems(input),
  onSuccess: (result) => {
    // Update individual items in cache
    result.data.forEach((item) => {
      queryClient.setQueryData(inventoryKeys.detail(item.id), item);
    });
    // Invalidate list queries
    queryClient.invalidateQueries({ queryKey: inventoryKeys.lists() });
    queryClient.invalidateQueries({ queryKey: inventoryKeys.summary() });
  },
});

// Bulk delete hook
const bulkDeleteMutation = useMutation({
  mutationFn: (ids: string[]) => bulkDeleteInventoryItems(ids),
  onSuccess: (_, deletedIds) => {
    // Remove from cache
    deletedIds.forEach((id) => {
      queryClient.removeQueries({ queryKey: inventoryKeys.detail(id) });
    });
    // Invalidate list queries
    queryClient.invalidateQueries({ queryKey: inventoryKeys.lists() });
    queryClient.invalidateQueries({ queryKey: inventoryKeys.summary() });
  },
});
```

### Performance Considerations

1. **Single Database Query**
   - Updates use `UPDATE ... WHERE id IN (...)`
   - Deletes use `DELETE ... WHERE id IN (...)`
   - Much faster than individual updates

2. **Dual-Write Batching**
   - Google Sheets writes batched in groups of 5
   - Prevents rate limiting
   - Fire-and-forget (non-blocking)

3. **Cache Invalidation**
   - Only list and summary queries invalidated
   - Individual item details updated directly in cache

### Error Handling

- **Partial failures:** Not supported - all or nothing
- **Validation errors:** Returns 400 with error details
- **Database errors:** Returns 500, original data unchanged

## Source Files

| File | Purpose |
|------|---------|
| [BulkEditDialog.tsx](apps/web/src/components/features/inventory/BulkEditDialog.tsx) | Bulk edit modal |
| [PurchaseLookup.tsx](apps/web/src/components/features/inventory/PurchaseLookup.tsx) | Purchase search/select |
| [QuickPurchaseDialog.tsx](apps/web/src/components/features/inventory/QuickPurchaseDialog.tsx) | Create purchase inline |
| [use-inventory.ts](apps/web/src/hooks/use-inventory.ts#L138-173) | Bulk mutation hooks |
| [inventory.repository.ts](apps/web/src/lib/repositories/inventory.repository.ts#L496-549) | Bulk update implementation |
| [inventory.repository.ts](apps/web/src/lib/repositories/inventory.repository.ts#L554-565) | Bulk delete implementation |

## Related Journeys

- [Viewing Inventory](./viewing-inventory.md) - Selection and filtering
- [Adding Inventory](./adding-inventory.md) - Creating items to edit
