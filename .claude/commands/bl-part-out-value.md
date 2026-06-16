---
name: bl-part-out-value
description: >
  Get BrickLink's authoritative Part Out Value (POV) for a LEGO set — the "Average of last 6
  months Sales" and "Current Items For Sale Average" — plus UK RRP and the part-out multiple
  (sold ÷ RRP). Cache-first; live-scrapes via the local logged-in Chrome (CDP) when missing/stale.
  Use when the user says "part out value of <set>", "what does <set> part out for", "POV for
  <set>", "is <set> worth parting out", "part-out multiple for these sets", or asks to change the
  POV defaults (new/used, instructions). Also the engine behind the set-lookup "Official POV" card
  and the Vinted scraper's part-out check.
---

# BrickLink Part Out Value

Authoritative POV for a set in one scrape (no BL API budget used), cached in
`bricklink_part_out_value_cache` with a generated `partout_multiple = sold_6mo_avg_gbp ÷ uk_retail_gbp`.

**Usage:** `/bl-part-out-value <set number(s)> [used] [force]`

## When to invoke

- "part out value of 77075" / "what does 77075 part out for" → single fetch
- "POV for 77075, 10333, 21034" → batch loop (gentle delay)
- "is the Ferrari worth parting out" → fetch + interpret the multiple
- "part out 77075 used" → `--condition=U`
- "set POV defaults to used / no instructions" → edit `bricklink_pov_config`

## Single set

```powershell
cd apps/web; npx tsx scripts/pov-fetch.ts --set=77075
```
Cache-first (returns a fresh row without hitting BL). Flags: `--condition=U`, `--break-type=B`,
`--no-instructions`, `--inc-box`, `--force` (re-scrape). Logged-in → GBP. Output shows sold avg,
for-sale avg, UK RRP, and the part-out multiple.

## Batch (gentle)

For several sets, loop with a delay so we stay gentle on BL (these are page navigations, not the
API). The backfill script does this for you, newest-first from the catalogue:

```powershell
cd apps/web; npx tsx scripts/pov-backfill.ts --limit=50 --delay-ms=8000
```
Or for an explicit list, call `pov-fetch.ts` per set with a `Start-Sleep -Seconds 8` between calls.
It skips sets already fresh in cache, so re-runs resume.

## Reading the multiple

`partout_multiple` = 6-month **sold** average (realistic) ÷ UK RRP. e.g. 77254 Ferrari sold £74 /
RRP £23 ≈ **3.2×** — parts out for ~3× its retail. Caveats:
- RRP is the *launch* price; retired sets trade above RRP, discounted ones below — a high multiple
  vs RRP is not guaranteed margin vs what you'd *pay*.
- Numerator is sold avg, not the inflated current-asking figure.

## Change defaults (conversational)

Defaults live in the single-row `bricklink_pov_config` (condition, break type, include flags,
`freshness_days`, backfill delay/batch). Update via the API (`PUT /api/bricklink/part-out-value/config`)
or directly:

```sql
UPDATE bricklink_pov_config
SET default_condition = 'U', default_inc_instructions = false, updated_at = now()
WHERE id = 1;
```

## Bulk backfill (production)

**Recommended:** log the **dedicated throwaway BL account** (`domham91` / chris@hadleybricks.co.uk)
into the CDP Chrome, run **behind a VPN**, in default **logged-in** mode. That gives GBP directly
(no USD conversion), is reliable (logged-in isn't soft-blocked), and isolates the main business
account. Pacing is conservative by default (≈20s + jitter, cooldown every 25 scrapes):

```powershell
cd apps/web; npx tsx scripts/pov-backfill.ts --limit=200            # dedicated acct logged-in, VPN up
```

**Fallback — logged-out:** works but a residential IP gets soft-blocked after a handful of hits
(observed), and it returns USD so a rate is required (else the run aborts):

```powershell
cd apps/web; npx tsx scripts/pov-backfill.ts --limit=200 --logged-out --usd-rate=0.74   # VPN up
```

Do **not** burst requests (e.g. rapid probes) — that's what trips the soft-block. Keep the gentle
pacing; the bulk run is "slow but consistent" by design.

## Vinted extension point

The Vinted sniper can get a set's part-out multiple by importing the shared helper — no duplicate
scrape/cache logic:

```ts
import { getPovForSet } from '@/lib/bricklink/part-out-value-cache.service';
const { row } = await getPovForSet(supabase, detectedSetNumber); // cache-first; scrapes if stale
// row.partout_multiple, row.sold_6mo_avg_gbp, row.uk_retail_gbp
```

## How it works

1. `parseSetNumber` splits "77075-1" → itemNo `77075` + seq `1`.
2. Cache-first: `bricklink_part_out_value_cache` keyed by set + full option-variant, `fetched_at`
   staleness (`POV_CACHE_FRESHNESS_DAYS`, default 30).
3. Miss/`--force` → `scrapePovByNavigation` (CDP page navigation; one nav, stops on login/captcha).
4. UK RRP resolved from the existing `brickset_sets` cache (no Brickset API call); the multiple is a
   generated DB column.

## Prerequisites

- `apps/web/.env.local` with `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- A logged-in Chrome on CDP `:9222` (the dedicated CDP Chrome) for live scraping. Cache reads need
  no Chrome.
