/**
 * Find a piece (or pieces) across our Bricqer inventory:
 *
 *   1. Standalone owned instances of that exact part number.
 *   2. Owned torso/part assemblies that contain it (BL `supersets` type=PART).
 *   3. Name-pattern fallback (when --parts includes arm 981/982 + --color set):
 *      973* torsos whose item_name contains "<colour> Arms" — catches torsos
 *      whose body colour ≠ arm colour (e.g. body=Red, arms=Light Gray).
 *   4. Owned minifigs that contain it (BL `supersets` type=MINIFIG).
 *   5. Optionally, owned sets that contain it (--include-sets).
 *
 * Each row is enriched with BL UK 6-month avg sold price (£) and sell-through
 * rate (strQty = sold qty ÷ stock qty) from the unified price cache
 * (`bricklink_price_guide_cache` via readPriceGuide) for parts, and
 * `minifig_price_cache` for minifigs. Useful for "I need to steal a part to
 * complete an order" — low STR + low qty = safer to redirect.
 *
 * Bricqer color_id ≠ BL color_id. We always join Bricqer rows on color_name
 * (case-insensitive) and only translate to BL color_id for the supersets API
 * and price-cache lookup.
 *
 * Usage:
 *   npx tsx scripts/find-piece.ts --parts=981,982 --color="Light Gray"
 *   npx tsx scripts/find-piece.ts --parts=3626bpb0631
 *   npx tsx scripts/find-piece.ts --parts=973pb0340 --skip-supersets
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env.local') });

import { createScriptBlContext } from './_bl-client';
import { BrickLinkApiError, RateLimitError } from '../src/lib/bricklink/client';
import { ensurePriceGuide } from '../src/lib/bricklink/price-guide/capture';
import { readPriceGuide, pgKey, type ItemRef, type PriceGuideView } from '../src/lib/bricklink/price-guide/read';

const BL_COLOR_IDS: Record<string, number> = {
  // Greys
  'Light Gray': 9,
  'Light Bluish Gray': 86,
  'Dark Gray': 10,
  'Dark Bluish Gray': 85,
  'Very Light Bluish Gray': 99,
  'Pearl Light Gray': 66,
  'Pearl Dark Gray': 77,
  // Basic
  Black: 11,
  White: 1,
  Tan: 2,
  Red: 5,
  Blue: 7,
  Green: 6,
  Yellow: 3,
  Orange: 4,
  Brown: 8,
  // Earth/skin
  'Reddish Brown': 88,
  'Dark Brown': 120,
  'Dark Tan': 69,
  'Light Flesh': 78,
  'Medium Dark Flesh': 150,
  // Bright/light
  'Bright Light Yellow': 103,
  'Bright Light Orange': 110,
  'Bright Light Blue': 105,
  'Light Yellow': 33,
  'Light Blue': 62,
  'Light Green': 17,
  'Dark Orange': 68,
  'Dark Red': 59,
  'Dark Blue': 63,
  'Dark Green': 80,
  'Dark Pink': 47,
  Pink: 23,
  Lime: 34,
  'Olive Green': 155,
  'Sand Green': 48,
  'Sand Blue': 55,
  'Sand Red': 58,
  Purple: 24,
  'Dark Purple': 89,
  Magenta: 71,
  // Trans
  'Trans-Clear': 12,
  'Trans-Black IR Lens': 13,
  'Trans-Red': 17,
  'Trans-Light Blue': 15,
  'Trans-Dark Blue': 14,
  'Trans-Yellow': 19,
  'Trans-Green': 20,
  'Trans-Orange': 98,
  // Metallics
  'Pearl Gold': 115,
  Gold: 21,
  Silver: 67,
  'Flat Silver': 95,
  'Pearl Light Gold': 61,
};

function lookupBlColorId(name: string | null | undefined): number | undefined {
  if (!name) return undefined;
  // Case-insensitive lookup
  const lower = name.trim().toLowerCase();
  for (const [k, v] of Object.entries(BL_COLOR_IDS)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? 'true';
  return acc;
}, {});

const PARTS_RAW = argv['parts'] ?? argv['part'];
if (!PARTS_RAW) {
  console.error(
    'Usage: --parts=<no>[,<no>...] [--color="<BL color name>"] [--bl-color-id=N]\n' +
      '       [--skip-supersets] [--skip-prices] [--no-fetch-missing] [--max-fetch=N]\n' +
      '       [--include-zero-qty] [--include-sets]\n' +
      'Examples:\n' +
      '  --parts=981,982 --color="Light Gray"\n' +
      '  --parts=3626bpb0631\n' +
      '  --parts=973pb0340',
  );
  process.exit(1);
}
const PARTS = PARTS_RAW.split(',').map((p) => p.trim()).filter(Boolean);
const COLOR_NAME = argv['color']; // optional
const BL_COLOR_ID = argv['bl-color-id']
  ? parseInt(argv['bl-color-id'], 10)
  : COLOR_NAME
    ? lookupBlColorId(COLOR_NAME)
    : undefined;
const SKIP_SUPERSETS = argv['skip-supersets'] === 'true';
const SKIP_PRICES = argv['skip-prices'] === 'true';
const NO_FETCH_MISSING = argv['no-fetch-missing'] === 'true';
const MAX_FETCH = parseInt(argv['max-fetch'] ?? '100', 10);
const INCLUDE_ZERO = argv['include-zero-qty'] === 'true';
const INCLUDE_SETS = argv['include-sets'] === 'true';
const ARM_PARTS = new Set(['981', '982']);
const RUN_NAME_PATTERN = !!COLOR_NAME && PARTS.some((p) => ARM_PARTS.has(p));

/**
 * Detect torso family root for a BL part number.
 *
 * `973pXX`, `973pbXXXX`, `973pxXXX`, `973bpbXXX` etc. are *printed-pattern
 * torsos*. The optional trailing `cYY` (1–2 digits) encodes the arm/hand
 * assembly variant. Same family root = same printed body; different `cYY` =
 * different arm assembly. So if you have a cracked `973pbXXXXc01` you can
 * potentially combine the bare-body `973pbXXXX` with arms from the damaged
 * one to fulfil the order.
 *
 * Returns null for non-torso parts and for plain-torso codes like `973c000`
 * / `973c00` (the trailing zeros there are part of the pattern, not an arm
 * suffix — these don't have variants worth surfacing).
 */
