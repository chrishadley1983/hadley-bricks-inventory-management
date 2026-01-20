# Feature Specification: cost-modelling

**Generated:** 2026-01-18
**Based on:** done-criteria.md (77 criteria)
**Status:** READY_FOR_BUILD

---

## 1. Summary

The Cost Modelling feature is a comprehensive financial projection tool that enables "what-if" scenario planning for the LEGO resale business. Users can create, save, compare, and export multiple scenarios with different assumptions about sales volumes, pricing, platform fees, and costs. The system performs all P&L calculations client-side for instant feedback, persists scenarios to Supabase, and provides PDF/CSV export capabilities. The feature spans 5 phases: Core Model, Package Matrix, Summary Views, Compare Mode, and Polish/UX.

**Key architectural decisions:**
- **Client-side calculations** for instant feedback (no API calls during input changes)
- **Server-side persistence** for scenarios and drafts
- **jsPDF + autotable** for PDF generation (already installed)
- **Collapsible accordion sections** for assumption inputs (using existing shadcn Accordion)
- **React Hook Form + Zod** for form management and validation

---

## 2. Criteria Mapping

### Phase 1: Core Model & Single Scenario (F1-F24)

| Criterion | Implementation Approach |
|-----------|------------------------|
| F1: Page route exists | Create `/app/(dashboard)/cost-modelling/page.tsx` with client component |
| F2: Database tables | Create migration with `cost_model_scenarios` and `cost_model_package_costs` tables |
| F3: Create scenario | POST endpoint + "+ New" button triggers API call with defaults |
| F4: Load scenario | GET endpoint returns full scenario; dropdown selection triggers fetch |
| F5: Save scenario | PUT endpoint; Save button calls API with current form state |
| F6: Save As | Dialog prompts for name; POST creates new scenario |
| F7: Delete scenario | DELETE endpoint with confirmation dialog |
| F8: Default scenario | On first visit with no scenarios, auto-create default |
| F9-F14: Assumption inputs | Accordion sections with controlled inputs, debounced onChange |
| F15-F21: Calculations | Pure TypeScript functions in `cost-calculations.ts`, called via useMemo |
| F22: Hero metrics | 4 StatCard components in a responsive grid |
| F23: P&L breakdown | Nested Card sections with TreeView-style breakdown |
| F24: Live calculation | useMemo recalculates on form state change (no API) |

### Phase 2: Package Cost Matrix (F25-F30)

| Criterion | Implementation Approach |
|-----------|------------------------|
| F25: Matrix UI | 6-column Table component with editable cells |
| F26: Default values | Seeded via database trigger or repository method on scenario create |
| F27: Editing | Input components within table cells; changes update form state |
| F28: Total calculation | Auto-computed row using useMemo |
| F29: Fixed cost per sale | Derived value: `monthlyFixedCosts / totalMonthlySales` |
| F30: P&L integration | Package costs feed into "Packaging Materials" calculation |

### Phase 3: Summary Views (F31-F34)

| Criterion | Implementation Approach |
|-----------|------------------------|
| F31: Summary tabs | shadcn Tabs component with Daily/Weekly/Monthly |
| F32-F34: Calculations | Derived from annual totals using `/365`, `/52`, direct monthly values |

### Phase 4: Compare Mode (F35-F44)

| Criterion | Implementation Approach |
|-----------|------------------------|
| F35: Toggle | Switch component in header; state controls layout |
| F36: Layout | CSS grid with 2 columns when compare mode on |
| F37: Scenario B dropdown | Second Select populated from scenario list |
| F38: Independent editing | Separate form state objects for A and B |
| F39-F42: Comparison table | Dedicated ComparisonSummary component with delta calculations |
| F43: Delta indicators | ArrowUp/ArrowDown icons with conditional green/red styling |
| F44: Duplicate | POST to `/duplicate` endpoint with "Copy of" prefix |

### Phase 5: Polish & UX (F45-F56)

| Criterion | Implementation Approach |
|-----------|------------------------|
| F45: Unsaved warning | `beforeunload` event + in-app navigation intercept |
| F46: Dirty indicator | Badge/asterisk when `isDirty` from form state |
| F47: Auto-save draft | `useInterval` calls draft API every 30s when dirty |
| F48: Draft restoration | On load, check for draft; show restore/discard dialog |
| F49: Collapsible sections | shadcn Accordion with 6 items (Sales, Fees, COG, Fixed, VAT, Tax) |
| F50: Mobile responsive | Tailwind breakpoints; compare mode stacks on mobile |
| F51-F53: PDF export | jsPDF + autotable; generate P&L summary document |
| F52-F54: CSV export | String-based CSV generation; all fields + calculated values |
| F55: Loading skeleton | `loading.tsx` with PageSkeleton from existing components |
| F56: Modified date | Format `updated_at` in dropdown items |

### Error Handling (E1-E7)

| Criterion | Implementation Approach |
|-----------|------------------------|
| E1: Save error toast | `sonner` toast on catch from mutation |
| E2: Load error state | Error boundary component with retry button |
| E3: Validation | Zod schema with min/max; inline FormMessage |
| E4: Negative prevention | `min={0}` on numeric inputs |
| E5: Delete last prevention | Disable delete when `scenarios.length === 1` |
| E6: Offline handling | `navigator.onLine` check; localStorage draft backup |
| E7: Concurrent edit | Compare `updated_at` on save; show conflict modal |

