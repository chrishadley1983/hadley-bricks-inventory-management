# Set Lookup — canonical analytics: open items

**Branch:** `feature/set-lookup-canonical-analytics`
**Commit:** `33726ae6` — *feat: Wire Set Lookup Partout tab to the canonical BL decision model*
**Written:** 2026-07-25
**Status:** committed locally, **not pushed, no PR, not merged**

Pick-up doc for switching machines. Everything below is what is **NOT** done.

---

## 0. Read this first if you're on a different machine

The local checkout on the other machine was **866 commits behind `origin/main`** (stuck at
`394b99b`, 2026-01-23). That caused a long argument in which the whole analytics layer was
reported as "not built" when it had shipped months earlier.

```powershell
git fetch; git rev-list --left-right --count main...origin/main
```

If that returns anything non-zero on the right, pull before doing anything else.
Also run `npm install` — the pull added dependencies (`sonner`, `jszip`, `@tensorflow/tfjs`)
and typecheck fails with phantom errors until you do.

`npx tsc --noEmit` OOMs at the default heap. Use:
```powershell
$env:NODE_OPTIONS="--max-old-space-size=8192"; npx tsc --noEmit
```

---

## 1. What WAS built (so you don't redo it)

In `apps/web/src`:

| File | What |
|---|---|
| `lib/bricklink/partout-assessment.ts` | **new** — pure assessment engine: honesty ladder, gate verdict, max buy, STR bands, magnets, concentration, overlap |
| `lib/bricklink/world-supply.ts` | **new** — `readWorldSupply` extracted out of `bl-store-assessment/engine.ts` so both share one query |
| `lib/bricklink/fees.ts` | `POV_MULTIPLE_MIN`, `POV_MIN_GAP_GBP`, `DEFAULT_MIN_MARGIN` moved in from `engine.ts` |
| `lib/bricklink/partout.service.ts` | loads world supply + own-stock index, emits `assessment` on `PartoutData` |
| `types/partout.ts` | assessment types; `strQtyNew/Used`, `worldSupplyLots*`, `overlap*`, `ourQty*` on `PartValue` |
| `components/features/set-lookup/PartoutAssessmentPanel.tsx` | **new** — the whole decision UI |
| `components/features/set-lookup/PartoutTab.tsx` | condition toggle moved up to drive the assessment |
| `components/features/set-lookup/PartoutSummary.tsx` | legacy recommendation card removed |
| `components/features/set-lookup/PartoutTable.tsx` | STR (qty), World lots, Overlap columns |
| `lib/bricklink/__tests__/partout-assessment.test.ts` | **new** — 30 tests |

Verified: typecheck clean, lint clean, 311 existing bricklink / bl-store-assessment /
bl-store-report tests still pass.

---

## 2. NOT DONE — blocking, do these first

### 2.1 Never run in a browser
Nothing here has been exercised against a live set. Typecheck + unit tests only.

```powershell
npm run dev
# then look up a real set, e.g. 75192, and open the Partout tab
```

Specifically unverified:
- Does `assessment` actually arrive on both the `/api/bricklink/partout` and the SSE
  `/stream` responses?
- Does the overlap section populate, or is `bricqer_inventory_snapshot` stale/empty for
  this user? (It reports `overlap: null` on failure rather than erroring, so an empty
  panel is indistinguishable from a broken join by eye — check the server log for
  `[PartoutService] Own-stock index failed`.)
- Do magnets ever fire on a real set? Needs `bricklink_pg_summary_cache` rows for the
  set's parts. If coverage is thin the panel will just say "no magnets", which is
  honest but might be masking missing data rather than genuine absence.
- Mobile: no responsive check at 375 / 768 / 1024 was done. The panel uses
  `lg:grid-cols-3` and several `overflow-x-auto` tables; the tables are probably fine,
  the 3-up card row at the top is the risk.

### 2.2 Two POV figures on screen, unreconciled
The Partout tab now shows **both**:
1. `OfficialPovCard` — BrickLink's own authoritative POV (CDP scrape, `bl-part-out-value`)
2. The new assessment ladder — our computed lot-by-lot POV

They will not match, and nothing on screen explains why. This is the most likely thing to
cause confusion in real use. Decide: reconcile them, explain the difference inline, or
show only one.

---

## 3. NOT DONE — the Bricqer fortnightly refresh

You asked for "every other week on Bricqer". **Not built.**

Facts as of this commit:
- `vercel.json` has **no crons at all** any more — scheduled work moved to GCP jobs and
  local Windows Task Scheduler.
- The pattern is `scripts/register-<job>-task.ps1`. Eight exist
  (`register-store-assessment-batch-task.ps1`, `register-keepa-refresh-task.ps1`, …).
- **There is no `register-bricqer-snapshot-task.ps1`.**
- The refresh script already exists: `apps/web/scripts/refresh-bricqer-snapshot.ts`,
  writing via `lib/inventory-explorer/snapshot-sync.service.ts` →
  `bricqer_inventory_snapshot` + `bricqer_snapshot_meta.last_full_sync`.