function torsoFamilyRoot(partNo: string): string | null {
  const m = partNo.match(/^(973(?:bpb|pb|px|pa|p)\w+?)(c\d{1,2})?$/);
  return m ? m[1] : null;
}

if (COLOR_NAME && !BL_COLOR_ID && !SKIP_SUPERSETS) {
  console.error(
    `\nNo BL color_id mapping for "${COLOR_NAME}". Either add it to BL_COLOR_IDS or pass --bl-color-id=N. Use --skip-supersets to bypass the BL API step.`,
  );
  process.exit(1);
}

// BrickLinkClient is wired with daily-counter tracking via _bl-client helper.
// Calls flow through the persistent counter + soft gate. No hand-rolled OAuth.
const { bl, supabase } = createScriptBlContext('find-piece-script');

type SnapshotRow = {
  bricqer_item_id: number;
  item_type: string;
  item_number: string;
  item_name: string | null;
  color_id: number | null;
  color_name: string | null;
  condition: string | null;
  quantity: number | null;
  storage_location: string | null;
  bricqer_price: number | null;
};

async function paginate<T>(
  build: (offset: number) => Promise<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await build(offset);
    if (error) {
      console.error(error);
      break;
    }
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

function fmt(s: string | null | undefined, w: number) {
  return (s ?? '').slice(0, w).padEnd(w);
}

function fmtPrice(p: number | null | undefined) {
  return p == null ? '   —  ' : p.toFixed(2).padStart(6);
}

function fmtStr(s: number | null | undefined) {
  if (s == null) return '  — ';
  const pct = Math.round(s * 100);
  return `${pct}%`.padStart(4);
}

type SupersetEntry = {
  item: { no: string; name: string; type: string };
  quantity: number;
  appear_as: string;
  containerColorId?: number;
};

async function fetchSupersets(partNo: string): Promise<SupersetEntry[]> {
  let blocks;
  try {
    blocks = await bl.getSupersets('PART', partNo, { colorId: BL_COLOR_ID });
  } catch (err) {
    if (err instanceof BrickLinkApiError) {
      console.warn(`[BL ${partNo}] ${err.code}: ${err.message}`);
      return [];
    }
    throw err;
  }
  const out: SupersetEntry[] = [];
  for (const block of blocks) {
    if (BL_COLOR_ID !== undefined && block.color_id !== BL_COLOR_ID) continue;
    for (const e of block.entries ?? []) {
      out.push({
        item: e.item,
        quantity: e.quantity,
        appear_as: e.appear_as,
        containerColorId: block.color_id,
      });
    }
  }
  return out;
}

// ── Price cache lookups ─────────────────────────────────────────────────────
const PART_CACHE_TTL_DAYS = 90; // unified price-guide cache freshness window

type MinifigCacheRow = {
  bricklink_id: string;
  bricklink_avg_sold_price: number | null;
  terapeak_avg_sold_price: number | null;
  terapeak_sell_through_rate: number | null;
};

/**
 * Read UK price views for (part, colour) pairs from the unified price cache.
 * Keyed by pgKey('P', partNo, blColourId). Pairs whose colour name has no BL
 * colour-id mapping are skipped (no price shown, same as before). Views with
 * non-UK coverage (missing or stale row) are treated as cache misses.
 */
async function fetchPartPrices(
  pairs: Array<{ partNumber: string; colorName: string | null }>,
): Promise<Map<string, PriceGuideView>> {
  const out = new Map<string, PriceGuideView>();
  const refs = new Map<string, ItemRef>();
  for (const p of pairs) {
    const blColorId = lookupBlColorId(p.colorName);
    if (blColorId === undefined) continue;
    refs.set(pgKey('P', p.partNumber, blColorId), {
      itemType: 'P',
      itemNo: p.partNumber,
      colourId: blColorId,
      scheme: 'bl',
    });
  }
  if (refs.size === 0) return out;
  const views = await readPriceGuide(supabase, [...refs.values()], {
    ttlDays: PART_CACHE_TTL_DAYS,
    allowWorldFallback: false,
  });
  for (const [key, view] of views) {
    if (view.coverage !== 'uk') continue; // stale/missing → treated as cache miss
    out.set(key, view);
  }
  return out;
}

async function fetchMinifigPrices(ids: string[]): Promise<Map<string, MinifigCacheRow>> {
  const out = new Map<string, MinifigCacheRow>();
  if (ids.length === 0) return out;
  const unique = [...new Set(ids)];
  const CHUNK = 500;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('minifig_price_cache')
      .select(
        'bricklink_id, bricklink_avg_sold_price, terapeak_avg_sold_price, terapeak_sell_through_rate',
      )
      .in('bricklink_id', chunk);
    if (error) {
      console.warn('  minifig-price cache fetch error:', error.message);
      continue;
    }
    for (const row of (data ?? []) as MinifigCacheRow[]) {
      out.set(row.bricklink_id, row);
    }
  }
  return out;
}