### Performance (P1-P6)

| Criterion | Implementation Approach |
|-----------|------------------------|
| P1: Page load <3s | Dynamic imports, skeleton loading, minimal initial JS |
| P2: Calc <50ms | Pure functions, memoization, no DOM manipulation |
| P3: List <500ms | Simple SELECT query with user filter |
| P4: Compare render <200ms | Conditional rendering, no heavy re-mounts |
| P5: PDF <5s | Client-side generation with jsPDF |
| P6: CSV <1s | String concatenation, immediate download |

### UI/UX (U1-U10)

| Criterion | Implementation Approach |
|-----------|------------------------|
| U1: shadcn components | Existing Card, Input, Button, Select, Accordion |
| U2: Currency format | `formatCurrency()` utility with `Intl.NumberFormat` |
| U3: Percentage format | Display as "18.3%"; store as decimal (0.183) |
| U4: Labels/tooltips | FormLabel + Tooltip on complex fields |
| U5: Read-only styling | `bg-muted` background, no focus ring |
| U6: Section headings | CardTitle within each Card section |
| U7: Positive/negative | `text-green-600` / `text-red-600` conditional classes |
| U8: 768px responsive | `lg:grid-cols-2` → `grid-cols-1` |
| U9: Focus states | Default shadcn focus-visible styles |
| U10: Loading states | Button `disabled` + spinner icon during mutations |

### Integration (I1-I4)

| Criterion | Implementation Approach |
|-----------|------------------------|
| I1: RLS policies | Migration includes policies for user-owned rows |
| I2: API auth | `createClient()` + `getUser()` check on all endpoints |
| I3: Sidebar link | Add to `reportNavItems` with Calculator icon |
| I4: Page title | `metadata` export or `<title>` in layout |

---

## 3. Architecture

### 3.1 Integration Points

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SIDEBAR                                         │
│                                                                              │
│   [Cost Modelling] ← Add to reportNavItems after "Profit & Loss"            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PAGE: /cost-modelling                                │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ HEADER: ScenarioSelector + Actions (New, Save, SaveAs, Delete)        │  │
│  │         CompareMode Toggle                                             │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│           ┌────────────────────────┼────────────────────────┐               │
│           │ SINGLE MODE            │ COMPARE MODE            │               │
│           │                        │ (2 columns)             │               │
│           ▼                        ▼                         │               │
│  ┌─────────────────┐    ┌─────────────────┬─────────────────┐│               │
│  │ ProfitSummary   │    │ Scenario A      │ Scenario B      ││               │
│  │ (Hero Metrics)  │    │ - ProfitSummary │ - ProfitSummary ││               │
│  └─────────────────┘    │ - Assumptions   │ - Assumptions   ││               │
│           │             │ - PLBreakdown   │ - PLBreakdown   ││               │
│           ▼             └─────────────────┴─────────────────┘│               │
│  ┌─────────────────┐                 │                       │               │
│  │ Assumptions     │                 ▼                       │               │
│  │ (Accordion)     │    ┌─────────────────────────────────┐  │               │
│  │ - Sales         │    │ ComparisonSummary (Deltas)      │  │               │
│  │ - Fees          │    └─────────────────────────────────┘  │               │
│  │ - COG           │                                         │               │
│  │ - Fixed Costs   │                                         │               │
│  │ - VAT           │                                         │               │
│  │ - Tax           │                                         │               │
│  └─────────────────┘                                         │               │
│           │                                                  │               │
│           ▼                                                  │               │
│  ┌─────────────────┐                                         │               │
│  │ PLBreakdown     │                                         │               │
│  │ (TreeView)      │                                         │               │
│  └─────────────────┘                                         │               │
│           │                                                  │               │
│           ▼                                                  │               │
│  ┌─────────────────┐                                         │               │
│  │ PackageCostMatrix│                                        │               │
│  │ (6-column table)│                                         │               │
│  └─────────────────┘                                         │               │
│           │                                                  │               │
│           ▼                                                  │               │
│  ┌─────────────────┐                                         │               │
│  │ SummaryViewTabs │                                         │               │
│  │ Daily/Weekly/Mo │                                         │               │
│  └─────────────────┘                                         │               │
│                                                              │               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API LAYER                                       │
│                                                                              │
│  /api/cost-modelling/scenarios                                               │
│    GET    → List all scenarios for user                                      │
│    POST   → Create new scenario                                              │
│                                                                              │
│  /api/cost-modelling/scenarios/[id]                                          │
│    GET    → Get single scenario with package costs                           │
│    PUT    → Update scenario                                                  │
│    DELETE → Delete scenario                                                  │
│                                                                              │
│  /api/cost-modelling/scenarios/[id]/duplicate                                │
│    POST   → Duplicate scenario with "Copy of" prefix                         │
│                                                                              │
│  /api/cost-modelling/scenarios/[id]/draft                                    │
│    PUT    → Save draft (auto-save)                                           │
│    GET    → Check if draft exists                                            │
│                                                                              │
│  /api/cost-modelling/export/pdf                                              │
│    POST   → Generate PDF from scenario data                                  │
│                                                                              │
│  /api/cost-modelling/export/csv                                              │
│    POST   → Generate CSV from scenario data                                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            DATA LAYER                                        │
│                                                                              │
│  Repository: CostModellingRepository                                         │
│    - findAllByUser(userId)                                                   │
│    - findById(id)                                                            │
│    - create(scenario)                                                        │
│    - update(id, scenario)                                                    │
│    - delete(id)                                                              │
│    - duplicate(id, newName)                                                  │
│    - saveDraft(id, draft)                                                    │
│    - getDraft(id)                                                            │
│                                                                              │
│  Tables (Supabase):                                                          │
│    - cost_model_scenarios (main scenarios)                                   │
│    - cost_model_package_costs (6 rows per scenario)                          │
│                                                                              │
│  RLS Policies:                                                               │
│    - Users can only SELECT/INSERT/UPDATE/DELETE their own scenarios          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Form Library** | React Hook Form + Zod | Project standard, excellent TypeScript support |
| **Calculations** | Client-side useMemo | Instant feedback, no network latency |
| **PDF Generation** | jsPDF + autotable | Already installed, proven in project |
| **Accordion** | shadcn Accordion | Already available at `@/components/ui/accordion` |
| **State Management** | React useState + TanStack Query | Server state in Query, form state in React |
| **Draft Persistence** | Server-side with `draft_data` JSONB column | Cross-device persistence per user request |
| **Comparison View** | CSS Grid 2-column layout | Clean, responsive, no complex state |

