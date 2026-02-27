# UI Patterns & Performance

## Loading States

All dynamic imports MUST include a loading fallback. No exceptions.

```typescript
// GOOD
const Component = dynamic(() => import('@/components/features/X'), {
  ssr: false,
  loading: () => <TableSkeleton />
});

// BAD - causes blank screen
const Component = dynamic(() => import('@/components/features/X'), { ssr: false });
```

All route segments should have a `loading.tsx` file.

### Available Skeleton Components

See `src/components/ui/skeletons.tsx` for all available skeletons:
- `TableSkeleton` - DataTable loading states
- `HeaderSkeleton` - Page header loading
- `WidgetCardSkeleton` - Dashboard widget cards
- `StatCardSkeleton` - Stat/metric widgets
- `PageTitleSkeleton` - Page title and description
- `PageSkeleton` - Full page with header and table
- `DashboardSkeleton` - Dashboard page layout

## Bulk Operations

NEVER use sequential loops for bulk operations:

```typescript
// BAD - sequential API calls
for (const id of ids) { await deleteMutation.mutateAsync(id); }

// GOOD - single batch API call
await bulkDeleteMutation.mutateAsync(ids);
```

All bulk operations should:
1. Have a dedicated batch API endpoint (`/api/[resource]/bulk`)
2. Use a dedicated hook (`useBulkDelete[Resource]`, `useBulkUpdate[Resource]`)
3. Accept arrays and process in a single database operation

## Cache Invalidation

Use surgical invalidation, not broad:

```typescript
// BAD
queryClient.invalidateQueries({ queryKey: resourceKeys.all });

// GOOD
queryClient.invalidateQueries({ queryKey: resourceKeys.lists() });
queryClient.invalidateQueries({ queryKey: resourceKeys.summary() });
```

## Search Debouncing

All search inputs MUST be debounced (300ms minimum):

```typescript
import { useDebouncedCallback } from 'use-debounce';

const debouncedSearch = useDebouncedCallback((value: string) => {
  onFiltersChange({ ...filters, search: value || undefined });
}, 300);
```

## State Management

### Server State (TanStack Query)

See `src/hooks/` for query/mutation patterns.
See `src/lib/api/` for API client functions used by hooks.

### Client State (Zustand)

See `src/stores/` for store patterns. Keep stores minimal - prefer server state.

## Naming

| Type | Convention | Example |
|------|-----------|---------|
| Files (utilities) | kebab-case | `format-currency.ts` |
| Files (components) | PascalCase | `InventoryTable.tsx` |
| Variables/functions | camelCase | `calculateTotalCost` |
| Types/interfaces | PascalCase | `InventoryItem` |
| Database tables | snake_case | `inventory_items` |
| Environment vars | SCREAMING_SNAKE | `SUPABASE_URL` |
