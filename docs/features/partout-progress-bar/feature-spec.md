# Feature Specification: partout-progress-bar

**Generated:** 2026-01-24
**Based on:** done-criteria.md
**Status:** READY_FOR_BUILD

---

## 1. Summary

Add real-time progress feedback when loading part-out data from BrickLink. The implementation uses Server-Sent Events (SSE) to stream progress updates from the backend as parts are fetched in batches. A new progress component replaces the skeleton loader, showing "BrickLink Part Data being pulled" with "X of Y parts" counter that updates in real-time. The pattern follows the existing SSE implementation in `/api/arbitrage/sync/bricklink`.

---

## 2. Criteria Mapping

| Criterion | Implementation Approach |
|-----------|------------------------|
| F1: Streaming endpoint | New GET route at `/api/bricklink/partout/stream` using TransformStream |
| F2: Progress events | Emit SSE events with `{type: 'progress', fetched, total}` after each batch |
| F3: Complete event | Emit `{type: 'complete', data: PartoutData}` when finished |
| F4: Progress component | New `PartoutProgress` component shown during streaming |
| F5: Numeric progress | Display "X of Y parts" text updated per progress event |
| F6: Transition to data | On complete, set React Query cache and show data display |
| F7: Force refresh streaming | Modify forceRefresh to use streaming endpoint |
| E1: Error event | Emit `{type: 'error', error: message}` on failure |
| E2: Error UI | Show Alert with Retry button on error |
| I1: Uses onProgress | Pass callback to PartoutService.getPartoutValue() |
| I2: Cache update | Update queryClient.setQueryData on complete |
| U1: Progress visual | Use shadcn Progress component with spinner |
| U2: Cached indicator | Include "(X from cache)" when cached > 0 |

---

## 3. Architecture

### 3.1 Integration Points

**Backend:**
- `PartoutService.getPartoutValue()` already accepts `onProgress` callback
- Existing SSE pattern in `/api/arbitrage/sync/bricklink` to follow
- Uses same auth/credentials pattern as existing `/api/bricklink/partout`

**Frontend:**
- `usePartout` hook manages state
- `PartoutTab` orchestrates display
- New `PartoutProgress` component for loading state

### 3.2 Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              UI Layer                                    │
│                                                                          │
│   PartoutTab                                                             │
│   ├── State: streamProgress: {fetched, total, cached, phase} | null    │
│   ├── if streamProgress → <PartoutProgress />                          │
│   └── else if data → <PartoutSummary /> + <PartoutTable />             │
│                                                                          │
│   usePartout hook                                                        │
│   ├── fetchWithStreaming(setNumber, forceRefresh, onProgress)          │
│   ├── Parses SSE events from stream                                     │
│   └── Updates React Query cache on complete                             │
│                                                                          │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ SSE Stream
                                     │ GET /api/bricklink/partout/stream
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            API Layer                                     │
│                                                                          │
│   /api/bricklink/partout/stream/route.ts                                │
│   ├── Auth check (getUser)                                              │
│   ├── Get BrickLink credentials                                          │
│   ├── Create TransformStream                                             │
│   ├── Call PartoutService.getPartoutValue({ onProgress })               │
│   │   ├── emit: {type: 'start', total, cached}                          │
│   │   ├── emit: {type: 'progress', fetched, total} (per batch)          │
│   │   └── emit: {type: 'complete', data}                                │
│   └── Return Response(stream.readable, headers: text/event-stream)     │
│                                                                          │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          Service Layer                                   │
│                                                                          │
│   PartoutService.getPartoutValue(setNumber, { onProgress })              │
│   ├── Fetch colors + subsets from BrickLink                              │
│   ├── Check cache → reports cached count                                 │
│   ├── Fetch uncached in batches (BATCH_SIZE = 10)                        │
│   │   └── onProgress(fetched, total) after each batch                   │
│   └── Returns PartoutData                                                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.3 SSE Event Types

```typescript
// Start event - sent immediately with totals
{ type: 'start', message: 'Fetching partout data...', total: 342, cached: 50 }

// Phase event - sent before each major phase
{ type: 'phase', phase: 'fetching-colors' | 'fetching-subsets' | 'fetching-parts' }

// Progress event - sent after each batch of 10 parts
{ type: 'progress', fetched: 20, total: 292 }  // 292 = total - cached

// Complete event - sent with final data
{ type: 'complete', data: PartoutData }

// Error event - sent on failure
{ type: 'error', error: 'BrickLink API rate limit exceeded' }
```

---

## 4. File Changes

### 4.1 New Files

| File | Purpose | Est. Lines |
|------|---------|------------|
| `apps/web/src/app/api/bricklink/partout/stream/route.ts` | SSE streaming endpoint | ~80 |
| `apps/web/src/components/features/set-lookup/PartoutProgress.tsx` | Progress bar component | ~50 |

### 4.2 Modified Files

