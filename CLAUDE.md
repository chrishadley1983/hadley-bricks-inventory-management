# Hadley Bricks Inventory System - Claude Code Instructions

## Project Overview

A comprehensive Lego resale business management system for tracking inventory, purchases, orders across multiple platforms (Amazon, eBay, BrickLink, Brick Owl, Bricqer), and financial reporting. Built for personal use with architecture designed for future commercial SaaS scaling.

**PRD Reference:** See `docs/PRD.md` for complete requirements and specifications.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| State | Zustand (client), TanStack Query (server) |
| Backend | Supabase Edge Functions (TypeScript) |
| Database | Supabase PostgreSQL with Row Level Security |
| Auth | Supabase Auth (email/password) |
| AI Primary | Claude API (Anthropic) - purchase parsing, distance calc |
| AI Secondary | Gemini API - image analysis (future) |
| Hosting | Vercel |
| Monitoring | Sentry + Vercel Analytics |

---

## 🔴 CRITICAL: Cloud Supabase (No Local)

**This project uses cloud Supabase only. There is no local Supabase instance.**

- **Supabase Project ID:** `modjoikyuhqzouxvieua`
- **Project Name:** Inventory Management App
- All database operations connect to the cloud instance
- No `npx supabase start` required
- Migrations are pushed directly to cloud: `npm run db:push`
- Types are generated from cloud schema: `npm run db:types`

> **Warning:** There is no `db:reset` for cloud Supabase. Database resets must be done manually via the Supabase dashboard if needed.

## 🔴 CRITICAL: Supabase Query Row Limit

**Supabase returns a maximum of 1,000 rows by default.** Always use pagination when querying tables that may have more than 1,000 rows.

```typescript
// BAD - will silently truncate results at 1,000 rows
const { data } = await supabase.from('inventory_items').select('*');

// GOOD - paginate to get all results
const pageSize = 1000;
let page = 0;
let hasMore = true;
const allData = [];

while (hasMore) {
  const { data } = await supabase
    .from('inventory_items')
    .select('*')
    .range(page * pageSize, (page + 1) * pageSize - 1);

  allData.push(...(data ?? []));
  hasMore = (data?.length ?? 0) === pageSize;
  page++;
}
```

> **Warning:** This limit applies to all queries including counts and aggregations. Always verify large result sets are complete.

---

## 🔴 CRITICAL: Local Windows Environment

**The user (Chris) runs this on their LOCAL WINDOWS MACHINE with PowerShell.**

- Use PowerShell syntax, NOT bash/Linux commands
- Use `Remove-Item -Recurse -Force` not `rm -rf`
- Use `$env:VARIABLE` not `export VARIABLE`
- Use semicolon `;` to chain commands, not `&&`
- **Write commands as single lines** - multiline scripts without proper delimiters won't paste correctly into PowerShell

```powershell
# Good - single line with semicolons
Remove-Item -Recurse -Force node_modules/.cache -ErrorAction SilentlyContinue; Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue

# Good - comma-separated paths
Remove-Item -Recurse -Force node_modules/.cache, .next -ErrorAction SilentlyContinue
```

---

## Project Structure

