# Done Criteria: scanner-web-ui

**Created:** 2026-03-19
**Author:** Define Done Agent + Chris
**Status:** APPROVED

---

## Feature Summary

Build a web UI for the LEGO conveyor belt scanner that provides: a dashboard for viewing scan sessions, a session detail page for browsing identified pieces, a piece review workflow for correcting flagged identifications, a live scanner dashboard for monitoring scans in progress, persistent set-check state, and inventory integration to link scanned pieces to the existing inventory system.

**Problem:** The scanner CLI persists results to Supabase but there's no way to view, review, or act on them from the web app. Set-check progress is lost if the CLI crashes. Scanned pieces exist in isolation with no link to inventory records.

**User:** Chris (business owner)

---

## Component 1: Scanner Sessions Page

Browse past scan sessions with stats, filter by status/date, and navigate to detail.

### File Structure

```
apps/web/src/
  app/(dashboard)/scanner/
    page.tsx                              # Sessions list page
    loading.tsx                           # Skeleton
  app/api/scanner/sessions/
    route.ts                              # GET: list sessions (paginated, filtered)
  components/features/scanner/
    ScannerSessionsTable.tsx              # DataTable with columns
    ScannerSessionColumns.tsx             # Column definitions
    ScannerFilters.tsx                    # Status/date filter bar
    index.ts                             # Barrel export
  hooks/
    use-scanner.ts                        # Query hooks + key factory
  lib/
    api/scanner.ts                        # Fetch functions
    repositories/scanner.repository.ts    # Supabase data access
  types/scanner.ts                        # TypeScript types
```

### Success Criteria

#### F1.1: Sessions List Page
- **Tag:** AUTO_VERIFY
- **Criterion:** `/scanner` page renders a DataTable of all `scanner_sessions` rows, sorted by `started_at` desc, with server-side pagination (50/page default)
- **Columns:** Status (badge), Started, Duration, Total Pieces, Accepted, Flagged, Confidence Threshold, Actions
- **Evidence:** Page loads with skeleton, then shows table; pagination controls work; empty state shown when no sessions

#### F1.2: Session Status Badges
- **Tag:** AUTO_VERIFY
- **Criterion:** Status column renders colour-coded badges: green=completed, yellow=scanning/paused, blue=calibrating, red=aborted
- **Evidence:** Badge component with correct variant per status string

#### F1.3: Filter by Status and Date Range
- **Tag:** AUTO_VERIFY
- **Criterion:** Filter bar above table with status dropdown (all/completed/scanning/aborted) and date range picker; filters passed as query params to API; debounced search by session ID
- **Evidence:** Changing filters triggers refetch with updated params; URL reflects filter state

#### F1.4: Duration & Throughput Derived Columns
- **Tag:** AUTO_VERIFY
- **Criterion:** Duration calculated from `started_at` to `ended_at` (or "In progress" if null). Throughput (pieces/min) derived from `summary_json.pieces_per_minute`
- **Evidence:** Duration displays as "2m 34s" format; throughput as "5.2/min"

#### F1.5: Navigation to Detail
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking a session row or "View" action navigates to `/scanner/{sessionId}`
- **Evidence:** Router push on row click; link in actions column

#### F1.6: Sidebar Navigation Entry
- **Tag:** AUTO_VERIFY
- **Criterion:** "Scanner" item added to sidebar navigation under a new section or as a main nav item, using the `Camera` Lucide icon
- **Evidence:** Sidebar shows Scanner link; active state highlights when on `/scanner/*`

---

## Component 2: Session Detail Page

View all pieces identified in a scan session with images, confidence scores, and candidate alternatives.

### File Structure

```
apps/web/src/
  app/(dashboard)/scanner/[sessionId]/
    page.tsx                              # Session detail page
    loading.tsx                           # Skeleton
  app/api/scanner/sessions/[sessionId]/
    route.ts                              # GET: session + pieces
  components/features/scanner/
    ScannerSessionDetail.tsx              # Detail layout
    ScannerPiecesTable.tsx                # Pieces DataTable
    ScannerPieceColumns.tsx               # Piece column definitions
    PieceImageCell.tsx                    # Image thumbnail in table
    PieceCandidatesPopover.tsx            # Top-N candidates popover
```

### Success Criteria

#### F2.1: Session Header Card
- **Tag:** AUTO_VERIFY
- **Criterion:** Top of page shows a Card with session metadata: ID, status badge, start/end time, duration, confidence threshold, camera config (IP, FPS), and summary stats (total/accepted/flagged/error/unique parts/throughput)
- **Evidence:** Card renders with all fields populated from `scanner_sessions` row + `summary_json`

