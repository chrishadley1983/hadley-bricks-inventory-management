# Feature Specification: home-costs

**Generated:** 2026-01-22
**Based on:** done-criteria.md (86 criteria)
**Status:** READY_FOR_BUILD

---

## 1. Summary

This feature adds a "Home Costs" configuration UI accessible from the Profit & Loss report page (`/reports/profit-loss`). Users can configure three types of allowable home working expenses: Use of Home (HMRC simplified flat rate), Phone & Broadband (with business use percentages), and Insurance (business proportion of home contents). The costs are stored with date ranges and automatically integrated into the P&L calculation as a new expense category appearing after the existing "Bills" category.

The implementation follows the existing P&L service patterns by adding a new `'Home Costs'` category with query functions that fetch from the new `home_costs` table. The UI uses a modal dialog with tabs for each cost type, matching existing shadcn/ui patterns.

---

## 2. Criteria Mapping

| Criterion | Implementation Approach |
|-----------|------------------------|
| F1-F5 | Create `home_costs` and `home_costs_settings` tables via Supabase migration with RLS policies |
| F6-F11 | Create API routes at `/api/home-costs/` following existing CRUD patterns |
| F12-F20 | Add primary button to P&L toolbar, implement modal with shadcn Dialog + Tabs |
| F21-F31 | Build UseOfHomeTab component with radio group, month pickers, calculated displays |
| F32-F44 | Build PhoneBroadbandTab with table, add/edit dialog, preset dropdown |
| F45-F56 | Build InsuranceTab with form inputs, calculated fields, validation |
| F57-F60 | Build SettingsTab with radio group for display mode |
| F61-F70 | Extend P&L service with `'Home Costs'` category, add query function for `home_costs` table |
| E1-E8 | Add Zod validation in API routes, toast notifications via Sonner |
| P1-P2 | Instant modal open (no skeleton), client-side state in modal |
| U1-U6 | Use shadcn/ui components throughout, consistent formatting |

---

## 3. Architecture

### 3.1 Integration Points

#### UI Integration
**Location:** `apps/web/src/app/(dashboard)/reports/profit-loss/page.tsx`
**Current State:** Has toolbar with export buttons, uses useProfitLossReport hook
**Integration:** Add "Home Costs" primary button to toolbar that opens modal
**Risk:** Low - additive change to existing toolbar

#### Data Integration
**Location:** `apps/web/src/lib/services/profit-loss-report.service.ts`
**Current State:** Has `getRowDefinitions()` returning array of `RowDefinition` objects
**Integration:** Add new category `'Home Costs'` with row definitions for Use of Home, Phone & Broadband, Insurance
**Risk:** Low - additive change following existing patterns

#### API Integration
**Location:** `apps/web/src/app/api/` (new routes)
**Current State:** Has CRUD patterns for similar resources (cost-modelling, etc.)
**Integration:** Create `/api/home-costs/` route structure
**Risk:** Low - new routes, no modification to existing