### 3.3 Data Flow

```
User Input Change
       │
       ▼
Form State Updates (React useState / useForm)
       │
       ▼
useMemo recalculates ALL derived values
       │
       ├──► Hero Metrics re-render
       ├──► P&L Breakdown re-render
       ├──► Package Matrix totals re-render
       └──► Summary Views re-render
       │
       │ (No API call - purely client-side)
       │
User Clicks "Save"
       │
       ▼
API Mutation (PUT /api/cost-modelling/scenarios/:id)
       │
       ▼
Server validates & persists to Supabase
       │
       ▼
Query cache invalidated
       │
       ▼
Toast success/error
```

---

## 4. File Changes

### 4.1 New Files (45 files)

| File | Purpose | Est. Lines |
|------|---------|------------|
| **Database** | | |
| `supabase/migrations/[timestamp]_cost_modelling_tables.sql` | Schema + RLS | 150 |
| **Page & Layout** | | |
| `apps/web/src/app/(dashboard)/cost-modelling/page.tsx` | Main page component | 100 |
| `apps/web/src/app/(dashboard)/cost-modelling/loading.tsx` | Loading skeleton | 20 |
| **API Routes** | | |
| `apps/web/src/app/api/cost-modelling/scenarios/route.ts` | List + Create | 120 |
| `apps/web/src/app/api/cost-modelling/scenarios/[id]/route.ts` | Get + Update + Delete | 150 |
| `apps/web/src/app/api/cost-modelling/scenarios/[id]/duplicate/route.ts` | Duplicate | 60 |
| `apps/web/src/app/api/cost-modelling/scenarios/[id]/draft/route.ts` | Draft CRUD | 80 |
| `apps/web/src/app/api/cost-modelling/export/pdf/route.ts` | PDF generation | 150 |
| `apps/web/src/app/api/cost-modelling/export/csv/route.ts` | CSV generation | 80 |
| **Components** | | |
| `apps/web/src/components/features/cost-modelling/index.ts` | Barrel export | 15 |
| `apps/web/src/components/features/cost-modelling/CostModellingPage.tsx` | Main orchestrator | 250 |
| `apps/web/src/components/features/cost-modelling/ScenarioSelector.tsx` | Dropdown + actions | 150 |
| `apps/web/src/components/features/cost-modelling/ProfitSummaryCards.tsx` | 4 hero metrics | 100 |
| `apps/web/src/components/features/cost-modelling/AssumptionsPanel.tsx` | Accordion wrapper | 80 |
| `apps/web/src/components/features/cost-modelling/sections/SalesVolumeSection.tsx` | 9 inputs | 120 |
| `apps/web/src/components/features/cost-modelling/sections/FeeRatesSection.tsx` | 3 inputs | 80 |
| `apps/web/src/components/features/cost-modelling/sections/COGSection.tsx` | 3 inputs | 80 |
| `apps/web/src/components/features/cost-modelling/sections/FixedCostsSection.tsx` | 7 inputs | 120 |
| `apps/web/src/components/features/cost-modelling/sections/VATSection.tsx` | Toggle + input | 80 |
| `apps/web/src/components/features/cost-modelling/sections/TaxSection.tsx` | 4 inputs | 80 |
| `apps/web/src/components/features/cost-modelling/PLBreakdown.tsx` | TreeView P&L | 200 |
| `apps/web/src/components/features/cost-modelling/PackageCostMatrix.tsx` | 6-col editable table | 200 |
| `apps/web/src/components/features/cost-modelling/SummaryViewTabs.tsx` | Daily/Weekly/Monthly | 180 |
| `apps/web/src/components/features/cost-modelling/CompareMode.tsx` | 2-column layout | 200 |
| `apps/web/src/components/features/cost-modelling/ComparisonSummary.tsx` | Delta table | 120 |
| `apps/web/src/components/features/cost-modelling/ExportButtons.tsx` | PDF/CSV buttons | 60 |
| `apps/web/src/components/features/cost-modelling/DraftRestorationDialog.tsx` | Restore/discard | 80 |
| `apps/web/src/components/features/cost-modelling/UnsavedChangesWarning.tsx` | Navigation guard | 60 |
| `apps/web/src/components/features/cost-modelling/SaveAsDialog.tsx` | Name input dialog | 80 |
| `apps/web/src/components/features/cost-modelling/DeleteConfirmDialog.tsx` | Delete confirmation | 60 |
| `apps/web/src/components/features/cost-modelling/ConflictResolutionDialog.tsx` | Concurrent edit | 80 |
| **Services & Repositories** | | |
| `apps/web/src/lib/repositories/cost-modelling.repository.ts` | Data access | 150 |
| `apps/web/src/lib/services/cost-modelling.service.ts` | Business logic | 100 |
| `apps/web/src/lib/services/cost-calculations.ts` | Pure calculation functions | 250 |
| `apps/web/src/lib/services/cost-pdf-generator.ts` | PDF document builder | 150 |
| **Hooks** | | |
| `apps/web/src/hooks/use-cost-modelling.ts` | Query/mutation hooks | 150 |
| `apps/web/src/hooks/use-cost-calculations.ts` | Memoized calculations hook | 80 |
| `apps/web/src/hooks/use-draft-autosave.ts` | Auto-save interval hook | 60 |
| **Types** | | |
| `apps/web/src/types/cost-modelling.ts` | TypeScript interfaces | 100 |
| **API Client** | | |
| `apps/web/src/lib/api/cost-modelling.ts` | Fetch functions | 100 |

