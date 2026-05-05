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
 * rate (STR = times_sold / stock_available) from `bricklink_part_price_cache`
 * for parts, and `minifig_price_cache` for minifigs. Useful for "I need to
 * steal a part to complete an order" — low STR + low qty = safer to redirect.
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

import { createClient } from '@supabase/supabase-js';
import { CredentialsRepository } from '../src/lib/repositories/credentials.repository';
import type { Database } from '@hadley-bricks/database';

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

if (COLOR_NAME && !BL_COLOR_ID && !SKIP_SUPERSETS) {
  console.error(
    `\nNo BL color_id mapping for "${COLOR_NAME}". Either add it to BL_COLOR_IDS or pass --bl-color-id=N. Use --skip-supersets to bypass the BL API step.`,
  );
  process.exit(1);
}

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ── BL OAuth helpers ────────────────────────────────────────────────────────
async function blOauth(opts: {
  url: string;
  consumerKey: string;
  consumerSecret: string;
  tokenValue: string;
  tokenSecret: string;
}) {
  const crypto = await import('node:crypto');
  const { url, consumerKey, consumerSecret, tokenValue, tokenSecret } = opts;
  const u = new URL(url);
  const params: Record<string, string> = {};
  u.searchParams.forEach((v, k) => {
    params[k] = v;
  });
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_token: tokenValue,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_version: '1.0',
  };
  const all = { ...params, ...oauthParams };
  const baseString = [
    'GET',
    encodeURIComponent(`${u.protocol}//${u.host}${u.pathname}`),
    encodeURIComponent(
      Object.keys(all)
        .sort()
        .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(all[k])}`)
        .join('&'),
    ),
  ].join('&');
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
  const authParams = { ...oauthParams, oauth_signature: signature };
  const authHeader =
    'OAuth ' +
    Object.keys(authParams)
      .map((k) => `${encodeURIComponent(k)}="${encodeURIComponent(authParams[k as keyof typeof authParams])}"`)
      .join(', ');
  return fetch(url, { headers: { Authorization: authHeader, Accept: 'application/json' } });
}

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

async function getBlCreds() {
  const { data: orderRows } = await supabase
    .from('platform_orders')
    .select('user_id')
    .eq('platform', 'bricklink')
    .limit(1);
  const userId = orderRows?.[0]?.user_id;
  if (!userId) throw new Error('No BrickLink user_id found in platform_orders');
  const credRepo = new CredentialsRepository(supabase);
  const blCreds = await credRepo.getCredentials(userId, 'bricklink');
  if (!blCreds) throw new Error('No BL credentials');
  const consumerKey =
    (blCreds as { consumerKey?: string; apiKey?: string }).consumerKey ?? blCreds.apiKey;
  const consumerSecret = (blCreds as { consumerSecret?: string }).consumerSecret;
  const tokenValue = (blCreds as { tokenValue?: string }).tokenValue;
  const tokenSecret = (blCreds as { tokenSecret?: string }).tokenSecret;
  if (!consumerKey || !consumerSecret || !tokenValue || !tokenSecret) {
    throw new Error('Missing BL OAuth fields on credentials row.');
  }
  return { consumerKey, consumerSecret, tokenValue, tokenSecret };
}

async function fetchSupersets(
  partNo: string,
  creds: { consumerKey: string; consumerSecret: string; tokenValue: string; tokenSecret: string },
): Promise<SupersetEntry[]> {
  const url =
    BL_COLOR_ID !== undefined
      ? `https://api.bricklink.com/api/store/v1/items/PART/${encodeURIComponent(partNo)}/supersets?color_id=${BL_COLOR_ID}`
      : `https://api.bricklink.com/api/store/v1/items/PART/${encodeURIComponent(partNo)}/supersets`;
  const r = await blOauth({ url, ...creds });
  const text = await r.text();
  if (!r.ok) {
    console.warn(`[BL ${partNo}] ${r.status}: ${text.slice(0, 200)}`);
    return [];
  }
  const json = JSON.parse(text);
  const blocks = (json?.data ?? []) as Array<{ color_id: number; entries: SupersetEntry[] }>;
  const out: SupersetEntry[] = [];
  for (const block of blocks) {
    if (BL_COLOR_ID !== undefined && block.color_id !== BL_COLOR_ID) continue;
    for (const e of block.entries ?? []) {
      out.push({ ...e, containerColorId: block.color_id });
    }
  }
  return out;
}