```
hadley-bricks/
├── .claude/
│   └── commands/             # Claude Code slash commands
├── apps/
│   └── web/                  # Next.js 14 web application
│       ├── app/              # App router pages
│       │   ├── (auth)/       # Auth pages (login, register)
│       │   ├── (dashboard)/  # Protected dashboard pages
│       │   └── api/          # API routes
│       ├── components/       # React components
│       │   ├── ui/           # shadcn/ui components
│       │   ├── forms/        # Form components
│       │   └── features/     # Feature-specific components
│       ├── hooks/            # Custom React hooks
│       ├── stores/           # Zustand stores
│       ├── lib/              # Utilities and helpers
│       │   ├── supabase/     # Supabase client
│       │   ├── google/       # Google Sheets client
│       │   ├── sync/         # Cache and dual-write services
│       │   ├── adapters/     # Platform adapters
│       │   ├── repositories/ # Data access layer
│       │   ├── services/     # Business logic
│       │   ├── api/          # API client functions
│       │   ├── ai/           # AI prompts and services
│       │   └── utils/        # General utilities
│       └── types/            # TypeScript types
├── packages/
│   ├── database/             # Supabase types and client
│   └── shared/               # Shared types and utilities
├── supabase/
│   ├── functions/            # Edge Functions
│   │   ├── ai-parse-purchase/
│   │   ├── bricklink-sync/
│   │   ├── brickowl-sync/
│   │   └── ...
│   └── migrations/           # Database migrations
├── docs/
│   ├── PRD.md
│   ├── API.md
│   ├── agents/               # Agent specifications
│   ├── testing/              # Test infrastructure
│   │   ├── analysis/         # Coverage analysis outputs
│   │   ├── config/           # Test configuration
│   │   ├── execution-history/# Test run history
│   │   ├── registry/         # Test manifests
│   │   └── templates/        # Report templates
│   ├── reviews/              # Code review outputs
│   └── merges/               # Merge reports
├── tests/
│   ├── unit/
│   ├── api/
│   ├── integration/
│   ├── e2e/
│   │   └── playwright/
│   └── fixtures/
│       └── seeders/
└── CLAUDE.md                 # This file
```

---

## Development Agents

This project uses a suite of development agents for consistent, high-quality workflows.

### Available Agents

| Command | Agent | Purpose |
|---------|-------|---------|
| `/define-done` | Define Done Agent | Define success criteria |
| `/feature-spec` | Feature Spec Agent | Create implementation plan |
| `/build-feature` | Build Feature Agent | Autonomous build-verify loop |
| `/verify-done` | Verify Done Agent | Adversarial verification |
| `/test-plan` | Test Plan Agent | Analyse coverage gaps |
| `/test-build` | Test Build Agent | Generate tests for gaps |
| `/test-execute` | Test Execution Agent | Run tests and report |
| `/code-review` | Code Review Agent | Review code changes |
| `/merge-feature` | Merge Feature Agent | Safely merge branches |
| `/performance` | Performance Agent | Analyse app performance |
| `/docs` | Functional Docs Agent | Generate & maintain functional documentation |

### Standard Workflow

**During development:**
```powershell
/test-execute quick          # Fast validation
/code-review staged          # Before committing
```

**Before merging:**
```powershell
/test-execute pre-merge      # Full test suite
/code-review branch          # Full review
/merge-feature <branch>      # Safe merge
```

**When adding features:**
```powershell
/define-done <feature-name>  # Define success criteria first
/test-plan analyze           # Find coverage gaps
/test-build feature:<n>      # Generate tests
/test-execute feature:<n>    # Verify tests
```

**Autonomous feature development:**
```powershell
/define-done <feature>       # Define machine-verifiable success criteria
/feature-spec <feature>      # [Optional] Create implementation plan
/build-feature <feature>     # Autonomous build-verify loop
```

The Build Feature Agent runs autonomously until all AUTO_VERIFY criteria pass (CONVERGED), or it escalates to human review (ESCALATED/BLOCKED).

**After shipping features:**
```powershell
/docs update                 # Update docs for changed code
/docs discover               # Find undocumented features
/docs status                 # Check documentation coverage
```

### Agent Documentation

- Define Done Agent: `docs/agents/define-done/spec.md`
- Feature Spec Agent: `docs/agents/feature-spec/spec.md`
- Build Feature Agent: `docs/agents/build-feature/spec.md`
- Verify Done Agent: `docs/agents/verify-done/spec.md`
- Test Plan Agent: `docs/testing/test-plan-agent.md`
- Test Build Agent: `docs/testing/test-build-agent.md`
- Test Execution Agent: `docs/testing/test-execution-agent.md`
- Code Review Agent: `docs/reviews/code-review-agent.md`
- Merge Feature Agent: `docs/agents/merge-feature-agent.md`
- Performance Agent: `docs/agents/performance/spec.md`
- Functional Docs Agent: `docs/agents/functional-docs/spec.md`
- Fix Agent: `docs/agents/fix-agent/spec.md`

---

## Branch Policy

### Golden Rules

