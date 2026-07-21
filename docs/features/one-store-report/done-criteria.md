# Done Criteria — one-store-report

**Goal:** One way to assess and report on a BrickLink store. All surfaces render through the
single `src/lib/bl-store-report` module; the rival renderers are deleted. Overlap and demand
are advisory (never remove lots). Report shows all STR bands. Grounded UK pricing by default.
Sets get their own report section.

**Origin:** 2026-07-21 — the 2026-07-19 audit built the common module but left four rival
renderers alive and baked in a DUP-removal rule Chris never approved. This feature finishes
the consolidation and reverts the unratified policy. Spec validated by Chris in-conversation.

**Iteration budget:** 6

---

## Scope

**In:** `src/lib/bl-store-report/*`, the script entry points (`bl-pg-store-scan.ts`,
`bl-basket.ts`, `store-assessment.ts`, `store-report.ts`), `bl-store-assessment/format.ts`,
the Discord card, and the React assessment page — all routed through the one module.

**Out:** changing the engine's per-lot scoring maths (STR, net, benchmark) beyond the lens
default; changing the scrape/enrich mechanics; the nightly refresh queue.

---

## Functional

**F1 — DUP never removes.** `AUTO_VERIFY`
No headline or summary figure is reduced by excluding DUPLICATE lots. In `compute.ts`,
the primary summary net figures (`rawNet`, `cappedNet`, and every `gates[].cappedNet`)
include DUP lots. A "no-DUPs" number may exist only as a clearly-labelled secondary view.
*Evidence:* unit test — a fixture with a profitable DUP lot yields identical `cappedNet`
whether or not the DUP is present in the overlap index; the DUP lot appears in `rows`.

**F2 — Demand cap never removes.** `AUTO_VERIFY`
Buyable-lot count (`summary.lots`) and `rows.length` are invariant to `marketSoldQty6mo` /
the demand cap. The cap only changes `cappedLotNet` / `cappedNet`.
*Evidence:* unit test — same fixture with and without demand data returns the same lot count.

**F3 — Report leads with all STR bands.** `AUTO_VERIFY`
Both renderers (`render-cli`, `render-md`) present the gate ladder (STR ≥ 0, 0.25, 0.5,
0.75, 1.0) as the headline, each band showing lots / outlay / net / margin / ROI, plus the
overlap breakdown (NEW+R-OUT count, DUP count) as information. No single "the honest buy"
line that strips DUPs.
*Evidence:* renderer snapshot test asserts all five gate rows present and no "← the honest
buy" liquid-with-no-DUPs headline.

**F4 — Grounded UK default.** `AUTO_VERIFY`
`store-assessment.ts` and `store-report.ts` default the pricing lens to **grounded**
(UK sold prices only; `ukGroundedOnly: true`) when `--pricing-lens` is not passed.
`estimate` (world fallback) remains available as an explicit opt-in.
*Evidence:* test/asserts the resolved default is `ukGroundedOnly === true`.

**F5 — Basket inbound postage named + charged once per subset.** `AUTO_VERIFY`
Each rendered band deducts the full inbound postage once from that band's subset, under an
explicit label "Basket inbound postage £X". Per-lot postage is allocation-for-display only.
*Evidence:* renderer test asserts the label string appears with the postage value; band net
= sum(lot nets) − full postage (existing `buildGates` behaviour, locked by test).

**F6 — Sets get their own section.** `AUTO_VERIFY`
The report renders a distinct SETS section (Amazon-flip / BL-sell / part-out / skip),
separate from the parts & minifigs ladder. Sets are never mixed into the P/M buy figure.
*Evidence:* renderer test — a fixture with set lots produces a "SETS" section and the P/M
`summary.lots` excludes them.

**F7 — One renderer.** `AUTO_VERIFY`
`bl-pg-store-scan.ts` and `bl-basket.ts` no longer contain a private report/gate-table
builder; both call `bl-store-report`. `bl-store-assessment/format.ts`'s standalone decision
sections are removed in favour of the common report. The Discord card and React page consume
the common `DecisionReport`/summary, not their own maths.
*Evidence:* grep asserts no `buildReport`/`renderReport`/private gate-table in those files;
`npm run typecheck` passes; each CLI emits the common report header.

## Error Handling

**E1 — Partial data honesty preserved.** `AUTO_VERIFY`
When built from a persisted top-N assessment (no full scored set), the report still flags
`partialRows` and takes the coverage split from the assessment's own counts (no regression).

**E2 — Grounded lens with UK gaps.** `AUTO_VERIFY`
Under grounded default, lots with only world data resolve to provenance `none` (not silently
world-priced) and are surfaced as coverage gaps, not counted into the buy figure.

## Integration

**I1 — Typecheck + lint clean.** `AUTO_VERIFY` — `npm run typecheck` and `npm run lint` pass.

**I2 — Existing bl-store-report tests still pass** (updated for new semantics). `AUTO_VERIFY`

**I3 — Live smoke.** `TOOL_VERIFY` — `store-report.ts --slug=thebrickshack_` renders the
new ladder-led report from persisted data with DUPs included and a sets section.

## Non-goals / boundaries

- Not re-deriving STR/net/benchmark formulas.
- Not touching scrape pacing, the refresh queue, or POV computation.
- React page: consume the common report data; a full visual redesign is out of scope.