#### F2.2: Pieces Table
- **Tag:** AUTO_VERIFY
- **Criterion:** Below header, a DataTable lists all `scanner_pieces` for this session, paginated (100/page), sorted by `created_at` asc. Columns: #, Image, Part ID, Name, Category, Confidence, Status, Sharpness, Actions
- **Evidence:** Table loads all pieces; pagination works; columns sortable

#### F2.3: Image Thumbnails
- **Tag:** AUTO_VERIFY
- **Criterion:** Image column shows a 48x48px thumbnail loaded from Supabase Storage (`scanner-images/{session_id}/{piece_id}.jpg`). Clicking opens full-size in a Dialog. Placeholder shown if `image_path` is null
- **Evidence:** Images load via signed URL or public URL; dialog shows full image; broken image fallback works

#### F2.4: Confidence Visualisation
- **Tag:** AUTO_VERIFY
- **Criterion:** Confidence column shows both a percentage and a colour-coded progress bar: green >=80%, yellow 60-79%, red <60%
- **Evidence:** Progress bar renders with correct colour thresholds

#### F2.5: Top Candidates Popover
- **Tag:** AUTO_VERIFY
- **Criterion:** Hovering/clicking the Part ID cell opens a Popover showing up to 5 candidates from `top_results_json` with: rank, name, part ID, score, and reference image URL
- **Evidence:** Popover renders candidate list; scores shown as percentages

#### F2.6: Filter Pieces by Status
- **Tag:** AUTO_VERIFY
- **Criterion:** Tabs or filter above pieces table: All / Accepted / Flagged / Error. Counts shown on each tab
- **Evidence:** Switching tabs filters the table; counts update correctly

#### F2.7: Export Session
- **Tag:** AUTO_VERIFY
- **Criterion:** "Export" button in session header with dropdown: JSON (consolidated by part) and CSV (flat). Downloads generated client-side from the loaded pieces data, matching the CLI export format
- **Evidence:** Both formats download correctly; JSON groups by part_id with quantity and avg_confidence

---

## Component 3: Piece Review Workflow

Web-based review for flagged pieces — replaces/supplements the CLI review mode.

### File Structure

```
apps/web/src/
  app/api/scanner/pieces/[pieceId]/review/
    route.ts                              # PATCH: update reviewed piece
  components/features/scanner/
    PieceReviewDialog.tsx                 # Review modal
    PieceReviewQueue.tsx                  # Queue of flagged pieces
    ReviewCandidateCard.tsx               # Candidate selection card
```

### Success Criteria

#### F3.1: Review Button on Flagged Pieces
- **Tag:** AUTO_VERIFY
- **Criterion:** Flagged pieces in the pieces table show a "Review" button in the Actions column. Clicking opens `PieceReviewDialog`
- **Evidence:** Button renders only for status=flagged; opens dialog on click

#### F3.2: Review Dialog Layout
- **Tag:** AUTO_VERIFY
- **Criterion:** Dialog shows: piece image (large), current identification (part ID + name + confidence), and up to 5 candidate cards from `top_results_json`. Each card shows: reference image, part name, part ID, confidence score, and a "Select" button
- **Evidence:** Dialog renders all candidates; image displayed prominently

#### F3.3: Accept Candidate
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking "Select" on a candidate sends PATCH to `/api/scanner/pieces/{pieceId}/review` with `{ reviewed_item_id, status: 'accepted' }`. Updates `reviewed_at` timestamp. Table refreshes to show updated status
- **Evidence:** API updates `scanner_pieces` row; UI optimistically updates; toast confirmation shown

#### F3.4: Manual Part ID Entry
- **Tag:** AUTO_VERIFY
- **Criterion:** Below candidates, an input field allows typing a manual part number. "Accept Manual" button sends the same PATCH with the typed ID
- **Evidence:** Input validates non-empty; PATCH sent with manual ID; piece updated

#### F3.5: Reject Piece
- **Tag:** AUTO_VERIFY
- **Criterion:** "Reject" button marks piece as `status='rejected'` via PATCH. Rejected pieces are dimmed in the table
- **Evidence:** Status updated; table shows rejected pieces with reduced opacity

#### F3.6: Review Queue Mode
- **Tag:** AUTO_VERIFY
- **Criterion:** "Review All Flagged" button in session detail opens a sequential review queue — auto-advances to next flagged piece after each review decision (accept/reject/skip). Progress shown: "3 of 12 flagged"
- **Evidence:** Queue advances automatically; progress counter updates; "Done" shown when queue empty

#### F3.7: Bulk Accept Top Candidate
- **Tag:** AUTO_VERIFY
- **Criterion:** In session detail, a "Bulk Accept" button accepts the top candidate for all flagged pieces where top confidence >= a user-adjustable threshold (default 0.5). Confirmation dialog shows count and threshold
- **Evidence:** Single API call updates multiple pieces; count matches expected; confirmation required

