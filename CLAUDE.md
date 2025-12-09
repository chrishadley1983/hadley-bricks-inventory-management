# Hadley Bricks Inventory System - Claude Code Instructions

## Project Overview

A comprehensive Lego resale business management system for tracking inventory, purchases, orders across multiple platforms (Amazon, eBay, BrickLink, Brick Owl), and financial reporting. Built for personal use with architecture designed for future commercial SaaS scaling.

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

## Project Structure

```
hadley-bricks/
├── apps/
│   └── web/                      # Next.js 14 web application
│       ├── app/                  # App router pages
│       │   ├── (auth)/           # Auth pages (login, register)
│       │   ├── (dashboard)/      # Protected dashboard pages
│       │   └── api/              # API routes
│       ├── components/           # React components
│       │   ├── ui/               # shadcn/ui components
│       │   ├── forms/            # Form components
│       │   └── features/         # Feature-specific components
│       ├── hooks/                # Custom React hooks
│       ├── stores/               # Zustand stores
│       ├── lib/                  # Utilities and helpers
│       │   ├── supabase/         # Supabase client
│       │   ├── api/              # API client functions
│       │   └── utils/            # General utilities
│       └── types/                # TypeScript types
├── packages/
│   ├── database/                 # Supabase types and client
│   └── shared/                   # Shared types and utilities
├── supabase/
│   ├── functions/                # Edge Functions
│   │   ├── ai-parse-purchase/
│   │   ├── bricklink-sync/
│   │   ├── brickowl-sync/
│   │   └── ...
│   └── migrations/               # Database migrations
├── docs/                         # Documentation
│   ├── PRD.md
│   └── API.md
└── CLAUDE.md                     # This file
```

---

## ⚠️ CRITICAL: Verification Checklist

**Before reporting ANY change as complete, Claude MUST verify ALL applicable items:**

### Code Changes
- [ ] TypeScript compiles with no errors (`npm run typecheck`)
- [ ] ESLint passes with no errors (`npm run lint`)
- [ ] Prettier formatting applied (`npm run format`)
- [ ] All new functions have JSDoc comments
- [ ] No `any` types - use proper typing

### Database Changes
- [ ] Migration file created in `supabase/migrations/`
- [ ] Migration applied successfully (`npm run db:migrate`)
- [ ] RLS policies added for new tables
- [ ] Indexes added for foreign keys and common queries
- [ ] Types regenerated (`npm run db:types`)

### API Changes
- [ ] Zod schema created for request validation
- [ ] Error handling with proper status codes
- [ ] Auth middleware applied to protected routes
- [ ] Rate limiting considered
- [ ] Response matches expected type

### Frontend Changes
- [ ] Component renders without console errors
- [ ] Loading states implemented
- [ ] Error states implemented
- [ ] Mobile responsive (check at 375px, 768px, 1024px)
- [ ] Keyboard navigation works

### Testing
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

```bash
# 1. Start Supabase locally
npx supabase start

# 2. Start Next.js dev server
npm run dev

# 3. Verify both are running before making changes
```

### Git Workflow

```bash
# Feature branches
git checkout -b feature/[feature-name]

# Commit messages - use conventional commits
feat: add inventory aging report
fix: correct BrickLink order sync duplicate detection
refactor: extract repository pattern for inventory
docs: update API documentation
test: add unit tests for cost calculation

# Before pushing
npm run typecheck
npm run lint
npm test
```

### Database Changes

```bash
# Create migration
npx supabase migration new [descriptive_name]

# Apply migration
npm run db:migrate

# Regenerate types
npm run db:types

# Reset database (development only!)
npm run db:reset
```

---

## Design Patterns

### Repository Pattern (Data Access)

All data access goes through repository classes. During MVP phase, repositories implement dual-write to both Google Sheets and Supabase.

```typescript
// Example: /lib/repositories/inventory.repository.ts
export class InventoryRepository {
  async findById(id: string): Promise<InventoryItem | null> {
    // Read from Supabase (primary after migration)
  }
  
  async create(item: CreateInventoryInput): Promise<InventoryItem> {
    // Write to Supabase
    // TODO: Remove after migration - also write to Google Sheets
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

Each platform has an adapter that normalizes API responses to internal types.

```typescript
// Example: /lib/adapters/bricklink.adapter.ts
export class BrickLinkAdapter implements PlatformAdapter {
  async fetchOrders(): Promise<PlatformOrder[]> {
    const rawOrders = await this.client.getOrders();
    return rawOrders.map(this.normalizeOrder);
  }
  
  private normalizeOrder(raw: BrickLinkRawOrder): PlatformOrder {
    // Transform BrickLink-specific format to internal type
  }
}
```

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

    // 3. Business logic
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

```bash
# Development
npm run dev                 # Start Next.js dev server
npx supabase start         # Start local Supabase

# Code Quality
npm run typecheck          # TypeScript check
npm run lint               # ESLint
npm run lint:fix           # ESLint with auto-fix
npm run format             # Prettier format

# Testing
npm test                   # Run all tests
npm test -- --watch        # Watch mode
npm test -- --coverage     # Coverage report

# Database
npm run db:migrate         # Apply migrations
npm run db:types           # Regenerate types
npm run db:reset           # Reset database (dev only)
npm run db:seed            # Seed test data

# Build
npm run build              # Production build
npm run start              # Start production server
```

---

## Environment Variables

Required in `.env.local`:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# AI
ANTHROPIC_API_KEY=
GOOGLE_AI_API_KEY=

# External APIs (stored encrypted in DB, these are for Edge Functions)
# BrickLink and Brick Owl credentials stored per-user in platform_credentials table
```

---

## Security Reminders

1. **Never commit credentials** - Use environment variables
2. **Always use RLS** - Every table must have Row Level Security policies
3. **Validate all inputs** - Use Zod schemas on every API route
4. **Check auth on every request** - Protected routes must verify session
5. **Sanitize user content** - Escape HTML, prevent XSS
6. **Use parameterized queries** - Never concatenate SQL strings

---

## Migration Phase Notes

### Current Phase: MVP (Dual-Write)

During MVP, the system reads from Google Sheets but writes to both:
- ✅ Write to Supabase (primary)
- ✅ Write to Google Sheets (legacy, to be removed)

### Post-Migration

After data migration is complete:
- Remove all Google Sheets write operations
- Remove sheetsService.ts
- Update repositories to Supabase-only

---

## Platform Integration Notes

### BrickLink
- OAuth 1.0a authentication
- Rate limit: 5000 requests/day
- Adapter: `/lib/adapters/bricklink.adapter.ts`

### Brick Owl
- API key authentication
- Adapter: `/lib/adapters/brickowl.adapter.ts`

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

### Supabase connection issues
```bash
npx supabase status  # Check if running
npx supabase stop && npx supabase start  # Restart
```

### Type generation issues
```bash
npx supabase db reset  # Reset DB
npm run db:types       # Regenerate
```

### Build failures
```bash
rm -rf .next node_modules
npm install
npm run build
```

---

## Links

- [PRD Document](./docs/PRD.md)
- [Supabase Dashboard](https://supabase.com/dashboard)
- [Vercel Dashboard](https://vercel.com/dashboard)
- [BrickLink API Docs](https://www.bricklink.com/v3/api.page)
- [Brick Owl API Docs](https://www.brickowl.com/api)

---

*Last Updated: December 2024*