// ── Price cache lookups ─────────────────────────────────────────────────────
type PartCacheRow = {
  part_number: string;
  colour_id: number;
  price_new: number | null;
  price_used: number | null;
  stock_available_new: number | null;
  stock_available_used: number | null;
  times_sold_new: number | null;
  times_sold_used: number | null;
};
type MinifigCacheRow = {
  bricklink_id: string;
  bricklink_avg_sold_price: number | null;
  terapeak_avg_sold_price: number | null;
  terapeak_sell_through_rate: number | null;
};

async function fetchPartPrices(partNumbers: string[]): Promise<Map<string, PartCacheRow>> {
  const out = new Map<string, PartCacheRow>();
  if (partNumbers.length === 0) return out;
  const unique = [...new Set(partNumbers)];
  const CHUNK = 500;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('bricklink_part_price_cache')
      .select(
        'part_number, colour_id, price_new, price_used, stock_available_new, stock_available_used, times_sold_new, times_sold_used',
      )
      .in('part_number', chunk);
    if (error) {
      console.warn('  part-price cache fetch error:', error.message);
      continue;
    }
    for (const row of (data ?? []) as PartCacheRow[]) {
      out.set(`${row.part_number}:${row.colour_id}`, row);
    }
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

type PriceGuideResp = {
  avg_price: string;
  qty_avg_price?: string;
  total_quantity: number;
  unit_quantity: number;
  currency_code: string;
};

async function fetchPriceGuide(
  args: { partNo: string; colorId: number; condition: 'N' | 'U'; guideType: 'sold' | 'stock' },
  creds: { consumerKey: string; consumerSecret: string; tokenValue: string; tokenSecret: string },
): Promise<PriceGuideResp | null> {
  const url =
    `https://api.bricklink.com/api/store/v1/items/PART/${encodeURIComponent(args.partNo)}/price` +
    `?color_id=${args.colorId}&country_code=UK&new_or_used=${args.condition}` +
    `&guide_type=${args.guideType}&currency_code=GBP`;
  const r = await blOauth({ url, ...creds });
  const text = await r.text();
  if (!r.ok) {
    if (r.status === 429) throw new Error('rate-limited');
    console.warn(`  [BL ${args.partNo}:${args.colorId} ${args.condition}/${args.guideType}] ${r.status}: ${text.slice(0, 120)}`);
    return null;
  }
  const json = JSON.parse(text);
  return (json?.data ?? null) as PriceGuideResp | null;
}

function pickPartPriceStr(
  cache: Map<string, PartCacheRow>,
  partNumber: string,
  colorName: string | null,
  condition: string | null,
): { price: number | null; str: number | null } {
  const blColorId = lookupBlColorId(colorName);
  if (blColorId === undefined) return { price: null, str: null };
  const row = cache.get(`${partNumber}:${blColorId}`);
  if (!row) return { price: null, str: null };
  const isNew = (condition ?? '').toLowerCase().startsWith('n');
  const price = isNew ? row.price_new : row.price_used;
  const stock = isNew ? row.stock_available_new : row.stock_available_used;
  const sold = isNew ? row.times_sold_new : row.times_sold_used;
  const str = stock != null && stock > 0 && sold != null ? sold / stock : null;
  return { price: price ?? null, str };
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
    const creds = await getBlCreds();
    for (const partNo of PARTS) {
      const entries = await fetchSupersets(partNo, creds);
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
  let partCache: Map<string, PartCacheRow> = new Map();
  let minifigCache: Map<string, MinifigCacheRow> = new Map();
  if (!SKIP_PRICES) {
    const partNumbers = new Set<string>();
    for (const g of standalone) for (const r of g.rows) partNumbers.add(r.item_number);
    for (const c of torsoLikeContainers) partNumbers.add(c.no);
    for (const r of namePatternRows) partNumbers.add(r.item_number);
    partCache = await fetchPartPrices([...partNumbers]);

    const figIds = figs.map((f) => f.no);
    minifigCache = await fetchMinifigPrices(figIds);
  }

  // ── Phase 4b: on-demand BL Price Guide fetch for cache misses ─────────────
  if (!SKIP_PRICES && !NO_FETCH_MISSING) {
    type Miss = { partNumber: string; blColorId: number; condition: 'N' | 'U' };
    const misses: Miss[] = [];
    const seen = new Set<string>();

    function flag(partNumber: string, colorName: string | null, condition: string | null) {
      const blColorId = lookupBlColorId(colorName);
      if (blColorId === undefined) return; // can't query without a BL colour id
      const cond: 'N' | 'U' = (condition ?? '').toLowerCase().startsWith('n') ? 'N' : 'U';
      const k = `${partNumber}:${blColorId}:${cond}`;
      if (seen.has(k)) return;
      const cached = partCache.get(`${partNumber}:${blColorId}`);
      if (cached) {
        const stock = cond === 'N' ? cached.stock_available_new : cached.stock_available_used;
        const sold = cond === 'N' ? cached.times_sold_new : cached.times_sold_used;
        // Cached for this condition if either stock or sold is non-null
        if (stock != null || sold != null) return;
      }
      seen.add(k);
      misses.push({ partNumber, blColorId, condition: cond });
    }

    for (const g of standalone) for (const r of g.rows) flag(r.item_number, r.color_name, r.condition);
    for (const c of torsoLikeContainers) flag(c.no, c.colorName, c.condition);
    for (const r of namePatternRows) flag(r.item_number, r.color_name, r.condition);

    if (misses.length > 0) {
      const cap = Math.min(misses.length, MAX_FETCH);
      console.log(
        `\n[fetch] ${misses.length} cache miss(es) — fetching ${cap} from BL Price Guide (${cap * 2} calls @ 250ms)…`,
      );
      const creds = await getBlCreds();
      const dirtyKeys = new Set<string>();
      let fetched = 0;
      for (const m of misses.slice(0, cap)) {
        const key = `${m.partNumber}:${m.blColorId}`;
        try {
          await new Promise((res) => setTimeout(res, 250));
          const sold = await fetchPriceGuide({ ...m, partNo: m.partNumber, colorId: m.blColorId, guideType: 'sold' }, creds);
          await new Promise((res) => setTimeout(res, 250));
          const stock = await fetchPriceGuide({ ...m, partNo: m.partNumber, colorId: m.blColorId, guideType: 'stock' }, creds);
          fetched++;
          const avg = sold ? parseFloat(sold.avg_price) : 0;
          const soldQty = sold?.total_quantity ?? 0;
          const stockQty = stock?.total_quantity ?? 0;
          const existing: PartCacheRow = partCache.get(key) ?? {
            part_number: m.partNumber,
            colour_id: m.blColorId,
            price_new: null,
            price_used: null,
            stock_available_new: null,
            stock_available_used: null,
            times_sold_new: null,
            times_sold_used: null,
          };
          if (m.condition === 'N') {
            existing.price_new = avg > 0 ? avg : null;
            existing.stock_available_new = stockQty;
            existing.times_sold_new = soldQty;
          } else {
            existing.price_used = avg > 0 ? avg : null;
            existing.stock_available_used = stockQty;
            existing.times_sold_used = soldQty;
          }
          partCache.set(key, existing);
          dirtyKeys.add(key);
        } catch (err) {
          if ((err as Error).message === 'rate-limited') {
            console.warn(`  rate-limited at ${fetched} fetches — stopping`);
            break;
          }
          console.warn(`  fetch failed for ${m.partNumber}:${m.blColorId}/${m.condition}:`, (err as Error).message);
        }
      }

      // Bulk upsert dirty rows
      if (dirtyKeys.size > 0) {
        const rows = [...dirtyKeys].map((k) => {
          const r = partCache.get(k)!;
          return {
            part_number: r.part_number,
            part_type: 'PART',
            colour_id: r.colour_id,
            price_new: r.price_new,
            price_used: r.price_used,
            stock_available_new: r.stock_available_new,
            stock_available_used: r.stock_available_used,
            times_sold_new: r.times_sold_new,
            times_sold_used: r.times_sold_used,
            fetched_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
        });
        const { error } = await supabase
          .from('bricklink_part_price_cache')
          .upsert(rows, { onConflict: 'part_number,colour_id', ignoreDuplicates: false });
        if (error) console.warn('  cache upsert error:', error.message);
        else console.log(`[fetch] upserted ${rows.length} rows to cache`);
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
  const figUnits = figs.reduce((a, f) => a + f.qty, 0);
  console.log('\n── Summary ────────────────────────────────────────────────────────');
  console.log(
    `   Standalone:           ${standalone.reduce((a, g) => a + g.rows.length, 0)} lots / ${standaloneUnits} units`,
  );
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