---

## Component 4: Live Scanner Dashboard

Real-time view of an in-progress scan session, updating as pieces are identified.

### File Structure

```
apps/web/src/
  app/(dashboard)/scanner/live/
    page.tsx                              # Live dashboard
  app/api/scanner/sessions/active/
    route.ts                              # GET: currently active session
  components/features/scanner/
    LiveScannerDashboard.tsx              # Main live view
    LivePieceFeed.tsx                     # Rolling feed of identified pieces
    LiveStatsBar.tsx                      # Running stats (total, rate, etc.)
    LivePieceCard.tsx                     # Individual piece card in feed
```

### Success Criteria

#### F4.1: Active Session Detection
- **Tag:** AUTO_VERIFY
- **Criterion:** `/scanner/live` queries for `scanner_sessions` where `status IN ('scanning', 'calibrating', 'paused')`. If found, shows live dashboard. If none, shows "No active scan — start one from the CLI" message
- **Evidence:** Query correctly finds active sessions; empty state is clear

#### F4.2: Auto-Refreshing Stats Bar
- **Tag:** AUTO_VERIFY
- **Criterion:** Top bar shows: session status (badge), duration (ticking), total pieces, accepted/flagged/error counts, throughput (pieces/min). Stats refresh every 5 seconds via polling (TanStack Query `refetchInterval: 5000`)
- **Evidence:** Stats update without page reload; duration ticks; counts increase as CLI scans

#### F4.3: Rolling Piece Feed
- **Tag:** AUTO_VERIFY
- **Criterion:** Below stats, a vertical feed shows the most recent 20 pieces in reverse chronological order. Each card shows: thumbnail, part name, confidence bar, status badge. New pieces prepend to the list on each poll cycle
- **Evidence:** Feed updates every 5 seconds; new pieces appear at top; feed limited to 20 items; images load from storage

#### F4.4: Piece Card Detail
- **Tag:** AUTO_VERIFY
- **Criterion:** Each piece card in the feed shows: image (64x64), part ID, name, confidence (coloured), status badge, top 3 candidate names. Clicking opens the full PieceReviewDialog (Component 3)
- **Evidence:** Card renders all fields; click opens review dialog; review updates reflected immediately

#### F4.5: Session Complete Transition
- **Tag:** AUTO_VERIFY
- **Criterion:** When session status changes to 'completed' or 'aborted', polling stops, a completion banner appears with summary stats, and a "View Full Session" button links to the session detail page
- **Evidence:** Polling stops (no more network requests); banner shows; link works

#### F4.6: Pause/Resume Indicator
- **Tag:** AUTO_VERIFY
- **Criterion:** When session status is 'paused', the stats bar shows a yellow "Paused" badge and a pulsing indicator. Feed shows last known pieces but notes "Scanning paused"
- **Evidence:** Badge changes colour; pulsing animation visible; feed paused message shown

---

## Component 5: Persistent Set-Check State

Persist set-check progress to Supabase so sessions survive CLI crashes and can be resumed.

### File Structure

```
supabase/migrations/
  YYYYMMDDHHMMSS_scanner_set_check_tables.sql   # New tables
apps/scanner/
  set_check_persistence.py                        # New persistence layer
apps/web/src/
  app/(dashboard)/scanner/set-check/
    page.tsx                                       # Set-check sessions list
  app/(dashboard)/scanner/set-check/[sessionId]/
    page.tsx                                       # Set-check detail + progress
  app/api/scanner/set-check/
    route.ts                                       # GET: list set-check sessions
  app/api/scanner/set-check/[sessionId]/
    route.ts                                       # GET: session + checklist state
  components/features/scanner/
    SetCheckSessionsTable.tsx                      # Set-check sessions list
    SetCheckProgress.tsx                            # Visual progress tracker
    SetCheckMissingParts.tsx                        # Missing parts table
    SetCheckExportButton.tsx                        # BrickLink XML export (web)
```

### Database Schema

```sql
-- Set-check sessions extend scanner_sessions
CREATE TABLE scanner_set_check_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES scanner_sessions(id) ON DELETE CASCADE,
    set_num TEXT NOT NULL,                     -- e.g., "75192-1"
    set_name TEXT NOT NULL,                    -- e.g., "Millennium Falcon"
    set_year INT,
    total_expected INT NOT NULL,               -- Total non-spare pieces expected
    total_unique INT NOT NULL,                 -- Unique part+color combos
    spare_count INT NOT NULL DEFAULT 0,        -- Total spare pieces
    parts_json JSONB NOT NULL,                 -- Full Rebrickable parts list (cached)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-piece checklist progress (survives crashes)
CREATE TABLE scanner_set_check_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    set_check_session_id UUID NOT NULL REFERENCES scanner_set_check_sessions(id) ON DELETE CASCADE,
    part_num TEXT NOT NULL,
    color_id INT NOT NULL,
    color_name TEXT NOT NULL,
    expected_qty INT NOT NULL,
    found_qty INT NOT NULL DEFAULT 0,
    is_spare BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(set_check_session_id, part_num, color_id)
);

CREATE INDEX idx_set_check_progress_session ON scanner_set_check_progress(set_check_session_id);
```

