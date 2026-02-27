# Data Access Patterns

## Architecture

This project uses a layered architecture:

```
React Components → Hooks → API Routes → Services → Repositories → Supabase/Sheets
```

### Canonical Examples

| Layer | Reference Files |
|-------|----------------|
| Repository (base) | `src/lib/repositories/base.repository.ts` |
| Repository (domain) | `src/lib/repositories/inventory.repository.ts` |
| Service | `src/lib/services/bricklink-sync.service.ts` |
| Platform adapter | `src/lib/adapters/platform-adapter.interface.ts` |
| Hooks | `src/hooks/use-arbitrage.ts` |

## Repository Pattern

All data access goes through repository classes in `src/lib/repositories/`.
Repositories handle dual-write to both Google Sheets and Supabase during the transition period.

## Service Layer

Services in `src/lib/services/` coordinate between repositories and external APIs.
Stateless, with dependencies passed via constructor.

## Platform Adapters

Each external platform has an adapter in `src/lib/adapters/` implementing `PlatformAdapter`.

| Platform | Auth | Notes |
|----------|------|-------|
| BrickLink | OAuth 1.0a | 5000 req/day |
| Brick Owl | API key | `src/lib/brickowl/` |
| Bricqer | API key + tenant URL | `src/lib/bricqer/` |
| eBay | OAuth 2.0 | `src/lib/ebay/` |
| Amazon | SP-API | `src/lib/amazon/` |

## Sheets-Primary Architecture (Current Phase)

Google Sheets remains the source of truth; Supabase acts as a cache.

**Read Path:** Supabase cache (TTL: 5 min) → fallback to Sheets → update cache → return
**Write Path:** Write to Sheets (blocking) → async sync to Supabase → invalidate cache
**Conflict Resolution:** Sheets always wins.

### Sync Status

Components display sync status via `useSyncStatus` hook:
- In sync (last sync < 5 min ago)
- Syncing (operation in progress)
- Sync error (needs retry)

### Post-Transition (Future)

1. Switch read path to Supabase-only
2. Remove Sheets write operations
3. Keep Sheets as backup export destination
4. Remove cache layer (Supabase becomes primary)
