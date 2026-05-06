---
name: find-piece
description: >
  Find a LEGO piece (or pieces) across our Bricqer inventory: standalone owned
  parts, owned torso/part assemblies that contain it, and owned minifigs that
  contain it. Pass any BL part number (arm 981/982, head 3626bpb…, torso 973pb…,
  utensils, accessories, etc.) optionally filtered by colour. Cross-references
  via BL `/items/PART/<no>/supersets` so it surfaces every figure/torso BL
  catalogues as containing that piece, then intersects with what we actually
  own. Use when the user says "find this arm in my inventory", "which figs have
  this head", "do I own this torso anywhere", "where is part X across my store",
  or "audit minifigs containing piece Y in colour Z".
---

# Find a piece across our inventory

Universal piece-lookup across our Bricqer snapshot — answers "do I own this
exact piece, and what figures/torsos/sets in my store contain it?".

**Usage:** `/find-piece <part numbers> [colour]`

Or directly:

```powershell
cd apps/web; npx tsx scripts/find-piece.ts --parts=981,982 --color="Light Gray"
```

## When to invoke

Trigger phrasings:
- "find this arm in my inventory" → `--parts=981,982 [--color=...]`
- "which figs have this head" / "find this head and look across all figs" → `--parts=<head no>`
- "find this torso" / "do I own minifigs with this torso" → `--parts=<torso no>`
- "where is part X across my store" → `--parts=<no>` (no colour = all colours)
- "audit minifigs with <colour> arms" → `--parts=981,982 --color="<colour>"`

## Arguments

- `--parts=<no>[,<no>...]` (required) — one or more BL part numbers, comma-sep.
  Use the *exact* BL part number including any printed-pattern suffix
  (e.g. `3626bpb0631`, `973pb0340`, `973px146c01`).
- `--color="<BL color name>"` (optional) — BL's American spelling, e.g.
  `"Light Gray"`, `"Light Bluish Gray"`. Filters both the standalone Bricqer
  query and the BL supersets call. Omit to query all colours.
- `--bl-color-id=<n>` (optional) — explicit BL color_id override (use if your
  colour name isn't in the built-in BL_COLOR_IDS map).
- `--skip-supersets` (optional) — only show standalone Bricqer rows. Skips the
  BL API step (faster, no auth needed).
- `--skip-prices` (optional) — skip the price/STR cache lookup.
- `--include-zero-qty` (optional) — include rows where `quantity = 0` (Bricqer
  keeps them for storage-location memory after sell-through). Default off.
- `--include-sets` (optional) — also list owned sets that contain the piece.

## How it works (4 phases)

1. **Standalone (Bricqer)** — for each `--parts` value, queries
   `bricqer_inventory_snapshot` where `item_type='Part'` and `item_number = <no>`,
   optionally filtered by `color_name ILIKE <colour>`.
2. **BL supersets** — calls
   `GET /items/PART/<no>/supersets[?color_id=N]` per input part. BL returns
   every catalogued container (PART = torso/assembly, MINIFIG, SET). The
   colour filter narrows to that arm/head/etc colour only.
3. **Name-pattern fallback (arms only)** — when `--parts` includes 981 or 982
   AND `--color` is set, also pulls `973*` torso rows where:
   - `item_name ILIKE '%<colour> Arms%'` (catches body ≠ arm colour, e.g.
     `973p47c01` Castle Classic Shield with body=Red, arms=Light Gray), OR
   - `color_name = <colour>` AND `item_name ILIKE '%(same color) arms%'`
     (catches plain `973c000` "Same Color Arms" assemblies)
   This compensates for BL's supersets endpoint not decomposing torso
   assemblies into separate arm-part entries.
3b. **Torso family variants (torsos only)** — when any input part is a printed
    torso (`973p…`, `973pb…`, `973px…`, `973pa…`, `973bpb…`), also pulls
    sibling rows sharing the same family root with a different `cYY` arm
    suffix (or no suffix). Use case: when a `973pbXXXXcYY` assembly is
    damaged or missing and the bare-body `973pbXXXX` is in stock, recombine
    arms from the damaged unit with the bare body to produce a working
    assembly.
4. **Intersect + price/STR enrich** — rolls owned rows up by item_number, then
   bulk-fetches `bricklink_part_price_cache` (parts/torsos) and
   `minifig_price_cache` (minifigs) for £ and STR columns. STR for parts is
   computed as `times_sold / stock_available` per condition; for minifigs
   `terapeak_sell_through_rate` is used directly. Cells show "—" when the
   piece+colour tuple isn't in the cache yet (run `/bl-basket` or any pricing
   script that touches it to populate).

## Important caveats

- **Bricqer color_id ≠ BL color_id.** The script keys off `color_name`
  (case-insensitive) for Bricqer and translates to BL color_id only for the
  supersets API. Don't pass a Bricqer numeric id to `--bl-color-id`.
- **Coverage = BL's catalog.** If BL hasn't catalogued a minifig's exact arm
  colour (or has it as part of a generic block instead of a specific color_id),
  it won't appear. The script tells you the BL hit count per part so you can
  sanity-check.
- **Torso body colour ≠ arm colour.** A torso row in Light Gray *usually* has
  Light Gray arms but `973pXXcYY` patterns can encode different arm colours
  (e.g. "/ Blue Arms"). Item names are preserved so you can spot mismatches.

## Examples

```powershell
# Audit all figures with Light Gray (old) arms
cd apps/web; npx tsx scripts/find-piece.ts --parts=981,982 --color="Light Gray"

# Where in my store is this specific printed head?
cd apps/web; npx tsx scripts/find-piece.ts --parts=3626bpb0631

# Which figs have this Harry Potter Gryffindor torso?
cd apps/web; npx tsx scripts/find-piece.ts --parts=973px146

# A piece in any colour, including sell-through-cleared rows, plus owned sets
cd apps/web; npx tsx scripts/find-piece.ts --parts=3815 --include-zero-qty --include-sets

# Just standalone — no BL API call
cd apps/web; npx tsx scripts/find-piece.ts --parts=2412b --color="Black" --skip-supersets
```

## Outputs

Pure terminal report. No DB writes, no files written. Sections per run:
Standalone / Containing parts / (Name-pattern torsos when arms+colour) /
Containing minifigs / optional Sets / Summary.

Each row table includes **£** (UK 6-month avg sold price from the BL price
cache, condition-matched) and **STR** (sell-through rate). Useful when you're
deciding which lot to break up to fulfil a stuck order — low STR + low qty =
safer to redirect; high STR = active mover, leave alone.

## Prerequisites

- `apps/web/.env.local` with `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- BrickLink OAuth credentials in `platform_credentials` for any BL-syncing user
  (script picks user_id from a recent `platform_orders` row, same as
  `find-minifigs-with-part.ts`). Skip with `--skip-supersets` if BL is down.