### Success Criteria

#### F5.1: Set-Check Session Created on Start
- **Tag:** AUTO_VERIFY
- **Criterion:** When `main.py --check-set 75192-1` starts, a `scanner_set_check_sessions` row is created with set metadata and the full parts list cached in `parts_json`. Linked to the `scanner_sessions` row via `session_id`
- **Evidence:** Row created with correct set_num, total_expected, parts_json populated

#### F5.2: Progress Persisted on Each Match
- **Tag:** AUTO_VERIFY
- **Criterion:** Each `checklist.mark_found()` call also upserts a `scanner_set_check_progress` row, incrementing `found_qty`. Uses `ON CONFLICT (set_check_session_id, part_num, color_id) DO UPDATE`
- **Evidence:** Progress rows created/updated in Supabase; `found_qty` matches CLI checklist state

#### F5.3: Resume from Persisted State
- **Tag:** AUTO_VERIFY
- **Criterion:** CLI flag `--resume` loads the most recent incomplete set-check session for the given set number, hydrates the `SetChecklist` from `scanner_set_check_progress` rows, and resumes scanning
- **Evidence:** After crash and restart with `--resume`, progress is preserved; `found_qty` values match pre-crash state

#### F5.4: Set-Check Sessions Web Page
- **Tag:** AUTO_VERIFY
- **Criterion:** `/scanner/set-check` lists all set-check sessions with columns: Set Number, Set Name, Progress (found/expected as progress bar), Status, Started, Duration, Actions (View/Export)
- **Evidence:** Page renders with data from `scanner_set_check_sessions` joined to `scanner_sessions`

#### F5.5: Set-Check Detail Web Page
- **Tag:** AUTO_VERIFY
- **Criterion:** `/scanner/set-check/{sessionId}` shows: set info card (name, year, image from Rebrickable), overall progress bar, and a table of all part+color entries sorted by: missing first, then by part number. Columns: Part, Color (with swatch), Name, Expected, Found, Needed, Status (complete/partial/missing)
- **Evidence:** Progress bar reflects real-time state; table sortable; colour swatches render from hex

#### F5.6: Missing Parts Table with BrickLink Export
- **Tag:** AUTO_VERIFY
- **Criterion:** "Missing Parts" tab filters to entries where `found_qty < expected_qty`. "Export to BrickLink XML" button generates the same XML format as the CLI `export_bricklink_xml()` method. Downloads as `set-check-{set_num}.xml`
- **Evidence:** XML matches CLI output format; download triggers; only missing parts included

#### F5.7: Rebrickable Parts List Cache
- **Tag:** AUTO_VERIFY
- **Criterion:** `parts_json` in `scanner_set_check_sessions` caches the full Rebrickable response so repeat views don't require API calls. Cache used for rendering the checklist in the web UI
- **Evidence:** Web page loads instantly from cached data; no Rebrickable API calls on page view

---

## Component 6: Inventory Integration

Link scanned pieces to existing inventory records, enabling "I scanned this pile — add it to my inventory" workflow.

### File Structure

```
apps/web/src/
  app/api/scanner/sessions/[sessionId]/link-inventory/
    route.ts                              # POST: create inventory records from scan
  app/api/scanner/pieces/[pieceId]/link/
    route.ts                              # POST: link single piece to inventory item
  components/features/scanner/
    LinkToInventoryDialog.tsx              # Bulk link dialog
    InventoryMatchCard.tsx                 # Shows matched inventory item
    ScanToInventoryWizard.tsx             # Step-by-step import wizard
```

### Success Criteria

#### F6.1: "Add to Inventory" Button on Session Detail
- **Tag:** AUTO_VERIFY
- **Criterion:** Session detail page shows an "Add to Inventory" button (only for completed sessions). Opens `ScanToInventoryWizard`
- **Evidence:** Button renders only for completed sessions; wizard opens on click

#### F6.2: Scan-to-Inventory Wizard — Step 1: Review
- **Tag:** AUTO_VERIFY
- **Criterion:** Step 1 shows all accepted pieces consolidated by part ID with quantities. User can adjust quantities, remove items, or change part IDs before proceeding. Flagged/error pieces are excluded by default but can be included via toggle
- **Evidence:** Consolidated list renders; quantity editable; toggle for flagged pieces works