**Subtotal New Files:** ~4,155 lines

### 4.2 Modified Files (3 files)

| File | Changes | Est. Lines Changed |
|------|---------|-------------------|
| `apps/web/src/components/layout/Sidebar.tsx` | Add Cost Modelling link to reportNavItems | 3 |
| `packages/database/src/types.ts` | Auto-regenerated after migration | Auto |
| `packages/database/src/index.ts` | Export new types | 5 |

**Subtotal Modified Files:** ~8 lines (types auto-generated)

### 4.3 Summary

| Category | Files | Est. Lines |
|----------|-------|------------|
| Database Migration | 1 | 150 |
| Page & Layout | 2 | 120 |
| API Routes | 6 | 640 |
| Components | 21 | 2,475 |
| Services | 4 | 650 |
| Hooks | 3 | 290 |
| Types & API Client | 2 | 200 |
| Modified | 3 | 8 |
| **Total** | **42** | **~4,533** |

---

## 5. Implementation Details

### 5.1 Database Schema

```sql
-- supabase/migrations/20260118_cost_modelling_tables.sql

-- Main scenarios table
CREATE TABLE cost_model_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  name VARCHAR(255) NOT NULL,
  description TEXT,

  -- Sales Volume & Pricing (per month)
  bl_sales_per_month INTEGER DEFAULT 165,
  bl_avg_sale_value DECIMAL(10,2) DEFAULT 15.00,
  bl_avg_postage_cost DECIMAL(10,2) DEFAULT 2.70,

  amazon_sales_per_month INTEGER DEFAULT 75,
  amazon_avg_sale_value DECIMAL(10,2) DEFAULT 40.00,
  amazon_avg_postage_cost DECIMAL(10,2) DEFAULT 3.95,

  ebay_sales_per_month INTEGER DEFAULT 80,
  ebay_avg_sale_value DECIMAL(10,2) DEFAULT 25.00,
  ebay_avg_postage_cost DECIMAL(10,2) DEFAULT 3.20,

  -- Fee Rates (as decimals)
  bl_fee_rate DECIMAL(5,4) DEFAULT 0.10,
  amazon_fee_rate DECIMAL(5,4) DEFAULT 0.183,
  ebay_fee_rate DECIMAL(5,4) DEFAULT 0.20,

  -- COG Percentages (as decimals)
  bl_cog_percent DECIMAL(5,4) DEFAULT 0.20,
  amazon_cog_percent DECIMAL(5,4) DEFAULT 0.35,
  ebay_cog_percent DECIMAL(5,4) DEFAULT 0.30,

  -- Fixed Costs (Monthly)
  fixed_shopify DECIMAL(10,2) DEFAULT 25.00,
  fixed_ebay_store DECIMAL(10,2) DEFAULT 35.00,
  fixed_seller_tools DECIMAL(10,2) DEFAULT 50.00,
  fixed_amazon DECIMAL(10,2) DEFAULT 30.00,
  fixed_storage DECIMAL(10,2) DEFAULT 110.00,

  -- Annual Costs
  annual_accountant_cost DECIMAL(10,2) DEFAULT 200.00,
  annual_misc_costs DECIMAL(10,2) DEFAULT 1000.00,

  -- VAT Settings
  is_vat_registered BOOLEAN DEFAULT FALSE,
  vat_flat_rate DECIMAL(5,4) DEFAULT 0.075,
  accountant_cost_if_vat DECIMAL(10,2) DEFAULT 1650.00,

  -- Tax Settings
  target_annual_profit DECIMAL(10,2) DEFAULT 26000.00,
  personal_allowance DECIMAL(10,2) DEFAULT 12570.00,
  income_tax_rate DECIMAL(5,4) DEFAULT 0.20,
  ni_rate DECIMAL(5,4) DEFAULT 0.06,

  -- Lego Parts (% of eBay turnover)
  lego_parts_percent DECIMAL(5,4) DEFAULT 0.02,

  -- Draft for auto-save
  draft_data JSONB,
  draft_updated_at TIMESTAMPTZ,

  -- Metadata
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, name)
);

-- Package costs table (6 rows per scenario)
CREATE TABLE cost_model_package_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id UUID NOT NULL REFERENCES cost_model_scenarios(id) ON DELETE CASCADE,

  package_type VARCHAR(50) NOT NULL,
  -- 'large_parcel_amazon', 'small_parcel_amazon', 'large_letter_amazon',
  -- 'large_parcel_ebay', 'small_parcel_ebay', 'large_letter_ebay'

  postage DECIMAL(10,2) NOT NULL,
  cardboard DECIMAL(10,2) NOT NULL,
  bubble_wrap DECIMAL(10,2) NOT NULL,
  lego_card DECIMAL(10,2) DEFAULT 0.00,
  business_card DECIMAL(10,2) DEFAULT 0.00,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(scenario_id, package_type)
);

-- Indexes
CREATE INDEX idx_cost_scenarios_user ON cost_model_scenarios(user_id);
CREATE INDEX idx_cost_scenarios_updated ON cost_model_scenarios(updated_at DESC);
CREATE INDEX idx_cost_package_scenario ON cost_model_package_costs(scenario_id);

-- RLS Policies
ALTER TABLE cost_model_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_model_package_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own scenarios"
  ON cost_model_scenarios FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own scenarios"
  ON cost_model_scenarios FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own scenarios"
  ON cost_model_scenarios FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own scenarios"
  ON cost_model_scenarios FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own package costs"
  ON cost_model_package_costs FOR SELECT
  USING (
    scenario_id IN (
      SELECT id FROM cost_model_scenarios WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own package costs"
  ON cost_model_package_costs FOR INSERT
  WITH CHECK (
    scenario_id IN (
      SELECT id FROM cost_model_scenarios WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own package costs"
  ON cost_model_package_costs FOR UPDATE
  USING (
    scenario_id IN (
      SELECT id FROM cost_model_scenarios WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own package costs"
  ON cost_model_package_costs FOR DELETE
  USING (
    scenario_id IN (
      SELECT id FROM cost_model_scenarios WHERE user_id = auth.uid()
    )
  );

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_cost_model_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cost_model_scenarios_updated_at
  BEFORE UPDATE ON cost_model_scenarios
  FOR EACH ROW EXECUTE FUNCTION update_cost_model_updated_at();

CREATE TRIGGER cost_model_package_costs_updated_at
  BEFORE UPDATE ON cost_model_package_costs
  FOR EACH ROW EXECUTE FUNCTION update_cost_model_updated_at();
```