1. **All code changes require a branch** - Main is protected, direct commits blocked
2. **No code changes without approval** - Always present a plan and wait for explicit approval
3. **Branch naming determines workflow** - Different tracks for features vs fixes

### Branch Naming Convention

| Pattern | Track | Workflow |
|---------|-------|----------|
| `feature/*` | Feature | Full DBT cycle: Define Done → Build → Verify Done → Tests → Code Review → Merge |
| `fix/*` | Fix | Quick cycle: `/fix` agent → Code Review → Merge |
| `hotfix/*` | Fix | Same as fix/* |
| `bugfix/*` | Fix | Same as fix/* |
| `chore/*` | Feature | Full cycle (housekeeping can break things) |
| `refactor/*` | Feature | Full cycle (refactors can break things) |

### Approval Gates

**Before writing ANY code, you must:**

1. Present a clear plan of what you intend to change
2. Wait for explicit approval (e.g., "yes", "approved", "go ahead")
3. Only then create a branch and begin implementation

**Approval applies to:**
- New features
- Bug fixes
- Refactors
- Dependency updates
- Any file modification

**What counts as approval:**
- "Yes"
- "Approved"
- "Go ahead"
- "Do it"
- "Looks good, proceed"

**What does NOT count as approval:**
- Silence
- "What do you think?"
- "Can you..." (this is a question, not approval)
- "Maybe we should..."

### Workflow Selection

**Use Feature Track (`/define-done` → `/build-feature` → etc.) when:**
- Adding new functionality
- Significant refactoring
- Changes touching multiple systems
- Unclear scope or requirements

**Use Fix Track (`/fix`) when:**
- Clear, isolated bug fix
- Small UI tweak
- Copy/text change
- Performance fix with obvious solution
- Single file or tightly scoped change

---

## Agent Quick Reference

### Feature Track
```powershell
/define-done <feature>     # Establish success criteria
/feature-spec <feature>    # Plan implementation (optional)
/build-feature <feature>   # Autonomous build loop
/verify-done <feature>     # Verify against done criteria
/test-plan analyze         # Check test coverage
/test-build                # Generate missing tests
/test-execute pre-merge    # Run full test suite
/code-review branch        # Review changes
/merge-feature <branch>    # Merge + deploy + verify
```

### Fix Track
```powershell
/fix <description>         # Plan → Approve → Build → Test
/code-review branch        # Review changes
/merge-feature <branch>    # Merge + deploy + verify
```

### Standalone
```powershell
/merge-feature check           # Pre-merge readiness
/merge-feature preview         # Test Vercel preview
/merge-feature verify-production  # Check production health
/merge-feature rollback        # Revert last deploy
```

---

## ⚠️ Verification Checklist

**Before reporting ANY change as complete, Claude MUST verify ALL applicable items:**

### Code Changes
- [ ] TypeScript compiles with no errors (`npm run typecheck`)
- [ ] ESLint passes with no errors (`npm run lint`)
- [ ] Prettier formatting applied (`npm run format`)
- [ ] All new functions have JSDoc comments
- [ ] No `any` types - use proper typing

### Database Changes
- [ ] Migration file created in `supabase/migrations/`
- [ ] Migration pushed to cloud (`npm run db:push`)
- [ ] RLS policies added for new tables
- [ ] Indexes added for foreign keys and common queries
- [ ] Types regenerated (`npm run db:types`)

### Sheets Integration Changes
- [ ] Dual-write working (Sheets first, then Supabase async)
- [ ] Cache invalidation working
- [ ] Sync status indicator updated

### API Changes
- [ ] Zod schema created for request validation
- [ ] Error handling with proper status codes
- [ ] Auth middleware applied to protected routes
- [ ] Rate limiting considered
- [ ] Response matches expected type

### Frontend Changes
- [ ] Component renders without console errors
- [ ] Loading states implemented with skeleton components
- [ ] Error states implemented
- [ ] Mobile responsive (check at 375px, 768px, 1024px)
- [ ] Keyboard navigation works
- [ ] Dynamic imports have `loading` fallback with skeleton component
- [ ] Route has `loading.tsx` file for instant navigation feedback
- [ ] Search inputs are debounced (300ms minimum)

### Testing
- [ ] Run `/test-execute quick` - must pass
- [ ] Unit tests written for new utility functions
- [ ] Integration tests for new API routes
- [ ] Existing tests still pass (`npm test`)
- [ ] Test coverage maintained >80%

### Before Marking Complete
- [ ] Development server runs without errors (`npm run dev`)
- [ ] Feature works end-to-end in browser
- [ ] No TypeScript errors in VS Code
- [ ] Git changes committed with descriptive message

---

## Development Workflow

### Starting Development

```powershell
# 1. Ensure .env.local is configured with cloud Supabase + Google Sheets credentials
# 2. Start Next.js dev server
npm run dev

# 3. Verify the app connects to cloud Supabase before making changes
```

### Git Workflow

```powershell
# Feature branches
git checkout -b feature/[feature-name]

# Commit messages - use conventional commits
# feat: add inventory aging report
# fix: correct BrickLink order sync duplicate detection
# refactor: extract repository pattern for inventory
# docs: update API documentation
# test: add unit tests for cost calculation

# Before pushing (or use /code-review staged)
npm run typecheck
npm run lint
npm test
```

### Database Changes

```powershell
# Create migration file locally
npx supabase migration new [descriptive_name]

# Push migrations to cloud Supabase
npm run db:push

# Regenerate types from cloud schema
npm run db:types
```

---

## Sheets-Primary Architecture

### Current Phase: Sheets-Primary

During the transition period, Google Sheets remains the source of truth while Supabase acts as a cache for performance:

**Read Path (Sheets Primary):**
1. Check Supabase cache first (TTL: 5 minutes)
2. If cache miss or stale → fetch from Google Sheets
3. Transform Sheets data → store in Supabase cache
4. Return data from cache

**Write Path (Sheets First):**
1. Write to Google Sheets (primary) - **blocking**
2. Async sync to Supabase (fire-and-forget)
3. Invalidate cache for affected records

**Conflict Resolution:**
- Google Sheets always wins
- On conflict, Sheets data overwrites Supabase
- Last-write-wins with Sheets as authority

### Data Flow Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   React App     │────▶│   API Routes    │────▶│  Repositories   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                       │
                                    ┌──────────────────┴──────────────────┐
                                    ▼                                      ▼
                          ┌─────────────────┐                    ┌─────────────────┐
                          │   Read-Through  │                    │   Dual-Write    │
                          │     Cache       │                    │    Service      │
                          └─────────────────┘                    └─────────────────┘
                                    │                                      │
                          ┌─────────┴─────────┐                  ┌────────┴────────┐
                          ▼                   ▼                  ▼                 ▼
                   ┌───────────┐       ┌───────────┐      ┌───────────┐     ┌───────────┐
                   │  Supabase │       │  Google   │      │  Google   │     │  Supabase │
                   │  (cache)  │       │  Sheets   │      │  Sheets   │     │  (async)  │
                   └───────────┘       │ (primary) │      │ (primary) │     └───────────┘
                                       └───────────┘      └───────────┘
```

### Sync Status

Components should display sync status indicators:
- 🟢 In sync (last sync < 5 min ago)
- 🟡 Syncing (operation in progress)
- 🔴 Sync error (needs retry)

Use the `useSyncStatus` hook to access sync state.

### Migration Scripts

```powershell
# Run in apps/web directory

# Test Google Sheets connection
npm run sheets:test

# Migrate inventory from Sheets to Supabase (dry run first)
npm run migrate:inventory -- --dry-run
npm run migrate:inventory

# Migrate purchases from Sheets to Supabase
npm run migrate:purchases -- --dry-run
npm run migrate:purchases

# Validate data reconciliation
npm run validate:reconcile
```

### Environment Variables for Sheets Integration

```powershell
# Google Sheets (required for Sheets-primary mode)
GOOGLE_CREDENTIALS_PATH=     # Path to service account JSON
GOOGLE_SHEETS_ID=            # Spreadsheet ID
ENABLE_SHEETS_WRITE=true     # Enable dual-write to Sheets

# Optional: Alternative to credentials file
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
```

### Post-Transition (Future)

After the transition period is complete:
1. Switch read path to Supabase-only
2. Remove Sheets write operations
3. Keep Sheets as backup export destination
4. Remove cache layer (Supabase becomes primary)

---

## Design Patterns

### Repository Pattern (Data Access)

All data access goes through repository classes. During MVP phase, repositories implement dual-write to both Google Sheets and Supabase.

```typescript
// Example: /lib/repositories/inventory.repository.ts
export class InventoryRepository {
  async findById(id: string): Promise<InventoryItem | null> {
    // Read from cache, fallback to Sheets
  }

  async create(item: CreateInventoryInput): Promise<InventoryItem> {
    // Write to Sheets (primary)
    // Then async write to Supabase
  }
}
```

### Service Layer (Business Logic)

Services coordinate between repositories and external APIs. Stateless, dependency-injected.

```typescript
// Example: /lib/services/purchase.service.ts
export class PurchaseService {
  constructor(
    private purchaseRepo: PurchaseRepository,
    private inventoryRepo: InventoryRepository,
    private aiService: AIService
  ) {}

  async createFromNaturalLanguage(text: string): Promise<Purchase> {
    const parsed = await this.aiService.parsePurchase(text);
    return this.purchaseRepo.create(parsed);
  }
}
```

### Adapter Pattern (External Integrations)

Each platform has an adapter implementing `PlatformAdapter` interface.

```typescript
// Example: /lib/adapters/bricklink.adapter.ts
export class BrickLinkAdapter implements PlatformAdapter {
  platform = 'bricklink' as const;

  async testConnection(): Promise<boolean> { /* ... */ }
  async fetchOrders(params?: OrderFetchParams): Promise<PlatformOrder[]> { /* ... */ }
  async fetchOrder(orderId: string): Promise<PlatformOrder> { /* ... */ }
}
```

---

## UI Performance Patterns

### Loading States

All dynamic imports MUST include a loading fallback:

```typescript
// GOOD - with loading skeleton
const InventoryTable = dynamic(
  () => import('@/components/features/inventory').then((mod) => ({ default: mod.InventoryTable })),
  { ssr: false, loading: () => <TableSkeleton /> }
);