### 3.2 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              P&L Report Page                                 │
│  /reports/profit-loss                                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Toolbar                                                                │  │
│  │  [Date Range ▼]  [Home Costs]  [Export for MTD ▼]                     │  │
│  │                        │                                               │  │
│  └────────────────────────┼───────────────────────────────────────────────┘  │
│                           │                                                  │
│                           │ onClick                                          │
│                           ▼                                                  │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ HomeCostsModal (Dialog)                                                │  │
│  │ ┌─────────────────────────────────────────────────────────────────┐   │  │
│  │ │ Tabs                                                             │   │  │
│  │ │ [Use of Home] [Phone & Broadband] [Insurance] [Settings]        │   │  │
│  │ ├─────────────────────────────────────────────────────────────────┤   │  │
│  │ │                                                                  │   │  │
│  │ │ Tab Content (varies by tab)                                     │   │  │
│  │ │                                                                  │   │  │
│  │ │ [Delete] (if entry exists)                    [Save]            │   │  │
│  │ └─────────────────────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                           │                                                  │
│                           │ onSave                                           │
│                           ▼                                                  │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ P&L Report Table                                                       │  │
│  │ ...                                                                    │  │
│  │ ├─ Bills                                                              │  │
│  │ │   └─ Mileage                                                        │  │
│  │ ├─ Home Costs ← NEW CATEGORY                                         │  │
│  │ │   ├─ Use of Home           £26.00  £26.00  ...                     │  │
│  │ │   ├─ Phone & Broadband     £46.00  £46.00  ...                     │  │
│  │ │   └─ Insurance              £4.00   £4.00  ...                     │  │
│  │ └─ TOTALS                                                             │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              API Layer                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  GET  /api/home-costs          → List all costs + settings                  │
│  POST /api/home-costs          → Create new cost entry                      │
│  PATCH /api/home-costs/:id     → Update existing cost entry                 │
│  DELETE /api/home-costs/:id    → Delete cost entry                          │
│  PATCH /api/home-costs/settings → Update display mode setting               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              Data Layer                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  home_costs                           home_costs_settings                   │
│  ├─ id (UUID PK)                      ├─ user_id (UUID PK, FK)              │
│  ├─ user_id (UUID FK)                 ├─ display_mode ('separate'|'consol') │
│  ├─ cost_type (ENUM)                  └─ updated_at                         │
│  ├─ description (nullable)                                                  │
│  ├─ start_date (DATE)                                                       │
│  ├─ end_date (DATE nullable)                                                │
│  ├─ hours_per_month (for use_of_home)                                       │
│  ├─ monthly_cost (for phone_broadband)                                      │
│  ├─ business_percent                                                        │
│  ├─ annual_premium (for insurance)                                          │
│  ├─ business_stock_value                                                    │
│  ├─ total_contents_value                                                    │
│  ├─ created_at                                                              │
│  └─ updated_at                                                              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Technology Decisions

#### Modal Component (F12-F20)
**Decision:** Use shadcn/ui `Dialog` component with `Tabs` inside
**Rationale:**
- Already used in the codebase (ArbitrageDetailModal pattern)
- Built-in accessibility (Radix primitives)
- Disable backdrop close via `onInteractOutside` handler

#### Month Picker (F22, F23, F38, F49)
**Options:**
A) Use `Select` component with month options (existing pattern in P&L page)
B) Create custom MonthPicker with Popover + Calendar
C) Use native date input with month type

**Decision:** Option A - Use `Select` with generated month options
**Rationale:**
- Matches existing P&L page pattern
- Simple implementation
- Consistent UX

#### Per-Tab Save (F19)
**Decision:** Each tab manages its own state and has its own Save button
**Rationale:**
- User confirmed per-tab saving requirement
- Simpler mental model - save what you're looking at
- No need to track dirty state across tabs

#### P&L Service Integration (F61-F70)
**Decision:** Add new category to `ProfitLossCategory` type and `getRowDefinitions()`
**Rationale:**
- Follows existing pattern exactly
- Minimal code changes
- Automatic aggregation by the existing report logic

#### Display Mode (F66-F67)
**Decision:** Query `home_costs_settings.display_mode` in P&L service and conditionally aggregate
**Rationale:**
- Keep logic in service layer, not UI
- Single source of truth for P&L data

---

## 4. File Changes

### 4.1 New Files

| File | Purpose | Est. Lines |
|------|---------|------------|
| `supabase/migrations/[timestamp]_home_costs_tables.sql` | Database schema + RLS | 80-100 |
| `apps/web/src/app/api/home-costs/route.ts` | GET (list) + POST (create) | 120-150 |
| `apps/web/src/app/api/home-costs/[id]/route.ts` | PATCH (update) + DELETE | 80-100 |
| `apps/web/src/app/api/home-costs/settings/route.ts` | PATCH settings | 50-60 |
| `apps/web/src/components/features/home-costs/HomeCostsModal.tsx` | Main modal container | 100-120 |
| `apps/web/src/components/features/home-costs/UseOfHomeTab.tsx` | Use of Home form | 150-180 |
| `apps/web/src/components/features/home-costs/PhoneBroadbandTab.tsx` | Phone & Broadband form | 200-250 |
| `apps/web/src/components/features/home-costs/InsuranceTab.tsx` | Insurance form | 150-180 |
| `apps/web/src/components/features/home-costs/SettingsTab.tsx` | Display mode settings | 60-80 |
| `apps/web/src/components/features/home-costs/index.ts` | Barrel export | 10 |
| `apps/web/src/hooks/use-home-costs.ts` | TanStack Query hooks | 100-120 |
| `apps/web/src/lib/types/home-costs.ts` | TypeScript types | 50-60 |

