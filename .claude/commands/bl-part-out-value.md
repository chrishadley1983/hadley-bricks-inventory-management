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

**Setup:** log the **dedicated throwaway BL account** (`domham91`) into the CDP Chrome (note: it
defaults to **USD** display → conversion via `bricklink_pov_config.usd_to_gbp_rate`, currently
0.7407), run **behind a VPN**, logged-in. This isolates the main business account.

`pov-backfill.ts` walks `brickset_sets` **newest-first** and auto-selects the next `--limit` sets
**not already cached** (anti-join, paginated — no `--offset`, no 1000-row ceiling). It's fully
**resumable**: re-run the same command and it continues where it left off.

```powershell
# New, 2010→now (RRP + part-out multiple) — chunk of 150 at ~12s pacing
cd apps/web; npx tsx scripts/pov-backfill.ts --limit=150 --year-min=2010 --delay-ms=12000

# Used, 1980→now (part-out value only, no RRP, include vintage 3-digit numbers)
cd apps/web; npx tsx scripts/pov-backfill.ts --limit=150 --condition=U --skip-rrp --year-min=1980 --min-digits=3 --delay-ms=12000
```

**Flags:** `--limit=N` (new sets to scrape this session) · `--condition=N|U` · `--skip-rrp` (Used) ·
`--year-min`/`--year-max` · `--min-digits=3|4` (3 = include vintage) · `--exclude-themes=a,b`
(default excludes Gear/Service Packs/Power Functions/Powered Up/Bulk Bricks — non-set junk) ·
`--delay-ms` · `--dry-run`.

**Throttle handling:** BL transiently 403-throttles an IP after a sustained burst (≈150+ hits). The
run **stops cleanly** on it — just **wait ~10 min or switch VPN endpoint and re-run the same
command** (it resumes). Pace **~12–15s** for sustained runs; **never 5s** (burns the IP budget for
no gain). Don't burst probes.

**Scale (numeric sets):** New 2010→now ≈ 6,419 (with RRP); Used 1980→now ≈ 15,700. Build in
VPN-rotated chunks over several sessions.

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