// BAD - no loading state (causes blank screen)
const InventoryTable = dynamic(
  () => import('@/components/features/inventory').then((mod) => ({ default: mod.InventoryTable })),
  { ssr: false }
);
```

All route segments should have a `loading.tsx` file:
- Use `TableSkeleton` for list pages
- Use `WidgetCardSkeleton` for dashboard-style pages
- Import from `@/components/ui/skeletons`

### Bulk Operations

NEVER use sequential loops for bulk operations:

```typescript
// BAD - sequential API calls (slow)
for (const id of ids) {
  await deleteMutation.mutateAsync(id);
}

// GOOD - single batch API call
await bulkDeleteMutation.mutateAsync(ids);
```

All bulk operations should:
1. Have a dedicated batch API endpoint (`/api/[resource]/bulk`)
2. Use a dedicated hook (`useBulkDelete[Resource]`, `useBulkUpdate[Resource]`)
3. Accept arrays and process in a single database operation

### Cache Invalidation

Use surgical invalidation, not broad invalidation:

```typescript
// BAD - invalidates everything including details
queryClient.invalidateQueries({ queryKey: resourceKeys.all });

// GOOD - only invalidate affected query types
queryClient.invalidateQueries({ queryKey: resourceKeys.lists() });
queryClient.invalidateQueries({ queryKey: resourceKeys.summary() });
```

### Search Debouncing

All search inputs MUST be debounced to prevent excessive API calls:

```typescript
import { useDebouncedCallback } from 'use-debounce';