#### F6.3: Scan-to-Inventory Wizard — Step 2: Match
- **Tag:** AUTO_VERIFY
- **Criterion:** Step 2 attempts to match each scanned part to an existing inventory item by Brickognize part ID → BrickLink part number mapping. Shows: matched (green, auto-linked), unmatched (yellow, needs manual selection), and ambiguous (orange, multiple candidates). User can search inventory to manually link unmatched items
- **Evidence:** Matching logic runs; results categorised correctly; manual search works

#### F6.4: Scan-to-Inventory Wizard — Step 3: Confirm & Create
- **Tag:** AUTO_VERIFY
- **Criterion:** Step 3 shows final summary: X items to update quantity, Y new items to create. "Confirm" button creates/updates inventory records in a single batch operation. For existing items, increments quantity. For new items, creates with part ID, name, category, condition=Used, quantity from scan
- **Evidence:** Batch API call; inventory records created/updated; toast confirmation with count

#### F6.5: Single Piece → Inventory Link
- **Tag:** AUTO_VERIFY
- **Criterion:** In session detail, each piece row has a "Link to Inventory" action that opens a search dialog to find and link to a specific inventory item. Creates a reference in `scanner_pieces` (new column: `inventory_item_id UUID REFERENCES inventory(id)`)
- **Evidence:** Search dialog finds inventory items; link created; piece row shows linked item name

#### F6.6: Set-Check → Purchase Integration
- **Tag:** AUTO_VERIFY
- **Criterion:** On a completed set-check session, a "Record as Purchase" button creates a purchase record for the set with: set number, source="Scanned", condition=Used, and links the set-check session. Missing parts cost estimated from BrickLink average pricing (if available) or flagged as "estimate needed"
- **Evidence:** Purchase record created; linked to set-check session; missing parts cost shown

#### F6.7: Inventory Item Scanner History
- **Tag:** AUTO_VERIFY
- **Criterion:** On the existing inventory item detail page, a new "Scanner History" section shows all `scanner_pieces` linked to this item (via `inventory_item_id`), with: scan date, session ID, confidence, and image thumbnail
- **Evidence:** Section renders on inventory detail; links back to scanner session; images load

---

## Error Handling

#### E1: Session Not Found (404)
- **Tag:** AUTO_VERIFY
- **Criterion:** Navigating to `/scanner/{nonexistent-id}` returns a "Session not found" message with a link back to `/scanner`. API route returns HTTP 404 with `{ error: "Session not found" }`
- **Evidence:** Page shows not-found state; no unhandled error; console clean

#### E2: API Auth Rejection
- **Tag:** AUTO_VERIFY
- **Criterion:** All scanner API routes (`/api/scanner/*`) reject unauthenticated requests with HTTP 401. Routes call `supabase.auth.getUser()` and return `{ error: "Unauthorized" }` if no valid session
- **Evidence:** Fetch without auth cookie returns 401; no data leaks

#### E3: Storage Image Missing
- **Tag:** AUTO_VERIFY
- **Criterion:** When `image_path` points to a deleted/missing file in Supabase Storage, the image cell shows a placeholder icon (not a broken image). No console errors thrown
- **Evidence:** Placeholder renders; `onError` handler on `<img>` swaps to fallback; no uncaught errors

#### E4: Empty Session (Zero Pieces)
- **Tag:** AUTO_VERIFY
- **Criterion:** Session detail page for a session with 0 pieces shows "No pieces scanned" empty state in the pieces table area. Export buttons are disabled. Summary stats show all zeros
- **Evidence:** Empty state message visible; export buttons have `disabled` attribute; stats render 0

#### E5: Review PATCH Failure
- **Tag:** AUTO_VERIFY
- **Criterion:** If the PATCH to `/api/scanner/pieces/{id}/review` fails (network error or 500), a red toast appears with "Failed to update piece — try again". The dialog stays open with the previous state preserved (no optimistic rollback to wrong state)
- **Evidence:** Toast appears on error; dialog remains open; piece status unchanged in table

#### E6: Bulk Accept Confirmation Required
- **Tag:** AUTO_VERIFY
- **Criterion:** The "Bulk Accept" action (F3.7) shows a confirmation dialog with the count and threshold before executing. Clicking "Cancel" aborts with no changes. No bulk mutation fires without explicit confirm
- **Evidence:** Dialog appears; cancel leaves data unchanged; confirm triggers mutation

#### E7: Set-Check Resume — No Session Found
- **Tag:** AUTO_VERIFY
- **Criterion:** Running `python main.py --check-set 75192-1 --resume` when no incomplete session exists for that set number prints "No incomplete session found for set 75192-1. Starting fresh." and begins a new session
- **Evidence:** Message printed to stderr; new session created; no crash

