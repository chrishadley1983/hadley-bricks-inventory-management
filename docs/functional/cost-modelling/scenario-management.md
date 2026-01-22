# Journey: Scenario Management

> **Entry Point:** `/cost-modelling`
> **Prerequisites:** None
> **Complexity:** Low

## Purpose

Create and manage P&L projection scenarios. Save different business models, duplicate scenarios for what-if analysis, and organise your financial planning with named scenarios.

---

## Key Concepts

### Scenario Lifecycle

| State | Description |
|-------|-------------|
| **New** | Created with default values |
| **Saved** | Persisted to database |
| **Draft** | Unsaved changes auto-stored locally |
| **Deleted** | Permanently removed |

### Naming Rules

- Names must be unique per user
- Maximum 255 characters
- Description is optional

---

## User Flow

### Step 1: View Scenarios

1. Navigate to `/cost-modelling`
2. **Scenario Selector** dropdown shows all saved scenarios
3. Current scenario name displayed in header
4. Default scenario auto-created if none exist

### Step 2: Create New Scenario

1. Click **+ New Scenario** button
2. Dialog opens with name input
3. Enter a unique name (e.g., "High Volume 2026")
4. Optionally add description
5. Click **Create**
6. New scenario opens with default values

### Step 3: Duplicate Scenario

1. Load the scenario you want to copy
2. Click **More** menu (three dots)
3. Select **Duplicate**
4. Enter name for the copy
5. Click **Duplicate**
6. New scenario opens with copied values

### Step 4: Rename Scenario

1. Click **More** menu (three dots)
2. Select **Rename**
3. Edit the name
4. Optionally update description
5. Click **Save**

### Step 5: Delete Scenario

1. Click **More** menu (three dots)
2. Select **Delete**
3. Confirm deletion in dialog
4. Scenario is permanently removed
5. Another scenario is auto-selected

**Note:** You cannot delete your last remaining scenario.

---

## Auto-Save Draft

The system automatically saves your work:

1. Every 30 seconds while editing
2. Draft stored against scenario ID
3. On return, "Restore Draft?" dialog appears
4. Choose **Restore** to continue where you left
5. Choose **Discard** to load saved version
6. Draft cleared after successful save

---

## Conflict Detection

When saving, the system checks for concurrent edits:

1. Your save includes `knownUpdatedAt` timestamp
2. Server compares with current `updated_at`
3. If different, conflict error returned
4. Dialog shows "Modified elsewhere" warning
5. Click **Refresh** to load latest version
6. Re-apply your changes if needed

---

## Default Scenario Values

New scenarios are created with these defaults:

### Sales Volume
| Platform | Sales/Month | Avg Value | Postage |
|----------|-------------|-----------|---------|
| BrickLink | 50 | £25 | £3.50 |
| Amazon | 30 | £40 | £4.00 |
| eBay | 40 | £30 | £3.50 |

### Fee Rates
| Platform | Rate |
|----------|------|
| BrickLink | 10% |
| Amazon | 18.3% |
| eBay | 20% |

### COG Percentages
| Platform | COG % |
|----------|-------|
| BrickLink | 20% |
| Amazon | 35% |
| eBay | 30% |

### Fixed Costs (Monthly)
| Cost | Amount |
|------|--------|
| Shopify | £0 |
| eBay Store | £25 |
| Seller Tools | £20 |
| Amazon | £25 |
| Storage | £0 |

### Tax Settings
| Setting | Value |
|---------|-------|
| Target Profit | £30,000 |
| Personal Allowance | £12,570 |
| Income Tax Rate | 20% |
| NI Rate | 6% |

---

## API Reference

### POST /api/cost-modelling/scenarios

Create new scenario.

**Request:**
```json
{
  "name": "Q2 Expansion Plan",
  "description": "Modelling increased Amazon volume"
}
```

**Response (201):**
```json
{
  "data": {
    "id": "uuid",
    "name": "Q2 Expansion Plan",
    "created_at": "2026-01-21T10:00:00Z"
  }
}
```

**Errors:**
- `400` - Name is required
- `409` - Name already exists

### POST /api/cost-modelling/scenarios/[id]/duplicate

Duplicate existing scenario.

**Request:**
```json
{
  "name": "Copy of Q2 Expansion Plan"
}
```

### DELETE /api/cost-modelling/scenarios/[id]

Delete scenario.

**Response (200):**
```json
{
  "success": true
}
```

**Errors:**
- `400` - Cannot delete last scenario
- `404` - Scenario not found

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Name already exists" | Choose a unique name |
| Cannot delete scenario | Must have at least 1 scenario |
| Draft dialog not appearing | Check browser localStorage |
| Conflict on every save | Clear browser cache; reload page |

---

## Source Files

| File | Purpose |
|------|---------|
| [ScenarioSelector.tsx](../../../apps/web/src/components/features/cost-modelling/ScenarioSelector.tsx) | Scenario dropdown |
| [SaveAsDialog.tsx](../../../apps/web/src/components/features/cost-modelling/SaveAsDialog.tsx) | Create/duplicate dialog |
| [EditScenarioDialog.tsx](../../../apps/web/src/components/features/cost-modelling/EditScenarioDialog.tsx) | Rename dialog |
| [DeleteConfirmDialog.tsx](../../../apps/web/src/components/features/cost-modelling/DeleteConfirmDialog.tsx) | Delete confirmation |
| [DraftRestorationDialog.tsx](../../../apps/web/src/components/features/cost-modelling/DraftRestorationDialog.tsx) | Draft restore prompt |

---

## Related Journeys

- [P&L Projection](./pl-projection.md) - Edit scenario values
- [Compare Scenarios](./compare-scenarios.md) - Compare two scenarios
