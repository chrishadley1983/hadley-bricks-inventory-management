# Code review — `feature/store-assessment-align-set-lookup`

**Date:** 2026-07-26
**Mode:** `branch` (5 commits vs `main`)
**Scope:** 17 files, +2,166 / −380

Aligns the store-assessment detail screen with the Set Lookup part-out screen (quantity
basis, images, sorts, visible arithmetic), surfaces three persisted-but-unrendered
sections, and adds a BrickLink wanted-list export.

---

## Verdict: APPROVE after fixes

Two findings fixed in review (CR-001 Major, CR-002 Nitpick). One design question left
open for Chris (CR-003). No blockers.

---

## CR-001 · Major · Correctness — BL margin back-solve dropped the inbound term

`SetsTable.setMarginPct` derived the BrickLink sale price by inverting the engine's net
identity, but inverted an incomplete version of it:

```ts
// was
const blSale = (r.blNet + r.ask) / (1 - VAR_FEE_PCT);
```

The engine (`engine.ts:216`) is:

```ts
netPerUnit = ourList * (1 - feePct) - ask - inp.inboundPerUnit;
```

Omitting `inboundPerUnit` makes `blSale` too small, so `blNet / blSale` comes out **too
high** — margin overstated, which is the wrong direction to be wrong on a buy decision.

Latent rather than live: `inboundPerUnit` defaults to `0`, so every persisted run to date
is unaffected. It would have surfaced the first time anyone ran with `--inbound-per-unit`,
by which point the number would look plausible and be wrong.

**Fixed.** `setMarginPct(row, inboundPerUnit)` now inverts the full identity, and
`AssessmentView` threads `a.inputs.inboundPerUnit` through `SetsPanel` → `SetsTable`, so
the derived figure is tied to the run's own inputs rather than an assumed zero.

---

## CR-002 · Nitpick · Style — import below top-level consts

`wanted-list.ts` had `import { VAR_FEE_PCT }` sitting after the `ceilP`/`floorP`
declarations. Valid (imports hoist) but it reads as a runtime dependency introduced
mid-file. **Fixed** — moved to the import block.

---

## CR-003 · Minor · Open question — identified CMFs are excluded from the wanted list

`buildStoreWantedList` filters `itemType !== 'S'`, on the reasoning that a set is a
separate buying decision and only belongs in a cart after that decision is made.

That is right for actual sets. It also drops **identified CMFs** — `engine.ts:589` scores
S-type items whose id carries a figure suffix (`col25-3`) exactly like minifigs, via
`withinMargin` / `netPerUnit`, and they are sellable on BL as figures. On Cover03 that is
2 lots worth £4.16 net.

Note `bl-basket` does *not* exclude S-type — its `colNN` guard implies sets reach its XML —
so the two surfaces now differ.

**Not changed.** Including all S-type would sweep real sets into the cart, which is the
thing the exclusion exists to prevent; the precise fix (include S only when
`isCmf(itemNo) && itemNo.includes('-')`) is a deliberate widening and Chris's call.

---

## Passed

**Security.** The new route gates on `requireUser()` and queries through the cookie-auth
client, so RLS applies — `store_assessments` has own-user SELECT/INSERT/DELETE policies
(`20260709120000_store_assessments.sql:66`). The user-controlled slug reaches a
`Content-Disposition` header and is stripped to `[A-Za-z0-9._-]` first, closing header
injection and filename escape. `Cache-Control: no-store` is correct — assessments re-run
nightly and a cached copy would serve yesterday's cart.

**Payload discipline.** `wanted_list_xml` can be large on a big store. Only the download
route selects it; the detail page selects `wanted_list_meta`, the radar list selects
neither. No page load carries the XML.

**Honest degradation.** Every new section handles the absence of its data rather than
rendering a dash: pre-v7 runs show the raw net with a stated warning, pre-UK-gate runs get
the worldwide magnet caption and layout, runs without a wanted list get the re-run command
instead of a dead link, and the route 404s with a reason rather than returning an empty
`<INVENTORY>` that BL would accept as an empty wanted list.

**No silent truncation.** Both table footers state that the rows are an engine-ranked
slice and that sorting cannot reach the rest.

**Constants.** No threshold is re-declared. `UK_MAGNET`, `VAR_FEE_PCT`, `PRICE_BANDS` all
come from `lib/bricklink/fees`; `primitives.tsx` was repointed at `fees` rather than the
engine's re-export so the client bundle does not pull in the scoring module.

**DRY.** The wanted-list XML builder was **moved** out of `bl-basket.ts`, not copied. Its
rules (one entry per item+colour, concrete `CONDITION`, no angle brackets in `REMARKS`,
no bare `colNN` ids) were each learned from a live BL rejection. bl-basket's 20 dedupe
assertions pass unchanged against the moved code.

**Hooks.** All `useMemo`/`useState` calls precede the early returns in `LotTable` and
`SetsTable`.

---

## Tests

- `330/330` pass (`bl-store-assessment` + `bricklink` suites).
- `test-bl-basket-dedupe.ts`: 20/20 after the builder move.
- `tsc --noEmit` clean on both `tsconfig.json` and `tsconfig.scripts.json` (the latter
  matters — it compiles `src/lib/bricklink/**` as CommonJS).
- ESLint clean.
- Verified on the rebuilt local production server against two live rows: Cover03 (v7) and
  247parts (v3, legacy path).

**Gap:** no unit test covers `setMarginPct` or `buildStoreWantedList`. Both are pure and
now carry decision-bearing arithmetic — CR-001 would have been caught by one. Worth adding.

---

## CLAUDE.md health

| Check | Result |
|-------|--------|
| Length | 198 lines — under the 200 threshold, but only just |
| Inline code | 6 fences, all short command lists |
| Feature docs | Two MANDATORY pattern blocks (BL price data, BL store report) — long, but they are cross-cutting rules with incident provenance, not feature docs |
| Incident rules | Present by design, each carrying its origin case |
| Duplication vs global | None |

**No action.** Flagging only that the file is one section away from needing extraction to
`docs/conventions/`.