| File | Changes | Est. Lines |
|------|---------|------------|
| `apps/web/src/types/partout.ts` | Add `PartoutStreamEvent` type | ~15 |
| `apps/web/src/hooks/usePartout.ts` | Add `fetchWithStreaming`, modify `forceRefresh` | ~60 |
| `apps/web/src/components/features/set-lookup/PartoutTab.tsx` | Use streaming for initial load + force refresh | ~40 |

### 4.3 No Changes Needed

| File | Reason |
|------|--------|
| `PartoutService` | Already has `onProgress` callback support |
| Database schema | No new tables needed |
| Existing partout API | Keep as fallback for non-streaming clients |

---

## 5. Implementation Details

### 5.1 Types (`types/partout.ts`)

```typescript
/** Phase of the partout streaming fetch */
export type PartoutStreamPhase = 'fetching-colors' | 'fetching-subsets' | 'fetching-parts';

/** Server-Sent Event types for partout streaming */
export interface PartoutStreamEvent {
  type: 'start' | 'phase' | 'progress' | 'complete' | 'error';
  message?: string;
  phase?: PartoutStreamPhase;
  fetched?: number;
  total?: number;
  cached?: number;
  data?: PartoutData;
  error?: string;
}
```

### 5.2 Streaming API Endpoint (`api/bricklink/partout/stream/route.ts`)

```typescript
// Key implementation points:

export const maxDuration = 300; // 5 minute timeout for large sets

export async function GET(request: NextRequest) {
  // 1. Auth check
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // 2. Get setNumber from query params
  const setNumber = request.nextUrl.searchParams.get('setNumber');
  const forceRefresh = request.nextUrl.searchParams.get('forceRefresh') === 'true';

  // 3. Get BrickLink credentials
  const credentials = await credentialsRepo.getCredentials(user.id, 'bricklink');

  // 4. Create TransformStream for SSE
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  // 5. Start async processing
  (async () => {
    try {
      // Emit start event
      await writer.write(encoder.encode(
        `data: ${JSON.stringify({ type: 'start', message: 'Fetching...' })}\n\n`
      ));

      // Call PartoutService with progress callback
      const data = await partoutService.getPartoutValue(setNumber, {
        forceRefresh,
        onProgress: async (fetched, total) => {
          await writer.write(encoder.encode(
            `data: ${JSON.stringify({ type: 'progress', fetched, total })}\n\n`
          ));
        },
      });

      // Emit complete event with data
      await writer.write(encoder.encode(
        `data: ${JSON.stringify({ type: 'complete', data })}\n\n`
      ));
    } catch (error) {
      await writer.write(encoder.encode(
        `data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`
      ));
    } finally {
      await writer.close();
    }
  })();

  // 6. Return SSE response
  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

### 5.3 Hook Changes (`hooks/usePartout.ts`)

```typescript
// Add new streaming state
interface StreamProgress {
  fetched: number;
  total: number;
  cached: number;
}

// Add fetchWithStreaming function
async function fetchWithStreaming(
  setNumber: string,
  forceRefresh: boolean,
  onProgress: (progress: StreamProgress) => void
): Promise<PartoutData> {
  const params = new URLSearchParams({ setNumber });
  if (forceRefresh) params.set('forceRefresh', 'true');

  const response = await fetch(`/api/bricklink/partout/stream?${params}`);
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  let cachedCount = 0;
  let result: PartoutData | null = null;

  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const event: PartoutStreamEvent = JSON.parse(line.slice(6));

        if (event.type === 'start' && event.cached) {
          cachedCount = event.cached;
        } else if (event.type === 'progress') {
          onProgress({
            fetched: event.fetched!,
            total: event.total!,
            cached: cachedCount
          });
        } else if (event.type === 'complete') {
          result = event.data!;
        } else if (event.type === 'error') {
          throw new Error(event.error);
        }
      }
    }
  }

  if (!result) throw new Error('Stream ended without data');
  return result;
}