### 4.2 Modified Files

| File | Changes | Est. Lines Changed |
|------|---------|-------------------|
| `apps/web/src/app/(dashboard)/reports/profit-loss/page.tsx` | Add Home Costs button + modal | 30-40 |
| `apps/web/src/lib/services/profit-loss-report.service.ts` | Add Home Costs category + query | 80-100 |
| `packages/database/src/types.ts` | Add generated types (after migration) | Auto-generated |

### 4.3 No Changes Needed

| File | Reason |
|------|--------|
| `apps/web/src/hooks/use-reports.ts` | Existing useProfitLossReport hook works as-is |
| `apps/web/src/components/ui/*` | All needed UI components exist |

---

## 5. Implementation Details

### 5.1 Database Schema

```sql
-- Migration: [timestamp]_home_costs_tables.sql

-- Home costs table (polymorphic for all cost types)
CREATE TABLE home_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Discriminator
  cost_type TEXT NOT NULL CHECK (cost_type IN ('use_of_home', 'phone_broadband', 'insurance')),

  -- Common fields
  description TEXT, -- Required for phone_broadband only
  start_date DATE NOT NULL,
  end_date DATE, -- NULL = ongoing

  -- Use of Home fields
  hours_per_month TEXT CHECK (hours_per_month IN ('25-50', '51-100', '101+') OR hours_per_month IS NULL),

  -- Phone & Broadband fields
  monthly_cost DECIMAL(10,2),
  business_percent INTEGER CHECK (business_percent IS NULL OR (business_percent >= 1 AND business_percent <= 100)),

  -- Insurance fields
  annual_premium DECIMAL(10,2),
  business_stock_value DECIMAL(10,2),
  total_contents_value DECIMAL(10,2),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT check_use_of_home CHECK (
    cost_type != 'use_of_home' OR (hours_per_month IS NOT NULL)
  ),
  CONSTRAINT check_phone_broadband CHECK (
    cost_type != 'phone_broadband' OR (
      description IS NOT NULL AND
      monthly_cost IS NOT NULL AND
      business_percent IS NOT NULL
    )
  ),
  CONSTRAINT check_insurance CHECK (
    cost_type != 'insurance' OR (
      annual_premium IS NOT NULL AND
      business_stock_value IS NOT NULL AND
      total_contents_value IS NOT NULL AND
      business_stock_value <= total_contents_value
    )
  ),
  CONSTRAINT check_end_date CHECK (end_date IS NULL OR end_date >= start_date)
);

-- Index for efficient monthly lookups
CREATE INDEX idx_home_costs_user_dates ON home_costs(user_id, start_date, end_date);
CREATE INDEX idx_home_costs_type ON home_costs(user_id, cost_type);

-- Settings table
CREATE TABLE home_costs_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_mode TEXT NOT NULL DEFAULT 'separate' CHECK (display_mode IN ('separate', 'consolidated')),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE home_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_costs_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own home_costs"
  ON home_costs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own home_costs"
  ON home_costs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own home_costs"
  ON home_costs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own home_costs"
  ON home_costs FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own home_costs_settings"
  ON home_costs_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own home_costs_settings"
  ON home_costs_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own home_costs_settings"
  ON home_costs_settings FOR UPDATE
  USING (auth.uid() = user_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_home_costs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER home_costs_updated_at
  BEFORE UPDATE ON home_costs
  FOR EACH ROW EXECUTE FUNCTION update_home_costs_updated_at();

CREATE TRIGGER home_costs_settings_updated_at
  BEFORE UPDATE ON home_costs_settings
  FOR EACH ROW EXECUTE FUNCTION update_home_costs_updated_at();
```

### 5.2 API Specification

#### GET /api/home-costs

**Purpose:** Fetch all home costs and settings for authenticated user

**Response:**
```typescript
{
  costs: HomeCost[];
  settings: { displayMode: 'separate' | 'consolidated' };
}

interface HomeCost {
  id: string;
  costType: 'use_of_home' | 'phone_broadband' | 'insurance';
  description?: string;
  startDate: string; // 'YYYY-MM'
  endDate: string | null; // 'YYYY-MM' or null

  // Use of Home
  hoursPerMonth?: '25-50' | '51-100' | '101+';

  // Phone & Broadband
  monthlyCost?: number;
  businessPercent?: number;

  // Insurance
  annualPremium?: number;
  businessStockValue?: number;
  totalContentsValue?: number;

  createdAt: string;
  updatedAt: string;
}
```