### 5.2 Key Component: CostModellingPage

```typescript
// Pseudocode structure for main page component
'use client';

export function CostModellingPage() {
  // State
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [scenarioBId, setScenarioBId] = useState<string | null>(null);

  // Queries
  const { data: scenarios, isLoading: loadingList } = useCostScenarios();
  const { data: scenarioA, isLoading: loadingA } = useCostScenario(selectedScenarioId);
  const { data: scenarioB, isLoading: loadingB } = useCostScenario(scenarioBId);

  // Form state (controlled)
  const [formDataA, setFormDataA] = useState<ScenarioFormData | null>(null);
  const [formDataB, setFormDataB] = useState<ScenarioFormData | null>(null);

  // Calculations (memoized)
  const calculationsA = useCostCalculations(formDataA);
  const calculationsB = useCostCalculations(formDataB);

  // Mutations
  const saveMutation = useSaveCostScenario();
  const deleteMutation = useDeleteCostScenario();
  const duplicateMutation = useDuplicateCostScenario();

  // Effects: Load form data when scenario loads
  useEffect(() => {
    if (scenarioA) setFormDataA(scenarioToFormData(scenarioA));
  }, [scenarioA]);

  // Auto-save draft hook
  useDraftAutosave(selectedScenarioId, formDataA, isDirty);

  // Render
  return (
    <div className="space-y-6 p-6">
      <Header>
        <ScenarioSelector ... />
        <ExportButtons ... />
        <CompareModeToggle ... />
      </Header>

      {compareMode ? (
        <CompareMode
          scenarioA={formDataA}
          scenarioB={formDataB}
          calculationsA={calculationsA}
          calculationsB={calculationsB}
          ...
        />
      ) : (
        <>
          <ProfitSummaryCards calculations={calculationsA} />
          <AssumptionsPanel data={formDataA} onChange={setFormDataA} />
          <PLBreakdown calculations={calculationsA} />
          <PackageCostMatrix data={formDataA} onChange={setFormDataA} />
          <SummaryViewTabs calculations={calculationsA} data={formDataA} />
        </>
      )}

      {/* Dialogs */}
      <SaveAsDialog ... />
      <DeleteConfirmDialog ... />
      <DraftRestorationDialog ... />
      <UnsavedChangesWarning isDirty={isDirty} />
    </div>
  );
}
```

### 5.3 Key Service: Cost Calculations

