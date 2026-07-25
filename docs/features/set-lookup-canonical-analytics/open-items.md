# Set Lookup — canonical analytics: open items

**Branch:** `feature/set-lookup-canonical-analytics`
**Written:** 2026-07-25 (laptop handover), **updated:** 2026-07-25 (desktop session)
**Status:** pushed, PR open

The original handover listed everything NOT done. This revision records what has since
been closed and what genuinely remains.

---

## Closed this session

### §2.1 Exercised against live sets — DONE

Driven through a real browser (Playwright, dev server in a dedicated worktree on :3011,
never the main checkout — `next dev` there corrupts the bundle the NSSM service serves).

| Question | Answer |
|---|---|
| Does `assessment` arrive on the SSE `/stream`? | **Yes** — full payload, 4 SSE frames |
| Does it arrive on the plain `GET /api/bricklink/partout`? | **Yes** (see the bug below) |
| Does overlap populate? | **Yes** — 75192-1 New: 524 NEW / 16 R-OUT / 1 R-THIN / 143 DUP, £779.35 additional. No `Own-stock index failed` in the log. |
| Do magnets ever fire? | **Yes** — 7643-1 New: `54200 / Metallic Silver`, world supply 1 lot, STR 0.71 |
| Is 75192's "0 magnets" masking missing data? | **No** — 683/684 lots carry world-supply data and 683 carry STR; the scarcity leg is what fails (no lot at ≤3 world lots). Genuine absence. |
| Mobile | Panel itself is sound: 0px horizontal overflow at 375 / 768 / 1440, and the 3-up card row stacks below `lg`. **But see the app-shell finding below.** |

Live figures for 75192-1 (New), for future comparison:
`gross £905.89 → realisable £396.77 (44% capture) → net £359.47`, multiple 1.03× vs the
2.0× gate, max buy £280.12, verdict SELL-COMPLETE.

### §2.2 Two POV figures — RECONCILED, our view leads

Chris's call: **our view leads.**

- The assessment panel now renders **first**; BrickLink's published POV follows,
  retitled "Cross-check: BrickLink's own Part Out Value" and explicitly subtitled as
  context, not the decision.
- The card lost its own New/Used toggle — it now follows the tab's single toggle, via a
  new shared `useOfficialPov` hook (one query-cache entry).
- A reconciliation note states the relationship in figures: BL's £910.71 is the same
  kind of number as our **gross** £905.89 (−0.5%); the decision figure is our **net**
  £359.47 after capture and fees; and the multiples share no denominator — BL divides by
  RRP (£734.99), we divide by the current set price (£878.11).
- The card still renders when the computed partout is loading or has failed, so a
  failure never leaves the tab blank.

### §3 Fortnightly Bricqer refresh — BUILT

**Cost: ~312 Bricqer API calls per full sweep** (one per 100 inventory items; 31,123
items as of this session). ~624/month on the fortnightly cadence. **Zero BrickLink calls.**

New files:
- `scripts/register-bricqer-snapshot-task.ps1` — registers
  `HadleyBricks-Bricqer-Snapshot-Local`, every second Sunday 01:30 (clear of the 02:15
  store-assessment, 03:00 ebay-pricing and 05:30 keepa-refresh tasks).
- `scripts/run-bricqer-snapshot.ps1` — runner, modelled on
  `run-store-assessment-batch.ps1`, including the `ErrorActionPreference` npx-stderr trap.

Two real defects found and fixed while building it:

1. **The sync was wedged.** `bricqer_snapshot_meta` had `sync_status='running'`,
   `sync_cursor=300` since 2026-07-09, and `last_full_sync` was **2026-06-14**. 300 is
   `MAX_PAGES_PER_INVOCATION`, so the run hit the cap and stopped 12 pages short.
2. **Stale removal could never run.** `removeStaleItems` only fires when an invocation
   both starts at page 1 and completes — it deletes everything absent from the IDs seen
   in that invocation, so resuming mid-way must not prune. With 312 pages against a
   300-page cap, no run could ever satisfy both conditions, yet a resumed run still
   stamped `last_full_sync`. The snapshot would have claimed freshness it didn't have.

Fixes: `sync()` takes an optional `maxPages` (default unchanged at 300, so the Vercel
route is untouched); the CLI raises it so one invocation covers everything; and the CLI
now defaults to a **full sweep**, clearing any stored cursor first (`--resume` opts back
into the old behaviour).