#### POST /api/home-costs

**Purpose:** Create new home cost entry

**Validation (Zod):**
```typescript
const CreateHomeCostSchema = z.discriminatedUnion('costType', [
  z.object({
    costType: z.literal('use_of_home'),
    hoursPerMonth: z.enum(['25-50', '51-100', '101+']),
    startDate: z.string().regex(/^\d{4}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
  }),
  z.object({
    costType: z.literal('phone_broadband'),
    description: z.enum(['Mobile Phone', 'Home Broadband', 'Landline']),
    monthlyCost: z.number().positive(),
    businessPercent: z.number().int().min(1).max(100),
    startDate: z.string().regex(/^\d{4}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
  }),
  z.object({
    costType: z.literal('insurance'),
    annualPremium: z.number().positive(),
    businessStockValue: z.number().positive(),
    totalContentsValue: z.number().positive(),
    startDate: z.string().regex(/^\d{4}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
  }),
]).refine(
  (data) => !data.endDate || data.endDate >= data.startDate,
  { message: 'End date must be after start date' }
).refine(
  (data) => data.costType !== 'insurance' || data.businessStockValue <= data.totalContentsValue,
  { message: 'Business stock value cannot exceed total contents value' }
);
```

### 5.3 P&L Service Integration

Add to `profit-loss-report.service.ts`:

```typescript
// Add to ProfitLossCategory type
export type ProfitLossCategory =
  | 'Income'
  | 'Selling Fees'
  | 'Stock Purchase'
  | 'Packing & Postage'
  | 'Bills'
  | 'Home Costs'; // NEW

// Add to categoryConfig in page.tsx
'Home Costs': { order: 6, color: 'bg-teal-50' }, // NEW - after Bills

// Add query function
async function queryHomeCosts(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string,
  costType: 'use_of_home' | 'phone_broadband' | 'insurance'
): Promise<MonthlyAggregation[]> {
  const { data, error } = await supabase
    .from('home_costs')
    .select('*')
    .eq('user_id', userId)
    .eq('cost_type', costType);

  if (error) throw error;

  // Generate months in range
  const months = generateMonthRange(
    startDate.substring(0, 7),
    endDate.substring(0, 7)
  );

  // Calculate monthly amounts
  const monthMap = new Map<string, number>();

  for (const month of months) {
    let total = 0;

    for (const cost of data || []) {
      if (!isActiveInMonth(cost, month)) continue;

      switch (costType) {
        case 'use_of_home':
          total += getMonthlyRate(cost.hours_per_month);
          break;
        case 'phone_broadband':
          total += (cost.monthly_cost || 0) * ((cost.business_percent || 0) / 100);
          break;
        case 'insurance':
          const annualClaimable = (cost.annual_premium || 0) *
            ((cost.business_stock_value || 0) / (cost.total_contents_value || 1));
          total += annualClaimable / 12;
          break;
      }
    }

    if (total > 0) {
      monthMap.set(month, total);
    }
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({
    month,
    total,
  }));
}

function isActiveInMonth(cost: HomeCostRow, targetMonth: string): boolean {
  const start = cost.start_date.substring(0, 7);
  const end = cost.end_date?.substring(0, 7) || null;

  if (targetMonth < start) return false;
  if (end && targetMonth > end) return false;
  return true;
}

function getMonthlyRate(hours: string | null): number {
  switch (hours) {
    case '25-50': return 10;
    case '51-100': return 18;
    case '101+': return 26;
    default: return 0;
  }
}

// Add row definitions (in getRowDefinitions)
// HOME COSTS
{
  category: 'Home Costs',
  transactionType: 'Use of Home',
  queryFn: (supabase, userId, startDate, endDate) =>
    queryHomeCosts(supabase, userId, startDate, endDate, 'use_of_home'),
  signMultiplier: -1,
},
{
  category: 'Home Costs',
  transactionType: 'Phone & Broadband',
  queryFn: (supabase, userId, startDate, endDate) =>
    queryHomeCosts(supabase, userId, startDate, endDate, 'phone_broadband'),
  signMultiplier: -1,
},
{
  category: 'Home Costs',
  transactionType: 'Insurance',
  queryFn: (supabase, userId, startDate, endDate) =>
    queryHomeCosts(supabase, userId, startDate, endDate, 'insurance'),
  signMultiplier: -1,
},
```