const debouncedSearch = useDebouncedCallback((value: string) => {
  onFiltersChange({ ...filters, search: value || undefined });
}, 300);
```

### Skeleton Components

Available skeleton components in `@/components/ui/skeletons`:

| Component | Use For |
|-----------|---------|
| `TableSkeleton` | DataTable loading states |
| `HeaderSkeleton` | Page header loading |
| `WidgetCardSkeleton` | Dashboard widget cards |
| `StatCardSkeleton` | Stat/metric widgets |
| `PageTitleSkeleton` | Page title and description |
| `PageSkeleton` | Full page with header and table |
| `DashboardSkeleton` | Dashboard page layout |

---

## API Route Conventions

### File Location
`/app/api/[resource]/route.ts`

### Standard Pattern

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const CreateSchema = z.object({
  setNumber: z.string().min(1),
  condition: z.enum(['New', 'Used']),
  cost: z.number().positive(),
});

export async function POST(request: NextRequest) {
  try {
    // 1. Auth check
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Validate input
    const body = await request.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({
        error: 'Validation failed',
        details: parsed.error.flatten()
      }, { status: 400 });
    }

    // 3. Business logic (uses dual-write internally)
    const result = await inventoryService.create(user.id, parsed.data);

    // 4. Return response
    return NextResponse.json({ data: result }, { status: 201 });

  } catch (error) {
    console.error('[POST /api/inventory] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

---

## State Management

### Server State (TanStack Query)

```typescript
// Fetching data
const { data, isLoading, error } = useQuery({
  queryKey: ['inventory', filters],
  queryFn: () => fetchInventory(filters),
});