#### E8: Inventory Link — Item Already Linked
- **Tag:** AUTO_VERIFY
- **Criterion:** If a piece already has `inventory_item_id` set, the "Link to Inventory" action shows the current link with an "Unlink" option instead of the search dialog. Re-linking requires unlinking first
- **Evidence:** Linked piece shows inventory item name; "Unlink" button visible; no duplicate links

#### E9: Pagination Boundary
- **Tag:** AUTO_VERIFY
- **Criterion:** All list API routes (`/api/scanner/sessions`, `/api/scanner/set-check`) paginate with max 100 rows per request and handle the Supabase 1,000-row limit by using `.range()` queries. Total count returned via `{ count: 'exact' }`
- **Evidence:** API response includes `total` field; requests >100 rows still return correct total; page navigation works beyond page 10

---

## Performance

#### P1: Sessions Page Load
- **Tag:** AUTO_VERIFY
- **Criterion:** `/scanner` page renders the DataTable skeleton within 200ms and resolves data within 2 seconds for up to 500 sessions
- **Evidence:** Skeleton visible immediately on navigation; data appears within 2s; no blank white screen

#### P2: Session Detail Load
- **Tag:** AUTO_VERIFY
- **Criterion:** `/scanner/{id}` page loads session metadata + first page of pieces (100 rows) within 3 seconds. Image thumbnails load lazily (not blocking initial render)
- **Evidence:** Session header card renders before all images load; pieces table shows data within 3s

#### P3: Live Dashboard Polling Efficiency
- **Tag:** AUTO_VERIFY
- **Criterion:** Live dashboard polling (`refetchInterval: 5000`) fetches only new pieces since last poll (not full re-query). Uses `created_at > {lastSeen}` filter to minimise data transfer
- **Evidence:** Network tab shows subsequent polls returning only delta rows; response size decreases when no new pieces

#### P4: Export Generation
- **Tag:** AUTO_VERIFY
- **Criterion:** Client-side CSV/JSON export for a session with 500 pieces completes in under 2 seconds. No server round-trip required (generated from already-loaded data)
- **Evidence:** Export triggers download without API call; generation time < 2s for 500 pieces

#### P5: Set-Check Progress Persistence Latency
- **Tag:** AUTO_VERIFY
- **Criterion:** The upsert to `scanner_set_check_progress` on each `mark_found()` call adds less than 50ms overhead to the scanning pipeline (async, non-blocking to the detection loop)
- **Evidence:** Persistence runs via `asyncio.to_thread`; detection loop throughput unchanged vs non-persistent mode

---

## Integration

#### I1: Supabase Types Generated
- **Tag:** AUTO_VERIFY
- **Criterion:** After running `npm run db:types`, the generated types file includes `scanner_sessions`, `scanner_pieces`, `scanner_set_check_sessions`, and `scanner_set_check_progress` table types. TypeScript compilation succeeds with these types used in API routes and repositories
- **Evidence:** `npm run db:types` succeeds; `npm run typecheck` passes; no `any` casts needed for scanner tables

#### I2: RLS Policies on New Tables
- **Tag:** AUTO_VERIFY
- **Criterion:** `scanner_set_check_sessions` and `scanner_set_check_progress` have RLS enabled with policies restricting access to the owning user (via `scanner_sessions.user_id` join). The migration file includes `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and `CREATE POLICY` statements
- **Evidence:** Migration SQL contains RLS statements; authenticated user can only see own data; different user gets empty results

#### I3: Sidebar Integration
- **Tag:** AUTO_VERIFY
- **Criterion:** Scanner navigation items appear in the existing sidebar without breaking other navigation items. Active state correctly highlights for `/scanner`, `/scanner/live`, `/scanner/set-check` paths
- **Evidence:** All existing sidebar links still work; scanner links highlight correctly on their routes

#### I4: Inventory Detail Page Extension
- **Tag:** AUTO_VERIFY
- **Criterion:** The "Scanner History" section (F6.7) is added to the existing inventory item detail page without modifying its existing functionality. Section hidden when no scanner links exist for the item
- **Evidence:** Inventory detail page still loads correctly for items with and without scanner links; existing sections unchanged

#### I5: Scanner Repository Uses Existing Base Pattern
- **Tag:** AUTO_VERIFY
- **Criterion:** `scanner.repository.ts` follows the same repository pattern as `inventory.repository.ts`: extends or mirrors `BaseRepository`, uses `createServiceRoleClient()` in API routes and `createClient()` in client hooks, handles pagination via `.range()` with count
- **Evidence:** File structure matches existing repositories; import pattern consistent; pagination implemented

---

## Schema Changes Summary

### New Tables
| Table | Purpose |
|-------|---------|
| `scanner_set_check_sessions` | Set-check metadata + cached parts list |
| `scanner_set_check_progress` | Per-piece found/expected tracking |

### Altered Tables
| Table | Change |
|-------|--------|
| `scanner_pieces` | Add `inventory_item_id UUID REFERENCES inventory(id)` |
| `scanner_pieces` | Add `color_id INT`, `color_name TEXT` |

### New API Routes
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/scanner/sessions` | GET | List sessions (paginated, filtered) |
| `/api/scanner/sessions/[sessionId]` | GET | Session detail + pieces |
| `/api/scanner/sessions/active` | GET | Currently active session |
| `/api/scanner/sessions/[sessionId]/link-inventory` | POST | Bulk link to inventory |
| `/api/scanner/pieces/[pieceId]/review` | PATCH | Update piece review |
| `/api/scanner/pieces/[pieceId]/link` | POST | Link piece to inventory item |
| `/api/scanner/set-check` | GET | List set-check sessions |
| `/api/scanner/set-check/[sessionId]` | GET | Set-check detail + progress |