```typescript
// apps/web/src/lib/services/cost-calculations.ts

export interface CostScenarioInputs {
  // Sales
  blSalesPerMonth: number;
  blAvgSaleValue: number;
  blAvgPostageCost: number;
  amazonSalesPerMonth: number;
  amazonAvgSaleValue: number;
  amazonAvgPostageCost: number;
  ebaySalesPerMonth: number;
  ebayAvgSaleValue: number;
  ebayAvgPostageCost: number;
  // Fees
  blFeeRate: number;
  amazonFeeRate: number;
  ebayFeeRate: number;
  // COG
  blCogPercent: number;
  amazonCogPercent: number;
  ebayCogPercent: number;
  // Fixed costs
  fixedShopify: number;
  fixedEbayStore: number;
  fixedSellerTools: number;
  fixedAmazon: number;
  fixedStorage: number;
  annualAccountantCost: number;
  annualMiscCosts: number;
  // VAT
  isVatRegistered: boolean;
  vatFlatRate: number;
  accountantCostIfVat: number;
  // Tax
  targetAnnualProfit: number;
  personalAllowance: number;
  incomeTaxRate: number;
  niRate: number;
  // Other
  legoPartsPercent: number;
  // Package costs (optional - for P&L detail)
  packageCosts?: PackageCost[];
}

export interface CalculatedResults {
  // Turnover
  blTurnover: number;
  amazonTurnover: number;
  ebayTurnover: number;
  totalTurnover: number;
  // Fees
  blFees: number;
  amazonFees: number;
  ebayFees: number;
  totalFees: number;
  // VAT
  vatAmount: number;
  // COG
  blCog: number;
  amazonCog: number;
  ebayCog: number;
  totalCog: number;
  // Other costs
  annualFixedCosts: number;
  packagingMaterials: number;
  totalPostage: number;
  legoParts: number;
  accountantCost: number;
  totalOtherCosts: number;
  // Profit
  grossProfit: number;
  netProfit: number;
  profitVsTarget: number;
  // Tax
  taxableIncome: number;
  incomeTax: number;
  nationalInsurance: number;
  totalTax: number;
  // Take-home
  takeHome: number;
  weeklyTakeHome: number;
  // Per-item
  blCogPerItem: number;
  amazonCogPerItem: number;
  ebayCogPerItem: number;
  fixedCostPerSale: number;
  // Time breakdowns
  salesPerDay: number;
  salesPerWeek: number;
  turnoverPerDay: number;
  turnoverPerWeek: number;
  cogBudgetPerDay: number;
  cogBudgetPerWeek: number;
}

export function calculateAll(inputs: CostScenarioInputs): CalculatedResults {
  // Helper values
  const totalMonthlySales = inputs.blSalesPerMonth + inputs.amazonSalesPerMonth + inputs.ebaySalesPerMonth;
  const monthlyFixedCosts =
    inputs.fixedShopify + inputs.fixedEbayStore + inputs.fixedSellerTools +
    inputs.fixedAmazon + inputs.fixedStorage +
    (inputs.annualAccountantCost / 12) + (inputs.annualMiscCosts / 12);

  // Turnover
  const blTurnover = inputs.blSalesPerMonth * inputs.blAvgSaleValue * 12;
  const amazonTurnover = inputs.amazonSalesPerMonth * inputs.amazonAvgSaleValue * 12;
  const ebayTurnover = inputs.ebaySalesPerMonth * inputs.ebayAvgSaleValue * 12;
  const totalTurnover = blTurnover + amazonTurnover + ebayTurnover;

  // Fees
  const blFees = blTurnover * inputs.blFeeRate;
  const amazonFees = amazonTurnover * inputs.amazonFeeRate;
  const ebayFees = ebayTurnover * inputs.ebayFeeRate;
  const totalFees = blFees + amazonFees + ebayFees;

  // VAT
  const vatAmount = inputs.isVatRegistered ? totalTurnover * inputs.vatFlatRate : 0;

  // COG
  const blCog = blTurnover * inputs.blCogPercent;
  const amazonCog = amazonTurnover * inputs.amazonCogPercent;
  const ebayCog = ebayTurnover * inputs.ebayCogPercent;
  const totalCog = blCog + amazonCog + ebayCog;

  // Other costs (simplified - package costs would add detail)
  const annualFixedCosts = monthlyFixedCosts * 12;
  const totalPostage =
    (inputs.blAvgPostageCost * inputs.blSalesPerMonth * 12) +
    (inputs.amazonAvgPostageCost * inputs.amazonSalesPerMonth * 12) +
    (inputs.ebayAvgPostageCost * inputs.ebaySalesPerMonth * 12);
  const legoParts = ebayTurnover * inputs.legoPartsPercent;
  const accountantCost = inputs.isVatRegistered ? inputs.accountantCostIfVat : inputs.annualAccountantCost;

  // Packaging materials would come from packageCosts if provided
  const packagingMaterials = 0; // Placeholder - calculated from package matrix

  const totalOtherCosts = annualFixedCosts + totalPostage + legoParts + accountantCost + inputs.annualMiscCosts + packagingMaterials;

  // Profit
  const grossProfit = totalTurnover - totalFees - vatAmount - totalOtherCosts;
  const netProfit = grossProfit - totalCog;
  const profitVsTarget = netProfit - inputs.targetAnnualProfit;

  // Tax
  const taxableIncome = Math.max(0, netProfit - inputs.personalAllowance);
  const incomeTax = taxableIncome * inputs.incomeTaxRate;
  const nationalInsurance = taxableIncome * inputs.niRate;
  const totalTax = incomeTax + nationalInsurance;

  // Take-home
  const takeHome = netProfit - totalTax;
  const weeklyTakeHome = takeHome / 52;

  // Per-item
  const blCogPerItem = inputs.blAvgSaleValue * inputs.blCogPercent;
  const amazonCogPerItem = inputs.amazonAvgSaleValue * inputs.amazonCogPercent;
  const ebayCogPerItem = inputs.ebayAvgSaleValue * inputs.ebayCogPercent;
  const fixedCostPerSale = monthlyFixedCosts / totalMonthlySales;

  // Time breakdowns
  const annualSales = totalMonthlySales * 12;
  const salesPerDay = annualSales / 365;
  const salesPerWeek = annualSales / 52;
  const turnoverPerDay = totalTurnover / 365;
  const turnoverPerWeek = totalTurnover / 52;
  const cogBudgetPerDay = totalCog / 365;
  const cogBudgetPerWeek = totalCog / 52;

  return {
    blTurnover, amazonTurnover, ebayTurnover, totalTurnover,
    blFees, amazonFees, ebayFees, totalFees,
    vatAmount,
    blCog, amazonCog, ebayCog, totalCog,
    annualFixedCosts, packagingMaterials, totalPostage, legoParts, accountantCost, totalOtherCosts,
    grossProfit, netProfit, profitVsTarget,
    taxableIncome, incomeTax, nationalInsurance, totalTax,
    takeHome, weeklyTakeHome,
    blCogPerItem, amazonCogPerItem, ebayCogPerItem, fixedCostPerSale,
    salesPerDay, salesPerWeek, turnoverPerDay, turnoverPerWeek, cogBudgetPerDay, cogBudgetPerWeek,
  };
}
```

