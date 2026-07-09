/**
 * Store-quality engine.
 *
 * Loads the Bricqer snapshot (anchor), the BrickLink price cache, the minifig
 * cache, and our own realized BL+BO sales, then computes the six-dimension
 * Store Quality Score, per-lot velocity/price/flag classification, the profile
 * distributions, and the action lists.
 *
 * Cached-only: makes ZERO external BrickLink/Brick Owl/Bricqer API calls.
 *
 * Join model (see docs/store-quality/store-quality-framework.md §1.1):
 *   - snapshot → BL cache:  (part_number, color_id)        [shared Bricqer scheme]
 *   - snapshot → our sales: (item_number, color_name, cond) [BL colour ids differ]
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { strRatioFromCache } from './pricing';
import { readPriceGuide, pgKey } from '../bricklink/price-guide/read';
import { loadColourMap } from '../bricklink/colour-map';
import type {
  ActionItem,
  CompositionRow,
  DimensionScore,
  EnrichedLot,
  LotFlag,
  PricePosition,
  ProfileRow,
  Segment,
  StoreQualityResult,
  VelocityClass,
} from './types';

const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';
const SUB_FLOOR = 0.1; // < 10p picking-drag threshold
const OVERSTOCK_DAYS = 365;
const PICK_TARGET_AVG = 0.8; // target avg £ per lot
const BLIND_VALUE_FLOOR = 0.5; // only surface BLIND lots worth flagging

// Dimension weights (sum = 1).
const WEIGHTS = {
  velocity: 0.3,
  picking: 0.25,
  margin: 0.2,
  ageing: 0.1,
  coverage: 0.1,
  freshness: 0.05,
} as const;

const VELOCITY_WEIGHT: Record<VelocityClass, number> = {
  MOVER: 1.0,
  'MARKET-ONLY': 0.8,
  SLOW: 0.5,
  OVERSTOCK: 0.4,
  BLIND: 0.3,
  DEAD: 0.0,
};

const POSITION_WEIGHT: Record<PricePosition, number> = {
  'AT-MARKET': 1.0,
  KEEN: 0.9,
  PREMIUM: 0.7,
  UNDER: 0.5,
  UNKNOWN: 0.5,
  OVER: 0.2,
};

export interface EngineOptions {
  userId?: string;
  segment?: Segment;
  windowDays?: number;
  maxStaleDays?: number;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

interface RawLot {
  item_number: string;
  item_name: string | null;
  item_type: string;
  color_id: number | null;
  color_name: string | null;
  condition: string;
  quantity: number;
  bricqer_price: number | string | null;
  storage_location: string | null;
}

interface BLCacheRow {
  priceNew: number | null;
  priceUsed: number | null;
  strNew: number | null; // ×100 percentage, 0 and null preserved
  strUsed: number | null;
}

interface SalesAgg {
  units: number;
  orders: Set<string>;
  lastSold: number; // epoch ms
}

interface OrderStat {
  lots: number;
  value: number;
}

/** Generic paginated select (Supabase caps at 1000 rows/request). */
async function fetchAllRange<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

function normCondition(c: string | null | undefined): 'New' | 'Used' {
  return c === 'New' || c === 'N' ? 'New' : 'Used';
}

function normColour(name: string | null | undefined): string {
  return (name ?? '').toLowerCase().trim();
}

function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

async function loadSnapshot(
  supabase: SupabaseClient<Database>,
  userId: string,
  types: string[]
): Promise<RawLot[]> {
  return fetchAllRange<RawLot>((from, to) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('bricqer_inventory_snapshot')
      .select(
        'item_number,item_name,item_type,color_id,color_name,condition,quantity,bricqer_price,storage_location'
      )
      .eq('user_id', userId)
      .in('item_type', types)
      .gt('quantity', 0)
      .order('bricqer_item_id', { ascending: true }) // stable order — required for range pagination
      .range(from, to)
  );
}

/**
 * Load BL cache keyed by `part|colorId`, PRESERVING str=0 vs str=null.
 *
 * A single part_number fans out to many colour rows (~3.3 avg), so an
 * `.in(part_numbers)` batch can exceed Supabase's 1,000-row cap. We use a small
 * part-batch AND paginate within each batch (CLAUDE.md: always paginate).
 */
