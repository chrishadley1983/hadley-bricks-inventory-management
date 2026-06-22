# Part-Out-Value buy modes — Vinted Sniper + eBay Auction cron

**Status:** built 2026-06-22 (branch `feature/vinted-pov-modes`)
**Goal:** Use the new BrickLink Part-Out-Value (POV) dataset to drive buy/skip decisions in the
Vinted scraper extension and the eBay auction cron, beyond the existing Amazon-resale-margin signal.

The POV dataset is `bricklink_part_out_value_cache` (~21k rows; New + Used per set; the authoritative
figure is `sold_6mo_avg_gbp` = BrickLink's "average of last 6 months sales"). See
`[[bl-part-out-value-feature]]` memory for dataset provenance and the `is_aggregate_listing` gotcha.

---

## What shipped

### 0. Anon-safe POV access — `get_pov_public(set_number)`
The Vinted extension talks to PostgREST with the **anon** key, but the POV cache only granted read to
`authenticated`. New `SECURITY DEFINER` SQL function `public.get_pov_public(p_set_number text)` returns
only the public POV columns (both N & U rows, `is_aggregate_listing` excluded, `my_inv_*` withheld) for
a bare or variant set number. `GRANT EXECUTE` to `anon`, `authenticated`, `service_role`.
Migration: `20260622144833_vinted_pov_modes.sql`.

### 1. POV on the Discord notification — **condition-matched** (req 1)
Every alert now shows the part-out value matching the **listing's detected condition**:
- New listing → New POV (6-mo sold avg, for-sale avg, ×COG multiple, RRP multiple, lots)
- Used / unknown listing → Used POV
- eBay auction cron: New POV (the new-sealed scan) or Used POV (used scan)

### 2. Per-tab "Used Lego mode" (req 2)
The Vinted extension has a **per-tab buy mode** (persisted in `sessionStorage`, survives the same-tab
auto-refresh), switchable live via a clickable chip in the status bar:
- **Amazon** — original behaviour (Amazon resale margin; ≥15% amber, ≥25% green).
- **Hybrid (New)** — buy if Amazon margin fires **OR** New POV ≥ multiple × COG.
- **Used POV** — buy if **Used POV ≥ multiple × COG** (Amazon ignored; Keepa never hit → no token burn).

COG = Vinted price (incl. buyer protection where shown) + £2.39 postage. POV = BrickLink 6-month SOLD
average (gross). Multiples are configurable in extension options (good = 3×, great = 4× by default).

**eBay equivalent:** the eBay auction cron is a server-side scanner, not tab-based. Used mode is a
config flag `used_pov_mode_enabled` on `ebay_auction_config` (**off by default**). When on, the cron
runs a second `conditions:{USED}` search and alerts on Used POV ≥ multiple × total cost.

### 3. Hybrid new-Lego signal (req 3)
Both the Vinted Hybrid mode and the eBay new-sealed scan now alert when **either** the Amazon resale
margin passes **or** the New POV ≥ multiple × cost. eBay config: `pov_buy_enabled` (default true),
`pov_multiple` (3), `pov_great_multiple` (4). Tier = green if Amazon-great or POV ≥ great-multiple,
else amber. The alert lists which signal(s) fired.

---

## Files

| Area | File |
|------|------|
| Migration | `supabase/migrations/20260622144833_vinted_pov_modes.sql` |
| Vinted extension | `Discord-Messenger/FB Refresh/vinted-sniper/{content.js,options.html,options.js}` (untracked; backed up to `vinted-sniper.bak-2026-06-22`) |
| eBay scanner | `apps/web/src/lib/ebay-auctions/{ebay-auction-scanner.service.ts,types.ts}` |
| eBay Discord | `apps/web/src/lib/notifications/discord.service.ts` |
| eBay routes | `apps/web/src/app/api/cron/ebay-auctions/route.ts`, `…/ebay-auctions/scan/route.ts`, `…/ebay-auctions/config/route.ts` |

### New DB columns
- `vinted_sniper_decisions`: `mode`, `condition_class`, `pov_new_sold_gbp`, `pov_used_sold_gbp`, `pov_multiple_new`, `pov_multiple_used`, `pov_signal`
- `ebay_auction_config`: `pov_buy_enabled`, `pov_multiple`, `pov_great_multiple`, `used_pov_mode_enabled`
- `ebay_auction_alerts`: `pov_condition`, `pov_sold_gbp`, `pov_multiple`, `buy_signal`

---

## Design notes / gotchas
- **`is_aggregate_listing`** is excluded everywhere (CMF "Complete Series of N" inflate the multiple ~Nx).
- **Used rows have no RRP / `partout_multiple`** by design — the buy signal uses `sold_6mo_avg_gbp ÷ COG`, computed live, not the stored RRP multiple.
- **No scraping in the cron** — the eBay scanner reads the cache only (no CDP on Vercel). Sets absent from the cache simply yield no POV signal.
- **Gross multiple**, not net of fees — the 3× headroom is the margin buffer (per the upfront decision).
- **Mode switch** applies to *new* listings going forward (already-seen listings aren't re-evaluated within a tab session).
- **1000-row cap** — the eBay POV batch read is chunked (100 sets/chunk) **and** `.range()`-paginated per chunk, so it never silently truncates even when sets carry many option-variant rows.
- **Reused set numbers** (~1% of sets share a bare number across editions) resolve to the canonical original (lowest `item_seq` with data). The card surfaces the resolved set name + image + Brickset link so a reissue mismatch is human-visible. Title-based edition disambiguation is a future refinement (see backlog #12).
- **Validation:** adversarial multi-agent workflow (2026-06-22) — verdict SHIP-WITH-FIXES, all R1/R2/R3 PASS, no critical/high; the 5 LOW findings are fixed/documented here.

---

## Possible other extensions for the POV dataset

These are not built — a backlog of high-value ways to reuse `bricklink_part_out_value_cache`.

### Sourcing & buying
1. **POV on the FB Marketplace / FB Group snipers** — they currently have no pricing at all; the same
   `get_pov_public` RPC + condition-matched display + Used/Hybrid modes would slot straight in.
2. **Sealed-vs-part-out advisor** on the Vinted card — when New POV > New Amazon resale, flag "part out
   beats reselling sealed" (and vice-versa) so the buy reason names the better exit.
3. **BL store / `bl-basket` arbitrage** — cross-check whole-set purchase price against POV to find sets
   worth buying *to break*, not just to flip. Feeds the existing `arbitrage_purchases` flow.
4. **"Buy used to part" scanner** — a scheduled sweep of BL/eBay used listings where Used POV ≥ N× the
   asking price, the inverse of the current sell-side store-quality work.

### Pricing & inventory (sell-side)
5. **Part-out vs sell-whole decision on our own inventory** — for each owned sealed set, compare Bricqer
   list price to New POV (net of BL/Bricqer fees) and surface "break this set" candidates.
6. **POV-anchored Bricqer floor** — sanity-check auto-priced lots against the set's POV so a mispriced
   lot can't sit far below part-out value.
7. **Markdown guard** — feed POV into the unified markdown engine so a set is never marked down below a
   POV-justified floor.

### Analytics & signals
8. **POV trend tracking** — `last_changed_at` + periodic snapshots → "part-out value rising/falling"
   momentum, surfaced in the daily Discord summary or the investment predictor.
9. **Retirement × POV** — join with retirement/`year_to` data: retiring sets whose POV multiple is
   climbing are the strongest hold/accumulate candidates.
10. **Theme / price-band POV leaderboards** — "best part-out multiples under £X" for targeted sourcing
    wanted-lists (ties into `bricklink-wanted-list-skill`).
11. **Per-piece demand from `not_included` / lots data** — sets with many high-demand lots vs few →
    refine which sets are genuinely worth the part-out labour.

### Plumbing
12. **Extend `get_pov_public`** to optionally return all `item_seq` variants / break-type options, so
    clients can pick instructions/box-inclusive POV variants.
13. **POV freshness surfacing** — show `fetched_at` age on cards and let a stale lookup enqueue a
    refresh via the existing `pov-refresh` mechanism.