// Export for use in component
export function usePartout(setNumber: string | null, enabled: boolean = true) {
  // ... existing query logic ...

  // Add streaming state
  const [streamProgress, setStreamProgress] = useState<StreamProgress | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  const fetchWithProgress = useCallback(async (forceRefresh: boolean = false) => {
    if (!setNumber) return { success: false, error: 'No set number' };

    setIsStreaming(true);
    setStreamProgress({ fetched: 0, total: 0, cached: 0 });

    try {
      const data = await fetchWithStreaming(setNumber, forceRefresh, setStreamProgress);
      queryClient.setQueryData(partoutKeys.detail(setNumber), data);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    } finally {
      setIsStreaming(false);
      setStreamProgress(null);
    }
  }, [setNumber, queryClient]);

  return {
    ...query,
    forceRefresh: () => fetchWithProgress(true),
    isForceRefreshing: isStreaming,
    streamProgress,
    isStreaming,
    fetchWithProgress,
  };
}
```

### 5.4 Progress Component (`PartoutProgress.tsx`)

```tsx
import { RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

interface PartoutProgressProps {
  fetched: number;
  total: number;
  cached?: number;
}

export function PartoutProgress({ fetched, total, cached = 0 }: PartoutProgressProps) {
  const percent = total > 0 ? Math.round((fetched / total) * 100) : 0;

  return (
    <Card>
      <CardContent className="py-8 space-y-4">
        <div className="flex items-center justify-center gap-2">
          <RefreshCw className="h-5 w-5 animate-spin text-primary" />
          <span className="text-lg font-medium">BrickLink Part Data being pulled</span>
        </div>

        <Progress value={percent} className="h-3" />

        <div className="text-center text-sm text-muted-foreground">
          {fetched} of {total} parts
          {cached > 0 && (
            <span className="ml-1">({cached} from cache)</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

### 5.5 PartoutTab Changes

```tsx
// Key changes:

export function PartoutTab({ setNumber, enabled }: PartoutTabProps) {
  const {
    data,
    isLoading,
    error,
    forceRefresh,
    isStreaming,
    streamProgress,
    fetchWithProgress,
  } = usePartout(setNumber, enabled);

  // Use streaming for initial load when no cached data
  useEffect(() => {
    if (enabled && setNumber && !data && !isLoading && !isStreaming) {
      fetchWithProgress(false);
    }
  }, [enabled, setNumber, data, isLoading, isStreaming, fetchWithProgress]);

  // Show progress during streaming
  if (isStreaming && streamProgress) {
    return (
      <PartoutProgress
        fetched={streamProgress.fetched}
        total={streamProgress.total}
        cached={streamProgress.cached}
      />
    );
  }

  // ... rest of existing render logic ...
}
```

---

## 6. Build Order

### Step 1: Types (~15 lines)
Add `PartoutStreamEvent` and `PartoutStreamPhase` to `types/partout.ts`.

### Step 2: Streaming API Endpoint (~80 lines)
Create `api/bricklink/partout/stream/route.ts` following the arbitrage sync pattern.
- Auth check
- Query param parsing
- TransformStream setup
- PartoutService integration with onProgress
- Error handling

### Step 3: Progress Component (~50 lines)
Create `PartoutProgress.tsx` with:
- Spinner icon
- Progress bar
- "X of Y parts" text
- Cache indicator

### Step 4: Hook Changes (~60 lines)
Modify `usePartout.ts`:
- Add `fetchWithStreaming` function
- Add streaming state (`streamProgress`, `isStreaming`)
- Export `fetchWithProgress` for component use
- Keep existing query for cache reads

### Step 5: PartoutTab Integration (~40 lines)
Modify `PartoutTab.tsx`:
- Use streaming for initial load (when no cache)
- Use streaming for Force Refresh
- Show PartoutProgress during streaming
- Transition to data display on complete

---

## 7. Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| SSE connection drops mid-stream | Low | Medium | Error handling with retry button |
| Progress events out of order | Low | Low | UI handles any order (just updates count) |
| Large set (500+ parts) timeout | Medium | Medium | `maxDuration = 300` (5 minutes) |
| Rate limit during streaming | Medium | Low | PartoutService already handles gracefully |

### Scope Risks

| Risk | Mitigation |
|------|------------|
| Adding cancellation | Out of scope - documented in done-criteria |
| Background fetch | Out of scope - only active tab fetches |

---

## 8. Feasibility Validation

| Criterion | Feasible | Confidence | Notes |
|-----------|----------|------------|-------|
| F1: Streaming endpoint | ✅ Yes | High | Existing pattern to follow |
| F2: Progress events | ✅ Yes | High | PartoutService already has callback |
| F3: Complete event | ✅ Yes | High | Return full PartoutData |
| F4: Progress component | ✅ Yes | High | Simple UI component |
| F5: Numeric progress | ✅ Yes | High | Update state per event |
| F6: Transition | ✅ Yes | High | Set query cache on complete |
| F7: Force refresh | ✅ Yes | High | Same streaming mechanism |
| E1: Error event | ✅ Yes | High | Catch and emit |
| E2: Error UI | ✅ Yes | High | Existing Alert pattern |
| I1: onProgress | ✅ Yes | High | Already implemented in service |
| I2: Cache update | ✅ Yes | High | queryClient.setQueryData |
| U1: Progress visual | ✅ Yes | High | shadcn Progress exists |
| U2: Cached indicator | ✅ Yes | High | Include in progress text |

**Overall:** All 13 criteria are feasible with the planned approach.

---

## 9. Notes for Build Agent

- **Follow the arbitrage sync pattern exactly** - The SSE implementation in `/api/arbitrage/sync/bricklink` is the template
- **Don't break existing non-streaming endpoint** - Keep `/api/bricklink/partout` as-is for compatibility
- **BATCH_SIZE = 10** - Progress updates happen every 10 parts (see PartoutService line 24)
- **Progress reports uncached parts only** - The `total` in progress is `parts.length - cached.length`
- **Cache stats come from PartoutData** - The `cacheStats.fromCache` tells us how many were cached
- **Use existing shadcn Progress component** - Already available at `@/components/ui/progress`
- **maxDuration = 300** - Set this to handle large sets (Millennium Falcon has 700+ parts)

---

**Status:** READY_FOR_BUILD

**Next step:** `/build-feature partout-progress-bar`