async function loadBLCache(
  supabase: SupabaseClient<Database>,
  partLots: Array<{ item_number: string; color_id: number | null }>
): Promise<Map<string, BLCacheRow>> {
  // Unified price cache (F7): source UK 6MA + STR from bricklink_price_guide_cache via
  // readPriceGuide, colour-normalised Bricqer->BL (fixes the legacy mixed-colour-scheme join
  // bug — snapshot color_id is Bricqer scheme, price_guide_cache is BL). World-fallback fills
  // gaps until UK coverage is warmed. Keyed by `${item_number}|${bricqer_color_id}` and shaped
  // as BLCacheRow (STR stored ×100) so the enrich loop + strRatioFromCache are unchanged.
  const map = new Map<string, BLCacheRow>();
  if (partLots.length === 0) return map;
  const refs = partLots.map((l) => ({
    itemType: 'P' as const, itemNo: l.item_number, colourId: l.color_id ?? 0, scheme: 'bricqer' as const,
  }));
  const [views, cmap] = await Promise.all([
    readPriceGuide(supabase, refs, { allowWorldFallback: true }),
    loadColourMap(supabase),
  ]);
  for (const l of partLots) {
    const blColour = cmap.toBl(l.color_id ?? 0, 'bricqer');
    const v = views.get(pgKey('P', l.item_number, blColour));
    if (!v) continue;
    map.set(`${l.item_number}|${l.color_id}`, {
      priceNew: v.new.soldAvg,
      priceUsed: v.used.soldAvg,
      strNew: v.new.strQty == null ? null : v.new.strQty * 100,
      strUsed: v.used.strQty == null ? null : v.used.strQty * 100,
    });
  }
  return map;
}

async function loadMinifigCache(
  supabase: SupabaseClient<Database>,
  ids: string[]
): Promise<Map<string, { avg: number | null; str: number | null }>> {
  const map = new Map<string, { avg: number | null; str: number | null }>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 500) {
    const batch = unique.slice(i, i + 500);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('minifig_price_cache')
      .select('bricklink_id,terapeak_avg_sold_price,terapeak_sell_through_rate')
      .in('bricklink_id', batch);
    if (error) throw error;
    for (const r of data ?? []) {
      map.set(r.bricklink_id, {
        avg: r.terapeak_avg_sold_price == null ? null : Number(r.terapeak_avg_sold_price),
        str: r.terapeak_sell_through_rate == null ? null : Number(r.terapeak_sell_through_rate),
      });
    }
  }
  return map;
}

/** Load our realized BL+BO sales in the window, aggregated by part key + per-order stats. */
async function loadRealizedSales(
  supabase: SupabaseClient<Database>,
  userId: string,
  windowDays: number
): Promise<{ byKey: Map<string, SalesAgg>; orderStats: OrderStat[] }> {
  const cutoff = new Date(Date.now() - windowDays * 86400000).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orders = await fetchAllRange<any>((from, to) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('platform_orders')
      .select(
        'id,order_date,subtotal,order_items(item_number,color_name,condition,item_type,quantity,unit_price,total_price)'
      )
      .eq('user_id', userId)
      .in('platform', ['bricklink', 'brickowl'])
      .gte('order_date', cutoff)
      .order('id', { ascending: true }) // stable order — required for range pagination
      .range(from, to)
  );

  const byKey = new Map<string, SalesAgg>();
  const orderStats: OrderStat[] = [];

  for (const o of orders) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items: any[] = o.order_items ?? [];
    let lots = 0;
    let lineValue = 0;
    const soldMs = o.order_date ? Date.parse(o.order_date) : Date.now();
    for (const it of items) {
      const type = (it.item_type ?? '').toUpperCase();
      if (type !== 'PART' && type !== 'MINIFIG' && type !== 'MINIFIGURE') continue;
      lots += 1;
      lineValue += num(it.total_price) || num(it.unit_price) * num(it.quantity);
      const key = `${it.item_number}|${normColour(it.color_name)}|${normCondition(it.condition)}`;
      const agg = byKey.get(key) ?? { units: 0, orders: new Set<string>(), lastSold: 0 };
      agg.units += num(it.quantity);
      agg.orders.add(o.id);
      if (soldMs > agg.lastSold) agg.lastSold = soldMs;
      byKey.set(key, agg);
    }
    // Grind detection uses merch value: prefer summed line prices, fall back to order subtotal.
    const value = lineValue > 0 ? lineValue : num(o.subtotal);
    orderStats.push({ lots, value });
  }
  return { byKey, orderStats };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function classifyVelocity(
  soldByUs: boolean,
  daysOfCover: number | null,
  marketStrRatio: number | null
): VelocityClass {
  if (soldByUs) return daysOfCover !== null && daysOfCover > OVERSTOCK_DAYS ? 'OVERSTOCK' : 'MOVER';
  if (marketStrRatio === null) return 'BLIND';
  if (marketStrRatio >= 0.5) return 'MARKET-ONLY';
  if (marketStrRatio >= 0.05) return 'SLOW';
  return 'DEAD';
}