So the work is: add `scripts/register-bricqer-snapshot-task.ps1` on a fortnightly
trigger, modelled on `register-store-assessment-batch-task.ps1`.

Until that exists the snapshot only refreshes when something triggers it manually, which
means **the overlap panel silently degrades over time**. The panel does surface
`snapshotAt`, so staleness is visible — but nobody is looking at it.

---

## 4. NOT DONE — model gaps in what was built

These are real limitations of the shipped assessment, not bugs:

1. **Max buy excludes acquisition postage and teardown labour.** It's
   `realisable × (1 − 9.4% − margin)` and nothing else. `DEFAULT_INBOUND_POSTAGE_GBP`
   (£3) exists in `fees.ts` and is **not** applied. Set-lookup sets aren't necessarily
   bought from a BL store, so it wasn't obvious it should be — but the number is
   optimistic as it stands. The UI says so in small print; that isn't a fix.
2. **Target margin is not adjustable in the UI.** Hardcoded to `DEFAULT_MIN_MARGIN`
   (0.20). `assessPartout` already takes `targetMargin` as an option — it just needs a
   control wired to it. This is probably the single highest-value small addition.
3. **`CAPTURE_CURVE` is uncalibrated.** `liquidity-pov.ts` carries an explicit
   `TODO(calibration)`: the brackets are the spec's starting guess, never fitted to our
   own sales. Route is documented in that file — join `arbitrage_purchases` against the
   STR each lot carried at buy time. Everything on the realisable/net rungs and the max
   buy inherits this uncertainty.
4. **The verdict is parts-vs-complete only.** The store-assessment `buildSets` also
   weighs `FLIP-AMAZON` and requires part-out to beat the best flip channel by 2×. Ours
   doesn't — the partout service has no Amazon/eBay data. So a set can read `PART-OUT`
   here and `FLIP-AMAZON` in a store assessment. Not wrong, but it is a different
   question, and the UI does not say so.
5. **`PartoutSummary` is now partly redundant** — its POV/ratio cards duplicate the
   ladder's gross rung. Left in deliberately (it shows both conditions at once, the
   panel shows one) but it's the obvious next tidy.

---

## 5. NOT DONE — Details tab

Completely untouched this round. From the original review:

- BrickLink New/Used panels are the **only** panels with no drill-down (Amazon, eBay New,
  eBay Used all open modals). BrickLink is the differentiator and has the thinnest panel.
- Pricing failures are swallowed silently in `/api/brickset/pricing` — a missing
  credential renders as an empty panel, not "BrickLink not configured".
- No deep link to the BrickLink catalogue page for the set.
- No price history / trend. **Note:** a memory written this session says
  `uk_detail.byMonth` in the price cache already holds ~6 months of monthly sold history
  from a single fetch — so a trend line may be much cheaper than assumed. Verify before
  scoping.

---

## 6. NOT DONE — productisation (the actual goal)

The original ask was to formalise **BrickLink Pricing + Store Assessments + Arb pricing**
into something deployable to members on hadleybricks.co.uk. Deployment model is
**undecided** — you chose "not decided yet", focus on decoupling.

Decoupling work still outstanding:

- **`SetStockCard` reads `inventory_items` directly** — meaningless for a member with no
  inventory. Needs to become an optional slot.
- **Overlap is inherently yours-only.** A member has no Bricqer store. Either it's a
  Hadley-Bricks-only panel, or members need their own store connection. This is a product
  decision, not a code one.
- **Per-user API credentials.** BrickLink/Amazon pricing return null without per-user
  creds. A member won't have Amazon SP-API. Needs server-side shared credentials with
  quota metering.
- **No rate limiting per user.** Routes check auth; nothing meters usage.
- **`page.tsx` still has all fetchers inline** rather than in `lib/api/`.

Store Assessments and Arb pricing were **not touched at all** this round — only Set
Lookup. Both exist and are well developed (`lib/bl-store-assessment/`, `lib/arbitrage/`,
`scripts/register-store-assessment-batch-task.ps1`).

---

## 7. NOT DONE — housekeeping

- **Docs are stale.** These still describe the old gross `ratio > 1` model:
  - `docs/functional/partout-value/overview.md`
  - `docs/functional/partout-value/analyse-set.md`
  - `docs/functional/set-lookup/overview.md`
  - `docs/functional/set-lookup/viewing-pricing.md`

  Run `/docs update` before merge.
- **No e2e coverage** for set-lookup or partout (there was none before either).
- **No `/code-review branch`, no `/verify-done`, no `/test pre-merge`** run yet — the
  CLAUDE.md pre-merge sequence is untouched.
- **Not pushed.** `git push -u origin feature/set-lookup-canonical-analytics`, then PR.

---

## 8. Suggested order on pick-up

1. `git fetch` + check you're current, `npm install`
2. `npm run dev`, look up a real set, confirm the panel renders and overlap populates (§2.1)
3. Decide the two-POV-figures question (§2.2) — it's the one that will bite in real use
4. Wire the target-margin control (§4.2) — small, high value
5. `register-bricqer-snapshot-task.ps1` fortnightly (§3)
6. `/docs update`, then `/code-review branch` → `/test pre-merge` → `/merge-feature`
