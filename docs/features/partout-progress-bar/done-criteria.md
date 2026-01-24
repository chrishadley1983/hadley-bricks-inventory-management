# Done Criteria: partout-progress-bar

**Created:** 2026-01-24
**Author:** Define Done Agent + Chris
**Status:** APPROVED

## Feature Summary

Add a real-time progress bar when loading part-out data from BrickLink. The progress bar shows "BrickLink Part Data being pulled" with a counter like "42 of 342 parts" as parts are fetched in batches. Uses Server-Sent Events (SSE) following the existing pattern from arbitrage sync.

## Success Criteria

### Functional

#### F1: Streaming API Endpoint Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** A GET endpoint exists at `/api/bricklink/partout/stream` that returns SSE events
- **Evidence:** Endpoint responds with `Content-Type: text/event-stream` header
- **Test:** `curl -H "Accept: text/event-stream" /api/bricklink/partout/stream?setNumber=75192-1` returns SSE format

#### F2: Progress Events Sent During Fetch
- **Tag:** AUTO_VERIFY
- **Criterion:** The streaming endpoint emits `progress` events containing `fetched` and `total` counts
- **Evidence:** SSE stream includes `data: {"type":"progress","fetched":10,"total":342}` format events
- **Test:** Parse SSE stream, verify progress events contain numeric fetched/total values

#### F3: Complete Event Returns PartoutData
- **Tag:** AUTO_VERIFY
- **Criterion:** When fetch completes, a `complete` event is emitted containing the full PartoutData
- **Evidence:** Final SSE event has `type: "complete"` with `data` property containing valid PartoutData
- **Test:** Parse final event, validate data matches PartoutData schema

#### F4: Progress Component Displays During Load
- **Tag:** AUTO_VERIFY
- **Criterion:** When partout data is being fetched, a progress component shows instead of skeleton
- **Evidence:** DOM contains element with text "BrickLink Part Data being pulled" during fetch
- **Test:** Navigate to Partout tab, verify progress text appears before data loads

#### F5: Progress Bar Shows Numeric Progress
- **Tag:** AUTO_VERIFY
- **Criterion:** Progress component displays "X of Y parts" format with updating numbers
- **Evidence:** DOM contains text matching pattern "\\d+ of \\d+ parts"
- **Test:** During fetch, query for progress text and verify it updates

#### F6: Progress Transitions to Data Display
- **Tag:** AUTO_VERIFY
- **Criterion:** When fetch completes, progress component is replaced by full data display
- **Evidence:** After complete event, PartoutSummary and PartoutTable components render
- **Test:** Wait for complete, verify `[data-testid="partout-tab"]` contains data display

#### F7: Force Refresh Uses Streaming
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking "Force Refresh" button triggers streaming fetch with progress display
- **Evidence:** Progress component appears after clicking Force Refresh
- **Test:** Click Force Refresh, verify progress component appears

### Error Handling

#### E1: Error Event on Failure
- **Tag:** AUTO_VERIFY
- **Criterion:** If fetch fails, an `error` event is emitted with error message
- **Evidence:** SSE event `{"type":"error","error":"..."}` is emitted
- **Test:** Simulate network error, verify error event received

#### E2: Error State Shows in UI
- **Tag:** AUTO_VERIFY
- **Criterion:** If streaming fetch fails, error is displayed in UI with retry option
- **Evidence:** Error alert appears with retry button
- **Test:** Trigger error, verify Alert component with "Retry" button renders

### Integration

#### I1: Uses Existing PartoutService onProgress
- **Tag:** AUTO_VERIFY
- **Criterion:** Streaming endpoint calls PartoutService.getPartoutValue with onProgress callback
- **Evidence:** Progress events are emitted after each batch (BATCH_SIZE = 10 parts)
- **Test:** Count progress events, verify they increment by batch size

#### I2: React Query Cache Updated
- **Tag:** AUTO_VERIFY
- **Criterion:** After streaming completes, React Query cache contains the fetched data
- **Evidence:** Subsequent tab switches show cached data instantly (no progress bar)
- **Test:** Fetch via streaming, switch tabs, return to Partout, verify instant load

### UI/UX

#### U1: Progress Bar Visual
- **Tag:** HUMAN_VERIFY
- **Criterion:** Progress bar is visually clear with spinner icon and percentage-based width
- **Evidence:** Visual inspection shows progress bar filling left-to-right
- **Verify:** Screenshot review before merge

#### U2: Cached Parts Indicator
- **Tag:** AUTO_VERIFY
- **Criterion:** If some parts are cached, progress shows "(X from cache)" indicator
- **Evidence:** When cached > 0, text includes cache count
- **Test:** With partial cache, verify "(X from cache)" text appears

## Out of Scope

- Cancellation of in-progress fetch
- Pause/resume functionality
- Offline support
- Background fetch when tab is hidden

## Dependencies

- BrickLink credentials configured
- PartoutService already supports onProgress callback
- Existing SSE pattern in arbitrage sync for reference

## Iteration Budget

- **Max iterations:** 5
- **Escalation:** If not converged after 5 iterations, pause for human review

## Files Likely Affected

| File | Change |
|------|--------|
| `apps/web/src/app/api/bricklink/partout/stream/route.ts` | NEW - SSE streaming endpoint |
| `apps/web/src/components/features/set-lookup/PartoutProgress.tsx` | NEW - Progress bar component |
| `apps/web/src/hooks/usePartout.ts` | MODIFY - Add streaming mutation |
| `apps/web/src/components/features/set-lookup/PartoutTab.tsx` | MODIFY - Use progress component |
| `apps/web/src/types/partout.ts` | MODIFY - Add streaming types |