### New Web Pages
| Path | Purpose |
|------|---------|
| `/scanner` | Sessions list |
| `/scanner/[sessionId]` | Session detail |
| `/scanner/live` | Live scanning dashboard |
| `/scanner/set-check` | Set-check sessions list |
| `/scanner/set-check/[sessionId]` | Set-check detail + progress |

---

## Implementation Order

The components have dependencies and should be built in this order:

```
C1: Sessions Page ──────────────────► C2: Session Detail ──► C3: Piece Review
        │                                     │
        │                                     ▼
        │                              C4: Live Dashboard
        │
        ▼
C5: Persistent Set-Check ──────────► C6: Inventory Integration
```

**Phase 1 (Foundation):** C1 + C2 — establishes the data layer, types, hooks, and API routes that everything else depends on.

**Phase 2 (Interaction):** C3 + C4 — adds review workflow and real-time monitoring. C3 depends on C2's piece table. C4 depends on C1's session query infrastructure.

**Phase 3 (Persistence):** C5 — requires new Supabase migration + CLI changes + web pages. Independent of C3/C4 but benefits from C1/C2 patterns.

**Phase 4 (Integration):** C6 — last because it touches the existing inventory system and requires C2 (piece data) + C5 (set-check data) to be in place.

---

## Out of Scope

- Mobile/responsive optimisation (desktop-first, same as rest of app)
- WebSocket/SSE for true real-time (polling at 5s is sufficient)
- Direct scanner control from web UI (start/stop/calibrate — CLI only)
- Brickognize API calls from web (identification happens in Python CLI only)
- Part image reference library / visual search
- Scanner settings/config management from web (use .env / CLI args)

---

## Dependencies

- Existing: `scanner_sessions` and `scanner_pieces` tables with RLS
- Existing: `scanner-images` Storage bucket
- Existing: Generated Supabase types (scanner tables already in `packages/database/src/types.ts`)
- New: Supabase migration for `scanner_set_check_sessions`, `scanner_set_check_progress`, `scanner_pieces.inventory_item_id`
- New: CLI changes for set-check persistence (Python `set_check_persistence.py`)

---

## Iteration Budget

- **Per component:** Max 3 iterations
- **Total:** 6 components across 4 phases
- **Escalation:** If any component doesn't converge in 3 iterations, pause for review

---

## Verification Summary

### Functional (40 criteria)