function classifyPosition(ratio: number | null): PricePosition {
  if (ratio === null) return 'UNKNOWN';
  if (ratio < 0.7) return 'UNDER';
  if (ratio < 0.95) return 'KEEN';
  if (ratio < 1.15) return 'AT-MARKET';
  if (ratio < 1.5) return 'PREMIUM';
  return 'OVER';
}

function computeFlags(lot: EnrichedLot, soldByUs: boolean): LotFlag[] {
  const f: LotFlag[] = [];
  const r = lot.priceRatio;
  // Guard against noise from tiny 6-month averages (a 3p avg yields absurd ratios).
  const priceComparable = lot.sixMonthAvg !== null && lot.sixMonthAvg >= 0.05;
  if (priceComparable && r !== null && r > 1.5 && !soldByUs) f.push('STUCK-HIGH');
  if (priceComparable && r !== null && r < 0.7 && lot.marketStrRatio !== null && lot.marketStrRatio >= 0.5)
    f.push('UNDER-PRICED');
  if (lot.velocity === 'OVERSTOCK') f.push('OVERSTOCK');
  if (lot.velocity === 'DEAD') f.push('DEAD');
  if (lot.bricqerPrice < SUB_FLOOR && lot.velocity === 'MOVER') f.push('LOW-YIELD-PICK');
  if (lot.velocity === 'BLIND' && lot.listValue >= BLIND_VALUE_FLOOR) f.push('BLIND-HIGH-VALUE');
  return f;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function computeStoreQuality(
  supabase: SupabaseClient<Database>,
  opts: EngineOptions = {}
): Promise<StoreQualityResult> {
  const userId = opts.userId ?? DEFAULT_USER_ID;
  const segment: Segment = opts.segment ?? 'all';
  const windowDays = opts.windowDays ?? 180;
  const maxStaleDays = opts.maxStaleDays ?? 30;

  const types = segment === 'parts' ? ['Part'] : segment === 'minifigs' ? ['Minifig'] : ['Part', 'Minifig'];

  // ---- load ----
  const [rawLots, meta] = await Promise.all([
    loadSnapshot(supabase, userId, types),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('bricqer_snapshot_meta')
      .select('last_full_sync')
      .eq('user_id', userId)
      .maybeSingle()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((r: any) => r.data),
  ]);

  const partLots = rawLots.filter((l) => l.item_type === 'Part');
  const minifigIds = rawLots.filter((l) => l.item_type === 'Minifig').map((l) => l.item_number);

  const [blCache, mfCache, sales] = await Promise.all([
    loadBLCache(supabase, partLots),
    loadMinifigCache(supabase, minifigIds),
    loadRealizedSales(supabase, userId, windowDays),
  ]);

  const snapshotDate: string | null = meta?.last_full_sync ?? null;
  const snapshotAgeDays = snapshotDate
    ? Math.floor((Date.now() - Date.parse(snapshotDate)) / 86400000)
    : null;
  const stale = snapshotAgeDays !== null && snapshotAgeDays > maxStaleDays;
  const now = Date.now();

  // ---- enrich ----
  const lots: EnrichedLot[] = rawLots.map((raw) => {
    const condition = normCondition(raw.condition);
    const isNew = condition === 'New';
    const qty = raw.quantity;
    const price = num(raw.bricqer_price);
    const listValue = qty * price;

    let sixMonthAvg: number | null = null;
    let marketStrRatio: number | null = null;

    if (raw.item_type === 'Minifig') {
      const mc = mfCache.get(raw.item_number);
      sixMonthAvg = mc?.avg && mc.avg > 0 ? mc.avg : null;
      marketStrRatio = mc?.str == null ? null : mc.str / 100;
    } else {
      const c = blCache.get(`${raw.item_number}|${raw.color_id}`);
      const avg = c ? (isNew ? c.priceNew : c.priceUsed) : null;
      sixMonthAvg = avg && avg > 0 ? avg : null;
      const strPct = c ? (isNew ? c.strNew : c.strUsed) : null;
      marketStrRatio = strRatioFromCache(strPct);
    }

    const key = `${raw.item_number}|${normColour(raw.color_name)}|${condition}`;
    const agg = sales.byKey.get(key);
    const unitsSold = agg?.units ?? 0;
    const soldByUs = unitsSold > 0;
    const ordersWith = agg ? agg.orders.size : 0;
    const lastSoldDaysAgo =
      agg && agg.lastSold > 0 ? Math.floor((now - agg.lastSold) / 86400000) : null;
    const ratePerDay = unitsSold / windowDays;
    const daysOfCover = soldByUs && ratePerDay > 0 ? qty / ratePerDay : null;

    const priceRatio = sixMonthAvg ? price / sixMonthAvg : null;
    const velocity = classifyVelocity(soldByUs, daysOfCover, marketStrRatio);
    const pricePosition = classifyPosition(priceRatio);

    const lot: EnrichedLot = {
      itemNumber: raw.item_number,
      itemName: raw.item_name ?? raw.item_number,
      itemType: raw.item_type === 'Minifig' ? 'Minifig' : 'Part',
      colorId: raw.color_id,
      colorName: raw.color_name,
      condition,
      quantity: qty,
      bricqerPrice: price,
      storageLocation: raw.storage_location,
      listValue,
      sixMonthAvg,
      marketStrRatio,
      priceRatio,
      unitsSold,
      ordersWith,
      lastSoldDaysAgo,
      daysOfCover,
      velocity,
      pricePosition,
      flags: [],
    };
    lot.flags = computeFlags(lot, soldByUs);
    return lot;
  });

  return assembleResult(lots, sales.orderStats, {
    segment,
    windowDays,
    snapshotDate,
    snapshotAgeDays,
    stale,
    maxStaleDays,
  });
}

// ---------------------------------------------------------------------------
// Aggregation / scoring
// ---------------------------------------------------------------------------

function assembleResult(
  lots: EnrichedLot[],
  orderStats: OrderStat[],
  ctx: {
    segment: Segment;
    windowDays: number;
    snapshotDate: string | null;
    snapshotAgeDays: number | null;
    stale: boolean;
    maxStaleDays: number;
  }
): StoreQualityResult {
  const totalValue = sum(lots.map((l) => l.listValue));
  const totalLots = lots.length;
  const totalPieces = sum(lots.map((l) => l.quantity));

  // composition
  const composition: CompositionRow[] = (['Part', 'Minifig'] as const)
    .map((t) => {
      const g = lots.filter((l) => l.itemType === t);
      const v = sum(g.map((l) => l.listValue));
      return {
        label: t,
        lots: g.length,
        pieces: sum(g.map((l) => l.quantity)),
        value: round2(v),
        share: totalValue ? v / totalValue : 0,
      };
    })
    .filter((r) => r.lots > 0);

  // profiles
  const velocityProfile = profileBy(
    lots,
    (l) => l.velocity,
    ['MOVER', 'MARKET-ONLY', 'SLOW', 'OVERSTOCK', 'BLIND', 'DEAD'],
    totalValue
  );
  const pricePositionProfile = profileBy(
    lots,
    (l) => l.pricePosition,
    ['UNDER', 'KEEN', 'AT-MARKET', 'PREMIUM', 'OVER', 'UNKNOWN'],
    totalValue
  );

  // picking
  const subFloorLots = lots.filter((l) => l.bricqerPrice < SUB_FLOOR);
  const distinctLocations = new Set(lots.map((l) => l.storageLocation).filter(Boolean)).size;
  const grindOrders = orderStats.filter((o) => o.lots >= 10 && o.value < 10);
  const totalOrderLots = sum(orderStats.map((o) => o.lots));
  const grindOrderPickShare =
    totalOrderLots > 0 ? sum(grindOrders.map((o) => o.lots)) / totalOrderLots : null;

  const picking = {
    avgValuePerLot: totalLots ? round4(totalValue / totalLots) : 0,
    subFloorLotShare: totalLots ? subFloorLots.length / totalLots : 0,
    subFloorValueShare: totalValue ? sum(subFloorLots.map((l) => l.listValue)) / totalValue : 0,
    distinctLocations,
    lotsPerLocation: distinctLocations ? round2(totalLots / distinctLocations) : 0,
    grindOrderPickShare: grindOrderPickShare === null ? null : round4(grindOrderPickShare),
  };

  // coverage
  const priceCovValue = sum(lots.filter((l) => l.sixMonthAvg && l.sixMonthAvg > 0).map((l) => l.listValue));
  const velCovValue = sum(
    lots.filter((l) => l.unitsSold > 0 || l.marketStrRatio !== null).map((l) => l.listValue)
  );
  const priceCoverage = totalValue ? priceCovValue / totalValue : 0;
  const velocityCoverage = totalValue ? velCovValue / totalValue : 0;

  // ---- dimension scores ----
  const velocityScore = totalValue
    ? (100 * sum(lots.map((l) => l.listValue * VELOCITY_WEIGHT[l.velocity]))) / totalValue
    : 0;
  const marginScore = totalValue
    ? (100 * sum(lots.map((l) => l.listValue * POSITION_WEIGHT[l.pricePosition]))) / totalValue
    : 0;
  const pickScoreAvg = clamp(picking.avgValuePerLot / PICK_TARGET_AVG, 0, 1);
  const pickScoreFloor = 1 - picking.subFloorLotShare;
  const pickingScore = 100 * (0.5 * pickScoreAvg + 0.5 * pickScoreFloor);
  const deadOverstockValue = sum(
    lots.filter((l) => l.velocity === 'DEAD' || l.velocity === 'OVERSTOCK').map((l) => l.listValue)
  );
  const ageingScore = totalValue ? 100 * (1 - deadOverstockValue / totalValue) : 100;
  const coverageScore = 100 * Math.min(priceCoverage, velocityCoverage);
  const freshnessScore =
    ctx.snapshotAgeDays === null ? 50 : clamp(100 * (1 - (ctx.snapshotAgeDays - 7) / 38), 0, 100);

  const dimensions: DimensionScore[] = [
    {
      key: 'velocity',
      label: 'Velocity',
      weight: WEIGHTS.velocity,
      score: round1(velocityScore),
      detail: `value-weighted; MOVER ${pct(velocityProfile.find((p) => p.bucket === 'MOVER')?.valueShare)}`,
    },
    {
      key: 'picking',
      label: 'Picking efficiency',
      weight: WEIGHTS.picking,
      score: round1(pickingScore),
      detail: `avg £${picking.avgValuePerLot.toFixed(3)}/lot; ${pct(picking.subFloorLotShare)} lots <10p`,
    },
    {
      key: 'margin',
      label: 'Margin / price position',
      weight: WEIGHTS.margin,
      score: round1(marginScore),
      detail: `value-weighted price-vs-market`,
    },
    {
      key: 'ageing',
      label: 'Ageing / dead weight',
      weight: WEIGHTS.ageing,
      score: round1(ageingScore),
      detail: `${pct(totalValue ? deadOverstockValue / totalValue : 0)} value DEAD/OVERSTOCK`,
    },
    {
      key: 'coverage',
      label: 'Coverage (measurability)',
      weight: WEIGHTS.coverage,
      score: round1(coverageScore),
      detail: `price ${pct(priceCoverage)}, velocity ${pct(velocityCoverage)}`,
    },
    {
      key: 'freshness',
      label: 'Data freshness',
      weight: WEIGHTS.freshness,
      score: round1(freshnessScore),
      detail: ctx.snapshotAgeDays === null ? 'no snapshot date' : `snapshot ${ctx.snapshotAgeDays}d old`,
    },
  ];
  const compositeScore = round1(sum(dimensions.map((d) => d.weight * d.score)));

  // ---- action lists ----
  const FLAGS: LotFlag[] = [
    'STUCK-HIGH',
    'UNDER-PRICED',
    'OVERSTOCK',
    'DEAD',
    'LOW-YIELD-PICK',
    'BLIND-HIGH-VALUE',
  ];
  const actions = {} as Record<LotFlag, ActionItem[]>;
  for (const flag of FLAGS) {
    actions[flag] = lots
      .filter((l) => l.flags.includes(flag))
      .sort((a, b) => b.listValue - a.listValue)
      .map((l) => toAction(flag, l));
  }
  const blindHighValue = actions['BLIND-HIGH-VALUE'].slice();

  const summary: Record<string, number | string | null> = {
    segment: ctx.segment,
    snapshot_date: ctx.snapshotDate,
    snapshot_age_days: ctx.snapshotAgeDays,
    composite_score: compositeScore,
    velocity_score: round1(velocityScore),
    picking_score: round1(pickingScore),
    margin_score: round1(marginScore),
    ageing_score: round1(ageingScore),
    coverage_score: round1(coverageScore),
    freshness_score: round1(freshnessScore),
    total_lots: totalLots,
    total_pieces: totalPieces,
    total_value: round2(totalValue),
    avg_value_per_lot: picking.avgValuePerLot,
    sub_floor_lot_share: round4(picking.subFloorLotShare),
    price_coverage: round4(priceCoverage),
    velocity_coverage: round4(velocityCoverage),
    dead_overstock_value: round2(deadOverstockValue),
    blind_high_value_count: blindHighValue.length,
    stuck_high_count: actions['STUCK-HIGH'].length,
    under_priced_count: actions['UNDER-PRICED'].length,
  };

  return {
    generatedAt: new Date().toISOString(),
    snapshotDate: ctx.snapshotDate,
    snapshotAgeDays: ctx.snapshotAgeDays,
    stale: ctx.stale,
    segment: ctx.segment,
    windowDays: ctx.windowDays,
    totals: { lots: totalLots, pieces: totalPieces, value: round2(totalValue) },
    composition,
    compositeScore,
    dimensions,
    velocityProfile,
    pricePositionProfile,
    picking,
    coverage: { priceCoverage, velocityCoverage, blindHighValue },
    actions,
    summary,
  };
}

function toAction(flag: LotFlag, l: EnrichedLot): ActionItem {
  let note = '';
  switch (flag) {
    case 'STUCK-HIGH':
      note = `priced ${l.priceRatio?.toFixed(2)}× market, unsold in window`;
      break;
    case 'UNDER-PRICED':
      note = `priced ${l.priceRatio?.toFixed(2)}× market but sells (STR ${(l.marketStrRatio ?? 0).toFixed(2)})`;
      break;
    case 'OVERSTOCK':
      note = `${l.daysOfCover ? Math.round(l.daysOfCover) : '∞'}d of cover`;
      break;
    case 'DEAD':
      note = `no sales by us; market STR ${l.marketStrRatio === null ? 'n/a' : l.marketStrRatio.toFixed(2)}`;
      break;
    case 'LOW-YIELD-PICK':
      note = `${(l.bricqerPrice * 100).toFixed(1)}p mover — bundle to cut picks`;
      break;
    case 'BLIND-HIGH-VALUE':
      note = `£${l.listValue.toFixed(2)} unmeasured — enrich`;
      break;
  }
  return {
    flag,
    itemNumber: l.itemNumber,
    itemName: l.itemName,
    colorName: l.colorName,
    condition: l.condition,
    quantity: l.quantity,
    bricqerPrice: l.bricqerPrice,
    listValue: round2(l.listValue),
    sixMonthAvg: l.sixMonthAvg,
    priceRatio: l.priceRatio,
    marketStrRatio: l.marketStrRatio,
    note,
  };
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function profileBy<K extends string>(
  lots: EnrichedLot[],
  keyFn: (l: EnrichedLot) => K,
  order: K[],
  totalValue: number
): ProfileRow[] {
  const m = new Map<K, { lots: number; value: number }>();
  for (const l of lots) {
    const k = keyFn(l);
    const cur = m.get(k) ?? { lots: 0, value: 0 };
    cur.lots += 1;
    cur.value += l.listValue;
    m.set(k, cur);
  }
  return order
    .map((k) => {
      const c = m.get(k) ?? { lots: 0, value: 0 };
      return { bucket: k, lots: c.lots, value: round2(c.value), valueShare: totalValue ? c.value / totalValue : 0 };
    })
    .filter((r) => r.lots > 0);
}

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;
const round4 = (x: number) => Math.round(x * 10000) / 10000;
const pct = (x: number | undefined | null) => `${Math.round((x ?? 0) * 100)}%`;