### 5.4 API Route Pattern

```typescript
// apps/web/src/app/api/cost-modelling/scenarios/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { CostModellingRepository } from '@/lib/repositories/cost-modelling.repository';

const CreateScenarioSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const repository = new CostModellingRepository(supabase);
    const scenarios = await repository.findAllByUser(user.id);

    // If no scenarios, create default
    if (scenarios.length === 0) {
      const defaultScenario = await repository.createDefault(user.id);
      return NextResponse.json({ data: [defaultScenario] });
    }

    return NextResponse.json({ data: scenarios });
  } catch (error) {
    console.error('[GET /api/cost-modelling/scenarios] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = CreateScenarioSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const repository = new CostModellingRepository(supabase);
    const scenario = await repository.create({
      user_id: user.id,
      name: parsed.data.name,
      description: parsed.data.description,
      // All other fields use defaults from schema
    });

    // Create default package costs for new scenario
    await repository.createDefaultPackageCosts(scenario.id);

    return NextResponse.json({ data: scenario }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/cost-modelling/scenarios] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

---

## 6. Build Order

Given criteria dependencies and complexity, implement in this order:

### Step 1: Database Foundation (Day 1)
1. Create migration file with both tables
2. Push migration to cloud Supabase (`npm run db:push`)
3. Regenerate types (`npm run db:types`)
4. Verify tables and RLS in Supabase dashboard

**Criteria covered:** F2, I1

### Step 2: Repository & Service Layer (Day 1)
1. Create `CostModellingRepository` with CRUD methods
2. Create `cost-calculations.ts` with all formulas
3. Create TypeScript types for scenarios and calculations
4. Write unit tests for calculations

**Criteria covered:** F15-F21 (calculation logic)

### Step 3: API Routes (Day 2)
1. Create `/scenarios` route (GET, POST)
2. Create `/scenarios/[id]` route (GET, PUT, DELETE)
3. Create `/scenarios/[id]/duplicate` route
4. Add Zod validation schemas
5. Test with curl/Postman

**Criteria covered:** F3, F4, F5, F6, F7, F44, I2

### Step 4: Basic Page & Hooks (Day 2)
1. Create page route with loading skeleton
2. Create query hooks (`use-cost-modelling.ts`)
3. Add sidebar navigation link
4. Implement basic page structure with scenario dropdown

**Criteria covered:** F1, F8, F55, I3, I4, P1, P3

### Step 5: Hero Metrics & Assumptions (Day 3)
1. Create `ProfitSummaryCards` component
2. Create `AssumptionsPanel` with accordion sections
3. Implement all input fields (F9-F14)
4. Wire up calculations with useMemo

**Criteria covered:** F9-F14, F22, F24, F49

### Step 6: P&L Breakdown (Day 3)
1. Create `PLBreakdown` component with TreeView structure
2. Connect to calculations
3. Style with proper currency formatting

**Criteria covered:** F23, U2, U5, U6

### Step 7: Package Cost Matrix (Day 4)
1. Create `PackageCostMatrix` component
2. Implement editable table cells
3. Connect to package costs table
4. Implement total row calculations

**Criteria covered:** F25-F30

### Step 8: Summary Views (Day 4)
1. Create `SummaryViewTabs` component
2. Implement Daily/Weekly/Monthly calculations
3. Add platform breakdown tables

**Criteria covered:** F31-F34

### Step 9: Compare Mode (Day 5)
1. Create `CompareMode` component
2. Implement 2-column layout
3. Create `ComparisonSummary` with deltas
4. Add delta indicators to hero metrics

**Criteria covered:** F35-F43, P4

### Step 10: Draft & Persistence (Day 5-6)
1. Create draft API routes
2. Implement `useDraftAutosave` hook
3. Create `DraftRestorationDialog`
4. Implement optimistic locking for concurrent edit detection

**Criteria covered:** F45-F48, E7

### Step 11: Export (Day 6)
1. Create PDF export API with jsPDF
2. Create CSV export API
3. Add `ExportButtons` component
4. Test exports contain all required data

**Criteria covered:** F51-F54, P5, P6

### Step 12: Error Handling & Validation (Day 6-7)
1. Add Zod validation to all inputs
2. Implement error toasts
3. Add offline detection
4. Implement delete last scenario prevention

**Criteria covered:** E1-E6

### Step 13: UI Polish & Responsiveness (Day 7)
1. Verify all shadcn components used correctly
2. Add tooltips to complex inputs
3. Test at 375px, 768px, 1024px
4. Add focus states, loading states

**Criteria covered:** U1, U3-U4, U7-U10, F50, P2

### Step 14: Testing & Verification (Day 7-8)
1. Run `/test-execute quick`
2. Manual testing of all criteria
3. Fix any failing criteria
4. Final review

---

## 7. Risk Assessment

### 7.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Calculation errors** | Medium | High | Extensive unit tests for all formulas; validate against spec examples |
| **PDF generation slow** | Low | Medium | Generate client-side; show loading state; cache if needed |
| **Compare mode complexity** | Medium | Medium | Keep state isolated between scenarios; use separate form instances |
| **Draft conflicts** | Low | Medium | Optimistic locking with `updated_at`; clear conflict resolution UI |
| **Memory with large forms** | Low | Low | Memoize calculations; avoid unnecessary re-renders |

### 7.2 Scope Risks

| Risk | Mitigation |
|------|------------|
| Temptation to add actuals comparison | Explicitly out of scope; done-criteria is contract |
| Feature creep in calculations | Stick to spec formulas exactly |
| Over-engineering exports | PDF/CSV only; no Excel/scheduled reports |

### 7.3 Integration Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **jsPDF compatibility** | Low | Medium | Already used in project for picking lists |
| **Type generation fails** | Low | Medium | Re-run `npm run db:types`; verify migration syntax |
| **RLS too restrictive** | Low | High | Test all CRUD operations as authenticated user |

---

## 8. Feasibility Validation

| Criterion | Feasible | Confidence | Notes |
|-----------|----------|------------|-------|
| F1-F8 | Yes | High | Standard CRUD pattern |
| F9-F14 | Yes | High | Form inputs with Zod |
| F15-F21 | Yes | High | Pure math functions |
| F22-F24 | Yes | High | Component composition |
| F25-F30 | Yes | High | Editable table pattern |
| F31-F34 | Yes | High | Derived calculations |
| F35-F44 | Yes | Medium | Compare mode adds complexity but achievable |
| F45-F48 | Yes | Medium | Draft system well-scoped |
| F49 | Yes | High | shadcn Accordion available |
| F50 | Yes | High | Tailwind responsive classes |
| F51-F54 | Yes | High | jsPDF already in project |
| F55-F56 | Yes | High | Existing patterns |
| E1-E7 | Yes | High | Standard error handling |
| P1-P6 | Yes | High | Client-side calcs ensure speed |
| U1-U10 | Yes | High | shadcn + existing patterns |
| I1-I4 | Yes | High | Standard integration |

**Overall:** All 77 criteria feasible with planned approach.

**Issues:** None identified.

---

## 9. Notes for Build Agent

### Key Implementation Hints

1. **Calculations must be pure functions** - No side effects, no state mutation. This enables memoization and testing.

2. **Form state separate from persisted state** - Load scenario into form state on fetch; only persist on explicit save.

3. **Package costs are optional detail** - The main P&L calculations work from top-level inputs. Package matrix provides granular breakdown but shouldn't block MVP.

4. **VAT toggle has cascading effects** - When toggled on: (a) accountant cost changes to £1,650, (b) VAT line appears in P&L. Both must update.

5. **Fixed cost per sale is derived** - `monthlyFixedCosts / totalMonthlySales`. Display as read-only, recalculates automatically.

6. **Compare mode uses same components** - Don't duplicate; pass different props (scenarioA/B, calculationsA/B).

7. **Draft auto-save should be debounced** - 30-second interval per spec, but don't save if no changes since last save.

8. **PDF generation happens server-side** - POST scenario data to API, return PDF buffer. Avoids client-side library weight.

9. **Test calculations against spec examples** - The spec includes exact expected values (e.g., £89,700 turnover with defaults). Unit tests should validate these.

10. **Currency formatting helper exists** - Check for existing `formatCurrency()` utility; use consistent pattern project-wide.

### Validation Test Data

With default values, verify these calculations:
- Total monthly sales: 320 (165 + 75 + 80)
- Total turnover: £89,700 (29,700 + 36,000 + 24,000)
- Total fees: £14,358 (2,970 + 6,588 + 4,800)
- Total COG: £25,740 (5,940 + 12,600 + 7,200)
- Fixed cost per sale: £1.09 (350 / 320)

---

## 10. Handoff

**Feature:** cost-modelling
**Spec:** docs/features/cost-modelling/feature-spec.md
**Status:** READY_FOR_BUILD

**Summary:**
- 42 files to create/modify (~4,533 lines)
- 1 database migration with 2 tables
- 77 criteria (all AUTO_VERIFY)
- No external dependencies to add (jsPDF already installed)

**Build order:** 14 steps over ~7-8 days

**Risks flagged:**
- Compare mode complexity (mitigated with isolated state)
- Calculation errors (mitigated with unit tests)

Ready for: `/build-feature cost-modelling`