### 5.4 Component Specification

#### HomeCostsModal

```typescript
interface HomeCostsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: () => void; // Called after any save to trigger P&L refresh
}

// Usage in page.tsx:
const [homeCostsModalOpen, setHomeCostsModalOpen] = useState(false);
const queryClient = useQueryClient();

const handleHomeCostsSave = () => {
  // Invalidate P&L query to refresh data
  queryClient.invalidateQueries({ queryKey: ['reports', 'profit-loss'] });
};

// In JSX:
<Button onClick={() => setHomeCostsModalOpen(true)}>
  Home Costs
</Button>

<HomeCostsModal
  open={homeCostsModalOpen}
  onOpenChange={setHomeCostsModalOpen}
  onSave={handleHomeCostsSave}
/>
```

#### UseOfHomeTab

```typescript
interface UseOfHomeTabProps {
  initialData?: UseOfHomeCost | null;
  onSave: () => void;
}

// State:
// - selectedTier: '25-50' | '51-100' | '101+' | null
// - startDate: string (YYYY-MM)
// - endDate: string | null
// - isOngoing: boolean
// - existingEntryId: string | null

// UI Elements:
// - RadioGroup for tier selection
// - Select for start month
// - Checkbox for "Ongoing" + conditional Select for end month
// - Calculated displays: Monthly Allowance, Annual Estimate
// - Save button
// - Delete button (if existingEntryId)
```

---

## 6. Build Order

### Step 1: Database Schema (F1-F5)
Create migration file and push to Supabase.
- Create `home_costs` table
- Create `home_costs_settings` table
- Add RLS policies
- Add indexes
- Regenerate TypeScript types

**Verification:** Run SQL query to confirm tables exist

### Step 2: API Routes (F6-F11)
Create API routes for CRUD operations.
- `GET /api/home-costs` - List all + settings
- `POST /api/home-costs` - Create with validation
- `PATCH /api/home-costs/:id` - Update
- `DELETE /api/home-costs/:id` - Delete
- `PATCH /api/home-costs/settings` - Update display mode

**Verification:** Test endpoints with curl/Postman

### Step 3: React Query Hooks (F6-F11)
Create TanStack Query hooks.
- `useHomeCosts()` - Fetch costs and settings
- `useCreateHomeCost()` - Mutation
- `useUpdateHomeCost()` - Mutation
- `useDeleteHomeCost()` - Mutation
- `useUpdateHomeCostsSettings()` - Mutation

**Verification:** Test hooks in component

### Step 4: Modal Structure (F12-F20)
Create HomeCostsModal with tabs framework.
- Dialog component with disabled backdrop close
- Tabs with 4 tab triggers
- Tab content placeholders
- X button close

**Verification:** Modal opens/closes, tabs switch

### Step 5: Use of Home Tab (F21-F31)
Build complete Use of Home functionality.
- Radio group for hours tier
- Month pickers with ongoing option
- Calculated displays
- Save/Delete operations
- Overlap validation
- Success toasts

**Verification:** Can create, edit, delete Use of Home entries

### Step 6: Phone & Broadband Tab (F32-F44)
Build complete Phone & Broadband functionality.
- Cost list table
- Add/Edit dialog with preset dropdown
- Calculated claimable display
- Per-description overlap validation
- Total displays

**Verification:** Can manage multiple phone/broadband costs

### Step 7: Insurance Tab (F45-F56)
Build complete Insurance functionality.
- Form with three inputs
- Calculated proportion and claimable
- Validation (stock <= total)
- Single-entry overlap validation

**Verification:** Can manage insurance entry

### Step 8: Settings Tab (F57-F60)
Build Settings functionality.
- Radio group for display mode
- Save persists to database

**Verification:** Display mode changes persist

### Step 9: P&L Integration (F61-F70)
Integrate home costs into P&L calculations.
- Add `'Home Costs'` category
- Add query function
- Add row definitions
- Handle display mode (separate vs consolidated)
- Add category color