function pickPartPriceStr(
  cache: Map<string, PriceGuideView>,
  partNumber: string,
  colorName: string | null,
  condition: string | null,
): { price: number | null; str: number | null } {
  const blColorId = lookupBlColorId(colorName);
  if (blColorId === undefined) return { price: null, str: null };
  const view = cache.get(pgKey('P', partNumber, blColorId));
  if (!view) return { price: null, str: null };
  const isNew = (condition ?? '').toLowerCase().startsWith('n');
  const side = isNew ? view.new : view.used;
  // strQty = sold qty ÷ stock qty — the same formula the legacy columns encoded.
  return { price: side.soldAvg, str: side.strQty };
}

function pickMinifigPriceStr(
  cache: Map<string, MinifigCacheRow>,
  bricklinkId: string,
): { price: number | null; str: number | null } {
  const row = cache.get(bricklinkId);
  if (!row) return { price: null, str: null };
  const price = row.bricklink_avg_sold_price ?? row.terapeak_avg_sold_price ?? null;
  const str = row.terapeak_sell_through_rate ?? null;
  return { price, str };
}

async function main() {
  const colourTag = COLOR_NAME ? ` colour="${COLOR_NAME}"` : ' (any colour)';
  console.log(`\n🔎 find-piece — parts=${PARTS.join(',')}${colourTag}`);

  // ── Phase 1: standalone Bricqer rows ──────────────────────────────────────
  type StandaloneGroup = { partNo: string; rows: SnapshotRow[] };
  const standalone: StandaloneGroup[] = [];
  for (const partNo of PARTS) {
    const rows = await paginate<SnapshotRow>((offset) => {
      let q = supabase
        .from('bricqer_inventory_snapshot')
        .select(
          'bricqer_item_id, item_type, item_number, item_name, color_id, color_name, condition, quantity, storage_location, bricqer_price',
        )
        .eq('item_type', 'Part')
        .eq('item_number', partNo);
      if (COLOR_NAME) q = q.ilike('color_name', COLOR_NAME);
      return q.range(offset, offset + 999) as unknown as Promise<{
        data: SnapshotRow[] | null;
        error: unknown;
      }>;
    });
    standalone.push({ partNo, rows: INCLUDE_ZERO ? rows : rows.filter((r) => (r.quantity ?? 0) > 0) });
  }

  // ── Phase 2: BL supersets ─────────────────────────────────────────────────
  const supersetByPart: Map<string, SupersetEntry[]> = new Map();
  if (!SKIP_SUPERSETS) {
    for (const partNo of PARTS) {
      const entries = await fetchSupersets(partNo);
      supersetByPart.set(partNo, entries);
      const m = entries.filter((e) => e.item.type === 'MINIFIG').length;
      const p = entries.filter((e) => e.item.type === 'PART').length;
      const s = entries.filter((e) => e.item.type === 'SET').length;
      console.log(
        `[BL] ${partNo}${BL_COLOR_ID !== undefined ? ` color_id=${BL_COLOR_ID}` : ''} → ${m} minifigs, ${p} parts (containers), ${s} sets`,
      );
      await new Promise((res) => setTimeout(res, 250));
    }
  }

  type ContainerMeta = {
    type: string;
    name: string;
    uses: Array<{ partNo: string; qty: number; appearAs: string }>;
  };
  const containers = new Map<string, ContainerMeta>();
  for (const [partNo, entries] of supersetByPart) {
    for (const e of entries) {
      const k = e.item.no.toLowerCase();
      if (!containers.has(k)) containers.set(k, { type: e.item.type, name: e.item.name, uses: [] });
      containers.get(k)!.uses.push({ partNo, qty: e.quantity, appearAs: e.appear_as });
    }
  }

  // ── Phase 3: intersect with owned snapshot ────────────────────────────────
  const minifigKeys = [...containers.values()].some((c) => c.type === 'MINIFIG')
    ? new Set([...containers.entries()].filter(([, c]) => c.type === 'MINIFIG').map(([k]) => k))
    : null;
  const partContainerKeys = new Set(
    [...containers.entries()].filter(([, c]) => c.type === 'PART').map(([k]) => k),
  );
  const setContainerKeys = INCLUDE_SETS
    ? new Set([...containers.entries()].filter(([, c]) => c.type === 'SET').map(([k]) => k))
    : null;

  const ownedMinifigs: SnapshotRow[] = minifigKeys
    ? await paginate<SnapshotRow>((offset) =>
        supabase
          .from('bricqer_inventory_snapshot')
          .select(
            'bricqer_item_id, item_type, item_number, item_name, color_id, color_name, condition, quantity, storage_location, bricqer_price',
          )
          .eq('item_type', 'Minifig')
          .range(offset, offset + 999) as unknown as Promise<{ data: SnapshotRow[] | null; error: unknown }>,
      )
    : [];

  const ownedPartContainers: SnapshotRow[] = partContainerKeys.size
    ? await paginate<SnapshotRow>((offset) =>
        supabase
          .from('bricqer_inventory_snapshot')
          .select(
            'bricqer_item_id, item_type, item_number, item_name, color_id, color_name, condition, quantity, storage_location, bricqer_price',
          )
          .eq('item_type', 'Part')
          .range(offset, offset + 999) as unknown as Promise<{ data: SnapshotRow[] | null; error: unknown }>,
      )
    : [];

  const ownedSetContainers: SnapshotRow[] = setContainerKeys?.size
    ? await paginate<SnapshotRow>((offset) =>
        supabase
          .from('bricqer_inventory_snapshot')
          .select(
            'bricqer_item_id, item_type, item_number, item_name, color_id, color_name, condition, quantity, storage_location, bricqer_price',
          )
          .eq('item_type', 'Set')
          .range(offset, offset + 999) as unknown as Promise<{ data: SnapshotRow[] | null; error: unknown }>,
      )
    : [];

  // ── Phase 3b: name-pattern fallback (arm 981/982 + colour) ─────────────────
  // Two cases:
  //   (a) item_name explicitly says "<colour> Arms" — body colour may differ
  //   (b) body colour = <colour> AND name says "(Same Color) Arms" — same-colour assemblies
  let namePatternRows: SnapshotRow[] = [];
  if (RUN_NAME_PATTERN) {
    const explicit = await paginate<SnapshotRow>((offset) =>
      supabase
        .from('bricqer_inventory_snapshot')
        .select(
          'bricqer_item_id, item_type, item_number, item_name, color_id, color_name, condition, quantity, storage_location, bricqer_price',
        )
        .eq('item_type', 'Part')
        .like('item_number', '973%')
        .ilike('item_name', `%${COLOR_NAME} arms%`)
        .range(offset, offset + 999) as unknown as Promise<{ data: SnapshotRow[] | null; error: unknown }>,
    );
    const sameColour = await paginate<SnapshotRow>((offset) =>
      supabase
        .from('bricqer_inventory_snapshot')
        .select(
          'bricqer_item_id, item_type, item_number, item_name, color_id, color_name, condition, quantity, storage_location, bricqer_price',
        )
        .eq('item_type', 'Part')
        .like('item_number', '973%')
        .ilike('color_name', COLOR_NAME!)
        .ilike('item_name', '%(same color) arms%')
        .range(offset, offset + 999) as unknown as Promise<{ data: SnapshotRow[] | null; error: unknown }>,
    );
    // Merge dedup by bricqer_item_id (the `c000` rows don't overlap with explicit, but be safe)
    const seen = new Set<number>();
    const all = [...explicit, ...sameColour].filter((r) => {
      if (seen.has(r.bricqer_item_id)) return false;
      seen.add(r.bricqer_item_id);
      return true;
    });
    namePatternRows = INCLUDE_ZERO ? all : all.filter((r) => (r.quantity ?? 0) > 0);
  }

  // ── Phase 3c: torso family variants ───────────────────────────────────────
  // Same-print sibling torsos with different arm-assembly suffix. Useful when
  // an assembled `973pbXXXXcYY` is unavailable but the bare `973pbXXXX` body
  // is in stock — combine with arms recovered from a damaged unit.
  const familyRoots = new Set<string>();
  for (const p of PARTS) {
    const root = torsoFamilyRoot(p);
    if (root) familyRoots.add(root);
  }
  const exactInputSet = new Set(PARTS.map((p) => p.toLowerCase()));
  let familyVariants: SnapshotRow[] = [];
  if (familyRoots.size > 0) {
    for (const root of familyRoots) {
      const rows = await paginate<SnapshotRow>((offset) => {
        let q = supabase
          .from('bricqer_inventory_snapshot')
          .select(
            'bricqer_item_id, item_type, item_number, item_name, color_id, color_name, condition, quantity, storage_location, bricqer_price',
          )
          .eq('item_type', 'Part')
          .like('item_number', `${root}%`);
        if (COLOR_NAME) q = q.ilike('color_name', COLOR_NAME);
        return q.range(offset, offset + 999) as unknown as Promise<{
          data: SnapshotRow[] | null;
          error: unknown;
        }>;
      });
      for (const r of rows) {
        if (exactInputSet.has(r.item_number.toLowerCase())) continue;
        if (!INCLUDE_ZERO && (r.quantity ?? 0) <= 0) continue;
        familyVariants.push(r);
      }
    }
  }

  // Build owned-row lists for downstream intersection (containers from BL supersets)
  type OwnedContainerRow = {
    no: string;
    name: string;
    qty: number;
    storage: string;
    condition: string;
    colorName: string | null;
    bricqerPrice: number | null;
    uses: Array<{ partNo: string; qty: number; appearAs: string }>;
  };
  function rollUp(rows: SnapshotRow[], keys: Set<string>): OwnedContainerRow[] {
    const grouped = new Map<string, OwnedContainerRow>();
    for (const row of rows) {
      const k = row.item_number.toLowerCase();
      if (!keys.has(k)) continue;
      if (!INCLUDE_ZERO && (row.quantity ?? 0) <= 0) continue;
      if (!grouped.has(k)) {
        const meta = containers.get(k)!;
        grouped.set(k, {
          no: row.item_number,
          name: row.item_name || meta.name,
          qty: 0,
          storage: '',
          condition: row.condition ?? '?',
          colorName: row.color_name,
          bricqerPrice: row.bricqer_price ?? null,
          uses: meta.uses,
        });
      }
      const e = grouped.get(k)!;
      e.qty += row.quantity ?? 0;
      if (!e.storage && row.storage_location) e.storage = row.storage_location;
      if (e.bricqerPrice == null && row.bricqer_price != null) e.bricqerPrice = row.bricqer_price;
    }
    return [...grouped.values()].sort((a, b) => b.qty - a.qty);
  }

  const figs = minifigKeys ? rollUp(ownedMinifigs, minifigKeys) : [];
  const torsoLikeContainers = rollUp(ownedPartContainers, partContainerKeys);
  const setContainers = setContainerKeys ? rollUp(ownedSetContainers, setContainerKeys) : [];

  // ── Phase 4: bulk-fetch price/STR for everything we'll render ─────────────
  let partCache: Map<string, PriceGuideView> = new Map();
  let minifigCache: Map<string, MinifigCacheRow> = new Map();
  if (!SKIP_PRICES) {
    const pairs: Array<{ partNumber: string; colorName: string | null }> = [];
    for (const g of standalone) for (const r of g.rows) pairs.push({ partNumber: r.item_number, colorName: r.color_name });
    for (const c of torsoLikeContainers) pairs.push({ partNumber: c.no, colorName: c.colorName });
    for (const r of namePatternRows) pairs.push({ partNumber: r.item_number, colorName: r.color_name });
    for (const r of familyVariants) pairs.push({ partNumber: r.item_number, colorName: r.color_name });
    partCache = await fetchPartPrices(pairs);

    const figIds = figs.map((f) => f.no);
    minifigCache = await fetchMinifigPrices(figIds);
  }

  // ── Phase 4b: on-demand BL Price Guide fetch for cache misses ─────────────
  if (!SKIP_PRICES && !NO_FETCH_MISSING) {
    type Miss = { partNumber: string; blColorId: number };
    const misses: Miss[] = [];
    const seen = new Set<string>();

    function flag(partNumber: string, colorName: string | null) {
      const blColorId = lookupBlColorId(colorName);
      if (blColorId === undefined) return; // can't query without a BL colour id
      const k = pgKey('P', partNumber, blColorId);
      if (seen.has(k)) return;
      // Unified rows are complete (all 4 quadrants in one row) — any fresh UK view
      // covers both conditions, so a present view means no fetch needed.
      if (partCache.has(k)) return;
      seen.add(k);
      misses.push({ partNumber, blColorId });
    }

    for (const g of standalone) for (const r of g.rows) flag(r.item_number, r.color_name);
    for (const c of torsoLikeContainers) flag(c.no, c.colorName);
    for (const r of namePatternRows) flag(r.item_number, r.color_name);
    for (const r of familyVariants) flag(r.item_number, r.color_name);

    if (misses.length > 0) {
      const cap = Math.min(misses.length, MAX_FETCH);
      console.log(
        `\n[fetch] ${misses.length} cache miss(es) — fetching ${cap} from BL Price Guide (${cap * 4} calls @ 250ms)…`,
      );
      let fetched = 0;
      for (const m of misses.slice(0, cap)) {
        try {
          await new Promise((res) => setTimeout(res, 250));
          // One ensurePriceGuide call = all four UK quadrants (sold/stock × N/U),
          // 4 API calls, captured into the unified price cache automatically —
          // no manual upsert-back needed.
          const view = await ensurePriceGuide(
            bl,
            supabase,
            { itemType: 'P', itemNo: m.partNumber, colourId: m.blColorId },
            { ttlDays: PART_CACHE_TTL_DAYS },
          );
          fetched++;
          partCache.set(pgKey('P', m.partNumber, m.blColorId), view);
        } catch (err) {
          if (err instanceof RateLimitError || (err instanceof BrickLinkApiError && err.code === 429)) {
            console.warn(`  rate-limited at ${fetched} fetches — stopping`);
            break;
          }
          console.warn(`  fetch failed for ${m.partNumber}:${m.blColorId}:`, (err as Error).message);
        }
      }
      if (misses.length > cap) {
        console.log(`[fetch] ${misses.length - cap} miss(es) skipped (over --max-fetch=${MAX_FETCH}). Re-run to continue.`);
      }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log(`  find-piece — ${PARTS.join(', ')}${colourTag}`);
  console.log('══════════════════════════════════════════════════════════════════');

  // Standalone
  for (const g of standalone) {
    const units = g.rows.reduce((a, r) => a + (r.quantity ?? 0), 0);
    console.log(
      `\n📦 Standalone part ${g.partNo}${COLOR_NAME ? ` in ${COLOR_NAME}` : ''}: ${g.rows.length} lots / ${units} units`,
    );
    if (g.rows.length === 0) {
      console.log('   (none)');
      continue;
    }
    console.log(
      `   ${'item'.padEnd(13)} ${'colour'.padEnd(22)} ${'qty'.padStart(3)}  ${'cond'.padEnd(5)} ${'loc'.padEnd(11)} ${'list £'.padStart(6)} ${'STR'.padStart(4)}  name`,
    );
    for (const r of g.rows.sort((a, b) => (b.quantity ?? 0) - (a.quantity ?? 0))) {
      const { str } = pickPartPriceStr(partCache, r.item_number, r.color_name, r.condition);
      console.log(
        `   ${fmt(r.item_number, 13)} ${fmt(r.color_name, 22)} ${String(r.quantity).padStart(3)}  ${fmt(r.condition, 5)} ${fmt(r.storage_location, 11)} ${fmtPrice(r.bricqer_price)} ${fmtStr(str)}  ${(r.item_name ?? '').slice(0, 50)}`,
      );
    }
  }

  // Related torso family variants — same printed pattern, different arm/assembly suffix.
  if (familyRoots.size > 0) {
    const totalUnits = familyVariants.reduce((a, r) => a + (r.quantity ?? 0), 0);
    const rootList = [...familyRoots].join(', ');
    console.log(
      `\n🧬 Related torso family variants (same pattern as ${rootList}, different arm/assembly): ${familyVariants.length} lots / ${totalUnits} units`,
    );
    console.log(`   Use case: bare-body 973pbXXXX + arms recovered from a damaged 973pbXXXXcYY`);
    console.log(`   = a working assembly when the cYY isn't available standalone.`);
    if (familyVariants.length === 0) {
      console.log('   (none)');
    } else {
      console.log(
        `   ${'item'.padEnd(13)} ${'colour'.padEnd(15)} ${'qty'.padStart(3)}  ${'cond'.padEnd(5)} ${'loc'.padEnd(11)} ${'list £'.padStart(6)} ${'STR'.padStart(4)}  name`,
      );
      for (const r of familyVariants.sort((a, b) => (b.quantity ?? 0) - (a.quantity ?? 0))) {
        const { str } = pickPartPriceStr(partCache, r.item_number, r.color_name, r.condition);
        console.log(
          `   ${fmt(r.item_number, 13)} ${fmt(r.color_name, 15)} ${String(r.quantity).padStart(3)}  ${fmt(r.condition, 5)} ${fmt(r.storage_location, 11)} ${fmtPrice(r.bricqer_price)} ${fmtStr(str)}  ${(r.item_name ?? '').slice(0, 50)}`,
        );
      }
    }
  }

  if (SKIP_SUPERSETS) {
    console.log('\n(--skip-supersets set; no container cross-reference)');
    return;
  }

  // Containing parts (torso assemblies, etc.) — from BL supersets
  console.log(
    `\n🧩 Owned parts that contain ${PARTS.join('/')} (BL "supersets" type=PART): ${torsoLikeContainers.length}`,
  );
  if (torsoLikeContainers.length === 0) {
    console.log('   (none)');
  } else {
    console.log(
      `   ${'item'.padEnd(13)} ${'colour'.padEnd(15)} ${'qty'.padStart(3)}  ${'cond'.padEnd(5)} ${'loc'.padEnd(11)} ${'list £'.padStart(6)} ${'STR'.padStart(4)} ${'uses'.padEnd(14)}  name`,
    );
    for (const c of torsoLikeContainers) {
      const uses = c.uses
        .map((u) => `${u.partNo}×${u.qty}${u.appearAs && u.appearAs !== 'A' ? `[${u.appearAs}]` : ''}`)
        .join(',');
      const { str } = pickPartPriceStr(partCache, c.no, c.colorName, c.condition);
      console.log(
        `   ${fmt(c.no, 13)} ${fmt(c.colorName, 15)} ${String(c.qty).padStart(3)}  ${fmt(c.condition, 5)} ${fmt(c.storage, 11)} ${fmtPrice(c.bricqerPrice)} ${fmtStr(str)} ${fmt(uses, 14)}  ${c.name.slice(0, 40)}`,
      );
    }
  }

  // Name-pattern fallback (catches body-colour ≠ arm-colour torsos)
  if (RUN_NAME_PATTERN) {
    const totalUnits = namePatternRows.reduce((a, r) => a + (r.quantity ?? 0), 0);
    console.log(
      `\n📜 Torsos with "${COLOR_NAME} Arms" in item_name (catches body≠arm colour): ${namePatternRows.length} lots / ${totalUnits} units`,
    );
    if (namePatternRows.length === 0) {
      console.log('   (none)');
    } else {
      console.log(
        `   ${'item'.padEnd(13)} ${'body'.padEnd(15)} ${'qty'.padStart(3)}  ${'cond'.padEnd(5)} ${'loc'.padEnd(11)} ${'list £'.padStart(6)} ${'STR'.padStart(4)}  name`,
      );
      for (const r of namePatternRows.sort((a, b) => (b.quantity ?? 0) - (a.quantity ?? 0))) {
        const { str } = pickPartPriceStr(partCache, r.item_number, r.color_name, r.condition);
        console.log(
          `   ${fmt(r.item_number, 13)} ${fmt(r.color_name, 15)} ${String(r.quantity).padStart(3)}  ${fmt(r.condition, 5)} ${fmt(r.storage_location, 11)} ${fmtPrice(r.bricqer_price)} ${fmtStr(str)}  ${(r.item_name ?? '').slice(0, 50)}`,
        );
      }
    }
  }

  // Containing minifigs
  console.log(
    `\n👥 Owned minifigs that contain ${PARTS.join('/')} (BL "supersets" type=MINIFIG): ${figs.length}`,
  );
  if (figs.length === 0) {
    console.log('   (none)');
  } else {
    console.log(
      `   ${'minifig'.padEnd(12)} ${'qty'.padStart(3)}  ${'cond'.padEnd(5)} ${'loc'.padEnd(11)} ${'list £'.padStart(6)} ${'STR'.padStart(4)} ${'uses'.padEnd(14)}  name`,
    );
    for (const f of figs) {
      const uses = f.uses
        .map((u) => `${u.partNo}×${u.qty}${u.appearAs && u.appearAs !== 'A' ? `[${u.appearAs}]` : ''}`)
        .join(',');
      const { str } = pickMinifigPriceStr(minifigCache, f.no);
      console.log(
        `   ${fmt(f.no, 12)} ${String(f.qty).padStart(3)}  ${fmt(f.condition, 5)} ${fmt(f.storage, 11)} ${fmtPrice(f.bricqerPrice)} ${fmtStr(str)} ${fmt(uses, 14)}  ${f.name.slice(0, 40)}`,
      );
    }
  }

  if (INCLUDE_SETS) {
    console.log(
      `\n📦 Owned sets that contain ${PARTS.join('/')} (BL "supersets" type=SET): ${setContainers.length}`,
    );
    if (setContainers.length === 0) {
      console.log('   (none)');
    } else {
      for (const s of setContainers) {
        const uses = s.uses.map((u) => `${u.partNo}×${u.qty}`).join(',');
        console.log(
          `   ${fmt(s.no, 12)} qty=${s.qty} ${s.condition} ${s.storage} uses=${uses}  ${s.name.slice(0, 50)}`,
        );
      }
    }
  }

  // Summary
  const standaloneUnits = standalone.reduce(
    (a, g) => a + g.rows.reduce((b, r) => b + (r.quantity ?? 0), 0),
    0,
  );
  const torsoUnits = torsoLikeContainers.reduce((a, c) => a + c.qty, 0);
  const namePatternUnits = namePatternRows.reduce((a, r) => a + (r.quantity ?? 0), 0);
  const familyUnits = familyVariants.reduce((a, r) => a + (r.quantity ?? 0), 0);
  const figUnits = figs.reduce((a, f) => a + f.qty, 0);
  console.log('\n── Summary ────────────────────────────────────────────────────────');
  console.log(
    `   Standalone:           ${standalone.reduce((a, g) => a + g.rows.length, 0)} lots / ${standaloneUnits} units`,
  );
  if (familyRoots.size > 0) {
    console.log(`   Family variants:      ${familyVariants.length} lots / ${familyUnits} units`);
  }
  console.log(`   Containing parts:     ${torsoLikeContainers.length} lots / ${torsoUnits} units`);
  if (RUN_NAME_PATTERN) {
    console.log(`   Name-pattern torsos:  ${namePatternRows.length} lots / ${namePatternUnits} units`);
  }
  console.log(`   Containing minifigs:  ${figs.length} lots / ${figUnits} units`);
  if (INCLUDE_SETS) {
    const setUnits = setContainers.reduce((a, s) => a + s.qty, 0);
    console.log(`   Containing sets:      ${setContainers.length} lots / ${setUnits} units`);
  }
  console.log('');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