**NOT YET RUN.** The first live refresh is ~312 calls against Bricqer and prunes rows —
awaiting Chris's go-ahead. Until it runs, the overlap panel is still reading the
2026-06-14 snapshot.

### §5 Details tab — DONE

- **BrickLink drill-down** (`SetLookupBricklinkModal`): asking side, sold side (avg,
  median, volume, quantity-basis STR), the dated months behind the sold figures, and
  cache age. BrickLink was the only panel with no drill-down.
- **Failures no longer masquerade as "no data".** `/api/brickset/pricing` returned `null`
  for missing credentials, a rejected key and an outage alike — visually identical to a
  set with no BrickLink listings. The payload now carries
  `status: ok | no-data | not-configured | error` plus a message, and the panel renders
  an amber "not connected" (with a Settings link) or a red "lookup failed" accordingly.
- **Deep links** to the BrickLink price guide and catalogue page.
- **Price history: verified, and the earlier assumption corrected.** `byMonth` does exist
  — but nested under `uk_detail.soldNew` / `soldUsed`, not at `uk_detail.byMonth`, and it
  is **not** a rolling 6-month series. It is whatever months BL's UK sold table held at
  fetch time: 75192-1 New is 4 pieces, all from **February–March 2020** (they reconcile
  exactly with `soldAvg` £475 and `soldQty` 4). So the panel shows a **dated list, not a
  trend line** — gaps are months with no sales, not zero prices — and the section heading
  states the real span instead of claiming "last 6 months".

### Bug found and fixed en route

`GET /api/bricklink/partout?setNumber=75192` (no `-1`) made BrickLink answer
`PARAMETER_MISSING_OR_INVALID / Invalid item sequence number: null`, which the route
turned into an opaque 500. The page happened to work because Brickset supplies the
suffixed form. Two fixes:

- `normaliseSetNumber` in `partout.service.ts` appends `-1` to a bare numeric set number.
- Both partout routes now map errors through `partout-error.ts`. The old handler was
  `const errorMessage = 'Internal server error'` tested against itself — its 404 and 429
  branches were unreachable, so **every** failure surfaced as a 500.

10 unit tests cover both.

### §7 Housekeeping — DONE

- The four stale functional docs now describe the gate model, the ladder, magnets,
  overlap, the unified cache and the BrickLink drill-down (they described the old gross
  `ratio > 1` model and the retired `bricklink_part_price_cache`).
- Typecheck clean, lint clean (only pre-existing warnings in unrelated workflow files),
  **3,602 tests across 159 files pass**.

---

## Still open

### §4 Model gaps — deferred by Chris ("leave for now, address at the end")

1. Max buy excludes acquisition postage and teardown labour (`DEFAULT_INBOUND_POSTAGE_GBP`
   exists and is not applied).
2. Target margin is hardcoded to `DEFAULT_MIN_MARGIN` (0.20); `assessPartout` already
   accepts `targetMargin` — it just needs a control. Still the highest-value small add.
3. `CAPTURE_CURVE` is uncalibrated (`TODO(calibration)` in `liquidity-pov.ts`). Everything
   from the realisable rung down inherits that uncertainty.
4. The verdict is parts-vs-complete only — no FLIP-AMAZON comparison, so a set can read
   `PART-OUT` here and `FLIP-AMAZON` in a store assessment.
5. `PartoutSummary` partly duplicates the ladder's gross rung.

### §6 Productisation — deferred by Chris

`SetStockCard` reads `inventory_items` directly; overlap is inherently ours-only;
per-user API credentials and rate limiting are absent; `page.tsx` still has its fetchers
inline. Deployment model still undecided.

### App shell has no mobile layout — pre-existing, out of scope

At 375–390px the sidebar renders expanded and overlays the content;
`(dashboard)/layout.tsx` renders `<Sidebar />` unconditionally at a fixed `w-64` with no
breakpoint and no drawer. This affects **every dashboard page**, not just Set Lookup, and
predates this branch. Flagged, not fixed — it's a separate piece of work.

### Not done

- No e2e coverage for set-lookup or partout (there was none before either).
- The first live Bricqer snapshot refresh (see §3).
- The scheduled task is **registered by a script that has not been run** — run
  `scripts/register-bricqer-snapshot-task.ps1` on the box (elevated preferred) once the
  refresh itself is approved, and make sure `run-bricqer-snapshot.ps1` exists in
  `hb-assess-wt` (it self-updates from origin/main, so merge first).