| ID | Criterion | Tag | Status |
|----|-----------|-----|--------|
| F1.1 | Sessions list page | AUTO_VERIFY | PENDING |
| F1.2 | Session status badges | AUTO_VERIFY | PENDING |
| F1.3 | Filter by status and date | AUTO_VERIFY | PENDING |
| F1.4 | Duration & throughput columns | AUTO_VERIFY | PENDING |
| F1.5 | Navigation to detail | AUTO_VERIFY | PENDING |
| F1.6 | Sidebar navigation entry | AUTO_VERIFY | PENDING |
| F2.1 | Session header card | AUTO_VERIFY | PENDING |
| F2.2 | Pieces table | AUTO_VERIFY | PENDING |
| F2.3 | Image thumbnails | AUTO_VERIFY | PENDING |
| F2.4 | Confidence visualisation | AUTO_VERIFY | PENDING |
| F2.5 | Top candidates popover | AUTO_VERIFY | PENDING |
| F2.6 | Filter pieces by status | AUTO_VERIFY | PENDING |
| F2.7 | Export session | AUTO_VERIFY | PENDING |
| F3.1 | Review button on flagged | AUTO_VERIFY | PENDING |
| F3.2 | Review dialog layout | AUTO_VERIFY | PENDING |
| F3.3 | Accept candidate | AUTO_VERIFY | PENDING |
| F3.4 | Manual part ID entry | AUTO_VERIFY | PENDING |
| F3.5 | Reject piece | AUTO_VERIFY | PENDING |
| F3.6 | Review queue mode | AUTO_VERIFY | PENDING |
| F3.7 | Bulk accept top candidate | AUTO_VERIFY | PENDING |
| F4.1 | Active session detection | AUTO_VERIFY | PENDING |
| F4.2 | Auto-refreshing stats bar | AUTO_VERIFY | PENDING |
| F4.3 | Rolling piece feed | AUTO_VERIFY | PENDING |
| F4.4 | Piece card detail | AUTO_VERIFY | PENDING |
| F4.5 | Session complete transition | AUTO_VERIFY | PENDING |
| F4.6 | Pause/resume indicator | AUTO_VERIFY | PENDING |
| F5.1 | Set-check session created | AUTO_VERIFY | PENDING |
| F5.2 | Progress persisted on match | AUTO_VERIFY | PENDING |
| F5.3 | Resume from persisted state | AUTO_VERIFY | PENDING |
| F5.4 | Set-check sessions web page | AUTO_VERIFY | PENDING |
| F5.5 | Set-check detail web page | AUTO_VERIFY | PENDING |
| F5.6 | Missing parts + BrickLink export | AUTO_VERIFY | PENDING |
| F5.7 | Rebrickable parts list cache | AUTO_VERIFY | PENDING |
| F6.1 | Add to Inventory button | AUTO_VERIFY | PENDING |
| F6.2 | Wizard Step 1: Review | AUTO_VERIFY | PENDING |
| F6.3 | Wizard Step 2: Match | AUTO_VERIFY | PENDING |
| F6.4 | Wizard Step 3: Confirm | AUTO_VERIFY | PENDING |
| F6.5 | Single piece inventory link | AUTO_VERIFY | PENDING |
| F6.6 | Set-check purchase integration | AUTO_VERIFY | PENDING |
| F6.7 | Inventory item scanner history | AUTO_VERIFY | PENDING |

### Error Handling (9 criteria)

| ID | Criterion | Tag | Status |
|----|-----------|-----|--------|
| E1 | Session not found (404) | AUTO_VERIFY | PENDING |
| E2 | API auth rejection | AUTO_VERIFY | PENDING |
| E3 | Storage image missing | AUTO_VERIFY | PENDING |
| E4 | Empty session (zero pieces) | AUTO_VERIFY | PENDING |
| E5 | Review PATCH failure | AUTO_VERIFY | PENDING |
| E6 | Bulk accept confirmation required | AUTO_VERIFY | PENDING |
| E7 | Set-check resume no session | AUTO_VERIFY | PENDING |
| E8 | Item already linked | AUTO_VERIFY | PENDING |
| E9 | Pagination boundary | AUTO_VERIFY | PENDING |

### Performance (5 criteria)

| ID | Criterion | Tag | Status |
|----|-----------|-----|--------|
| P1 | Sessions page load < 2s | AUTO_VERIFY | PENDING |
| P2 | Session detail load < 3s | AUTO_VERIFY | PENDING |
| P3 | Live dashboard delta polling | AUTO_VERIFY | PENDING |
| P4 | Export generation < 2s | AUTO_VERIFY | PENDING |
| P5 | Set-check persistence < 50ms overhead | AUTO_VERIFY | PENDING |

### Integration (5 criteria)

| ID | Criterion | Tag | Status |
|----|-----------|-----|--------|
| I1 | Supabase types generated | AUTO_VERIFY | PENDING |
| I2 | RLS policies on new tables | AUTO_VERIFY | PENDING |
| I3 | Sidebar integration | AUTO_VERIFY | PENDING |
| I4 | Inventory detail page extension | AUTO_VERIFY | PENDING |
| I5 | Scanner repository pattern | AUTO_VERIFY | PENDING |

**Total:** 59 criteria (59 AUTO_VERIFY, 0 HUMAN_VERIFY)

---

## Handoff

Ready for: `/build-feature scanner-web-ui` (start with Phase 1: C1 + C2)

**Key patterns to follow:**
- Reference `InventoryTable.tsx` for DataTable pattern
- Reference `orders/[id]/page.tsx` for detail page pattern
- Reference `use-arbitrage.ts` for hook/query key factory pattern
- Reference `inventory.repository.ts` for repository pattern
- All pages must use `dynamic()` import with skeleton fallback
- All API routes must check auth + validate with Zod
- Paginate all Supabase queries (1,000 row limit)