// Mutations with optimistic updates
const mutation = useMutation({
  mutationFn: createInventoryItem,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['inventory'] });
  },
});
```

### Client State (Zustand)

```typescript
// /stores/ui.store.ts
export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  activeModal: null,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  openModal: (modal) => set({ activeModal: modal }),
  closeModal: () => set({ activeModal: null }),
}));
```

---

## Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Files (utilities) | kebab-case | `format-currency.ts` |
| Files (components) | PascalCase | `InventoryTable.tsx` |
| Variables/functions | camelCase | `calculateTotalCost` |
| Types/interfaces | PascalCase | `InventoryItem` |
| Database tables | snake_case | `inventory_items` |
| API endpoints | kebab-case | `/api/inventory-items` |
| Environment vars | SCREAMING_SNAKE | `SUPABASE_URL` |

---

## Testing Guidelines

### Unit Tests (Vitest)

```typescript
// /lib/utils/__tests__/format-currency.test.ts
import { describe, it, expect } from 'vitest';
import { formatCurrency } from '../format-currency';

describe('formatCurrency', () => {
  it('formats GBP correctly', () => {
    expect(formatCurrency(1234.56, 'GBP')).toBe('£1,234.56');
  });

  it('handles zero', () => {
    expect(formatCurrency(0, 'GBP')).toBe('£0.00');
  });
});
```

### Integration Tests (API Routes)

```typescript
// /app/api/inventory/__tests__/route.test.ts
import { describe, it, expect, vi } from 'vitest';
import { POST } from '../route';