**Verification:** Home costs appear in P&L report

### Step 10: Validation & Error Handling (E1-E8)
Add comprehensive validation.
- Required field validation
- Range validation
- API error handling
- Toast notifications

**Verification:** All validation errors show toasts

### Step 11: UI Polish (U1-U6)
Final UI refinements.
- Currency formatting
- Percentage formatting
- Primary button styling
- Read-only field styling

**Verification:** Visual inspection, format checks

---

## 7. Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| P&L query performance with new table | Low | Medium | Index on user_id + dates exists |
| Date range overlap validation complexity | Medium | Low | Server-side validation with clear error messages |
| Display mode consolidation logic | Low | Medium | Keep logic in service layer, test thoroughly |

### Scope Risks

| Risk | Probability | Mitigation |
|------|-------------|------------|
| Scope creep to add more cost types | Low | done-criteria.md is the contract - only 3 types |
| Request to add QuickFile export | Medium | Explicitly out of scope - future feature |

### Integration Risks

| Risk | Probability | Mitigation |
|------|-------------|------------|
| P&L service refactoring breaks integration | Low | Follow existing patterns exactly |
| Modal state conflicts with page state | Low | Modal manages own state, only invalidates queries on save |

---

## 8. Feasibility Validation

| Criterion | Feasible | Confidence | Notes |
|-----------|----------|------------|-------|
| F1-F5 (Database) | ✅ Yes | High | Standard Supabase migration |
| F6-F11 (API) | ✅ Yes | High | Follows existing patterns |
| F12-F20 (Modal) | ✅ Yes | High | shadcn Dialog + Tabs exist |
| F21-F31 (Use of Home) | ✅ Yes | High | Standard form with validation |
| F32-F44 (Phone & Broadband) | ✅ Yes | High | Table + dialog pattern exists |
| F45-F56 (Insurance) | ✅ Yes | High | Standard form with calculations |
| F57-F60 (Settings) | ✅ Yes | High | Simple radio group |
| F61-F70 (P&L Integration) | ✅ Yes | High | Follows existing row definition pattern |
| E1-E8 (Validation) | ✅ Yes | High | Zod + toast pattern exists |
| P1-P2 (Performance) | ✅ Yes | High | No heavy operations |
| U1-U6 (UI/UX) | ✅ Yes | High | shadcn components available |

**Overall:** All 86 criteria feasible with planned approach. ✅

---

## 9. Notes for Build Agent

### Key Patterns to Follow

1. **API Routes:** See `apps/web/src/app/api/cost-modelling/scenarios/` for similar CRUD patterns

2. **Modal Pattern:** See `apps/web/src/components/features/arbitrage/` for Dialog usage

3. **P&L Service:** The `getRowDefinitions()` function is the key integration point - add new entries at the end after Bills

4. **Query Invalidation:** After any save operation, invalidate `['reports', 'profit-loss']` to refresh the P&L display

5. **Month Format:** Use `YYYY-MM` format throughout (e.g., "2024-04"), convert to first/last of month for database

6. **Overlap Validation:** Check overlaps server-side in POST/PATCH handlers - return 400 with clear error message

### Constraints

- **Per-tab save:** Each tab saves independently - no modal-level save button
- **No backdrop close:** Modal only closes via X button
- **Preset descriptions:** Phone & Broadband has exactly 3 presets: "Mobile Phone", "Home Broadband", "Landline"
- **Single entries:** Use of Home and Insurance allow only one non-overlapping entry at a time

### Testing Hints

- Test overlap validation by creating entry Apr-Dec, then trying to create Jun-Aug
- Test display mode by toggling and verifying P&L shows 3 lines (separate) or 1 line (consolidated)
- Test date boundary: cost starting Jan should not appear in Dec P&L

---

## Handoff

Ready for: `/build-feature home-costs`

**Summary:**
- 12 new files to create
- 2 files to modify
- ~1,500 lines of code estimated
- No external dependencies needed
- Database migration required first

**Build order:**
1. Database migration (critical path)
2. API routes
3. Hooks + Types
4. Modal + Tabs structure
5. Individual tabs (Use of Home → Phone & Broadband → Insurance → Settings)
6. P&L integration
7. Validation & polish

**Risks flagged:** 0 blockers, 3 low-medium risks all mitigated