describe('POST /api/inventory', () => {
  it('requires authentication', async () => {
    const request = new Request('http://localhost/api/inventory', {
      method: 'POST',
      body: JSON.stringify({ setNumber: '75192' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });
});
```

---

## Common Commands

```powershell
# Development
npm run dev                 # Start Next.js dev server

# Code Quality
npm run typecheck          # TypeScript check
npm run lint               # ESLint
npm run lint:fix           # ESLint with auto-fix
npm run format             # Prettier format

# Testing (via agents preferred)
npm test                   # Run all tests
npm test -- --watch        # Watch mode
npm test -- --coverage     # Coverage report

# Database (Cloud Supabase)
npm run db:push            # Push migrations to cloud
npm run db:types           # Regenerate types from cloud schema

# Google Sheets
npm run sheets:test        # Test Sheets connection
npm run migrate:inventory  # Migrate inventory data
npm run validate:reconcile # Validate data sync

# Build
npm run build              # Production build
npm run start              # Start production server

# Cache clearing (PowerShell)
Remove-Item -Recurse -Force node_modules/.cache, .next -ErrorAction SilentlyContinue
```

---

## Environment Variables

Required in `.env.local`:

```powershell
# Supabase (Cloud)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Google Sheets (required for Sheets-primary mode)
GOOGLE_CREDENTIALS_PATH=     # Path to service account JSON
GOOGLE_SHEETS_ID=            # Spreadsheet ID
ENABLE_SHEETS_WRITE=true     # Enable dual-write to Sheets

# Optional: Alternative to credentials file
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=

# AI
ANTHROPIC_API_KEY=
GOOGLE_AI_API_KEY=

# eBay Integration (OAuth 2.0)
EBAY_CLIENT_ID=              # eBay App ID (Client ID)
EBAY_CLIENT_SECRET=          # eBay Cert ID (Client Secret)
EBAY_REDIRECT_URI=           # OAuth callback URL (e.g., http://localhost:3000/api/integrations/ebay/callback)
EBAY_SANDBOX=false           # Set to 'true' for sandbox testing

# Notifications (optional - for two-phase Amazon sync)
RESEND_API_KEY=              # Resend API key for email notifications
PUSHOVER_USER_KEY=           # Pushover user key for push notifications
PUSHOVER_API_TOKEN=          # Pushover application token

# Platform credentials stored encrypted in platform_credentials table
```

---

## Security Reminders

1. **Never commit credentials** - Use environment variables
2. **Always use RLS** - Every table must have Row Level Security policies
3. **Validate all inputs** - Use Zod schemas on every API route
4. **Check auth on every request** - Protected routes must verify session
5. **Encrypt platform credentials** - Store in platform_credentials table with encryption
6. **Sanitize user content** - Escape HTML, prevent XSS
7. **Use parameterized queries** - Never concatenate SQL strings

---

## Platform Integration Notes

### BrickLink
- OAuth 1.0a authentication
- Rate limit: 5000 requests/day
- Adapter: `/lib/adapters/bricklink.adapter.ts`

### Brick Owl
- API key authentication
- Adapter: `/lib/adapters/brickowl.adapter.ts`

### Bricqer
- API key + tenant URL authentication
- API endpoint: `{tenant_url}/api/v1/`
- Adapter: `/lib/adapters/bricqer.adapter.ts`
- [API Docs](https://www.bricqer.com/guides/using-the-api)

### eBay / Amazon
- CSV import only (no API integration)
- Import handlers: `/lib/importers/`

---

## AI Usage Guidelines

### Claude API (Primary)
- Model: `claude-sonnet-4-20250514` for purchase parsing
- Temperature: 0.3 (structured outputs)
- Always validate responses with Zod
- Implement retry with exponential backoff

### Prompts Location
All AI prompts in: `/lib/ai/prompts/`
- `parse-purchase.ts` - Natural language purchase parsing
- `calculate-distance.ts` - Mileage calculation for collections

---

## Troubleshooting

### Supabase Connection Issues
```powershell
# Verify environment variables are set
echo $env:NEXT_PUBLIC_SUPABASE_URL

# Check cloud Supabase dashboard for service status
# Verify RLS policies allow the operation

# Regenerate types if schema changed
npm run db:types

# Clear caches and restart
Remove-Item -Recurse -Force node_modules/.cache, .next -ErrorAction SilentlyContinue
npm run dev
```

### Google Sheets Sync Issues
```powershell
# Test Sheets connection
npm run sheets:test

# Check credentials are set
echo $env:GOOGLE_SHEETS_ID

# Verify service account has Editor access to the spreadsheet
# Check sync status in UI (🟢/🟡/🔴 indicators)
```

### Type Generation Issues
```powershell
npm run db:types       # Regenerate from cloud schema
```

### Build Failures
```powershell
Remove-Item -Recurse -Force .next, node_modules -ErrorAction SilentlyContinue
npm install
npm run build
```

### Stale Code / Changes Not Appearing
```powershell
# Clear all caches
Remove-Item -Recurse -Force node_modules/.cache, .next -ErrorAction SilentlyContinue
npm run dev
```

---

## Links

- [PRD Document](./docs/PRD.md)
- [Supabase Dashboard](https://supabase.com/dashboard)
- [Vercel Dashboard](https://vercel.com/dashboard)
- [BrickLink API Docs](https://www.bricklink.com/v3/api.page)
- [Brick Owl API Docs](https://www.brickowl.com/api)
- [Bricqer API Docs](https://www.bricqer.com/guides/using-the-api)

---

*Last Updated: December 2025*
