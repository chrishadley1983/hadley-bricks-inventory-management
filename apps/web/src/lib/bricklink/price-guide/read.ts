/**
 * readPriceGuide — the single consumption path for UK price data (unified-price-cache F5).
 *
 * One STR source of truth: strLots (house def = sold_lots/stock_lots) and strQty
 * (Bricqer pricing input = sold_qty/stock_qty) are computed here from the rich columns; no
 * consumer computes STR by hand again. Colour ids are accepted in either scheme (normalised to
 * canonical BL id via colour-map). Missing UK rows fall back to the worldwide pg_summary layer,
 * flagged in `coverage`, so consumers always get a usable number with honest provenance.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { qtyShareAtOrAbove } from '../price-guide-page';
import { loadColourMap, type ColourScheme } from '../colour-map';

export type PgType = 'P' | 'M' | 'S';
export interface ItemRef {
  itemType: PgType;
  itemNo: string;
  colourId: number;
  scheme?: ColourScheme; // default 'bl'
}

export interface SideView {
  soldAvg: number | null;
  soldMedian: number | null;
  soldQtyAvg: number | null;
  soldLots: number;
  soldQty: number;
  soldLast2moQty: number;
  stockLots: number;
  stockQty: number;
  stockMin: number | null;
  /** Highest asking price, from the stock detail blob (null pre-v2 rows). */
  stockMax: number | null;
  /** Qty-weighted average asking price, derived from the stock histogram (null pre-v3 rows). */
  stockAvg: number | null;
  strLots: number | null; // sold_lots / stock_lots
  strQty: number | null; // sold_qty / stock_qty
  hist: Record<string, number> | undefined; // sold-side qty histogram (price 4dp -> qty)
}

export type Coverage = 'uk' | 'world_fallback' | 'none';

export interface PriceGuideView {
  item: { itemType: PgType; itemNo: string; blColourId: number };
  itemName: string | null;
  used: SideView;
  new: SideView;
  freshnessDays: number | null;
  coverage: Coverage;
  /** Share of sold qty at or above `price`, for the condition. Null if no histogram. */
  qtyShareAtOrAbove(condition: 'U' | 'N', price: number): number | null;
}

type Row = Record<string, unknown>;
const str = (sold: number, stock: number): number | null => (stock > 0 ? sold / stock : null);
const iNum = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const nOrNull = (v: unknown): number | null => (v == null ? null : (Number(v) as number));
export function pgKey(itemType: string, itemNo: string, blColourId: number): string {
  return `${itemType}:${itemNo}:${blColourId}`;
}

const EMPTY_SIDE: SideView = {
  soldAvg: null, soldMedian: null, soldQtyAvg: null, soldLots: 0, soldQty: 0, soldLast2moQty: 0,
  stockLots: 0, stockQty: 0, stockMin: null, stockMax: null, stockAvg: null, strLots: null, strQty: null, hist: undefined,
};

/** Qty-weighted mean of a price(4dp)->qty histogram; ignores the rolled-up "other" bucket. */
function histAvg(hist: Record<string, number> | undefined): number | null {
  if (!hist) return null;
  let qty = 0;
  let sum = 0;
  for (const [price, q] of Object.entries(hist)) {
    const p = Number(price);
    if (!Number.isFinite(p) || !q) continue;
    qty += q;
    sum += p * q;
  }
  return qty > 0 ? sum / qty : null;
}

function ukSide(row: Row, cond: 'new' | 'used'): SideView {
  const soldLots = iNum(row[`uk_sold_lots_${cond}`]);
  const soldQty = iNum(row[`uk_sold_qty_${cond}`]);
  const stockLots = iNum(row[`uk_stock_lots_${cond}`]);
  const stockQty = iNum(row[`uk_stock_qty_${cond}`]);
  const detail = (row.uk_detail ?? {}) as Record<string, { min?: number | null; max?: number | null; hist?: Record<string, number> }>;
  const histKey = cond === 'new' ? 'soldNew' : 'soldUsed';
  const stockHistKey = cond === 'new' ? 'stockNew' : 'stockUsed';
  return {
    soldAvg: nOrNull(row[`uk_sold_avg_${cond}`]),
    soldMedian: nOrNull(row[`uk_sold_median_${cond}`]),
    soldQtyAvg: nOrNull(row[`uk_sold_qty_avg_${cond}`]),
    soldLots, soldQty,
    soldLast2moQty: iNum(row[`uk_sold_last2mo_qty_${cond}`]),
    stockLots, stockQty,
    stockMin: nOrNull(row[`uk_stock_min_${cond}`]),
    stockMax: nOrNull(detail?.[stockHistKey]?.max),
    stockAvg: histAvg(detail?.[stockHistKey]?.hist),
    strLots: str(soldLots, stockLots),
    strQty: str(soldQty, stockQty),
    hist: detail?.[histKey]?.hist,
  };
}

function worldSide(row: Row, cond: 'new' | 'used'): SideView {
  const soldLots = iNum(row[`sold6m_${cond}_lots`]);
  const soldQty = iNum(row[`sold6m_${cond}_qty`]);
  const stockLots = iNum(row[`stock_${cond}_lots`]);
  const stockQty = iNum(row[`stock_${cond}_qty`]);
  return {
    ...EMPTY_SIDE,
    soldAvg: nOrNull(row[`sold6m_${cond}_avg`]),
    soldQtyAvg: nOrNull(row[`sold6m_${cond}_qavg`]),
    soldLots, soldQty, stockLots, stockQty,
    stockAvg: null,
    strLots: str(soldLots, stockLots),
    strQty: str(soldQty, stockQty),
  };
}

function makeView(
  item: { itemType: PgType; itemNo: string; blColourId: number },
  itemName: string | null,
  used: SideView, neu: SideView,
  freshnessDays: number | null, coverage: Coverage
): PriceGuideView {
  return {
    item, itemName, used, new: neu, freshnessDays, coverage,
    qtyShareAtOrAbove(condition, price) {
      const side = condition === 'U' ? used : neu;
      return qtyShareAtOrAbove(side.hist, price);
    },
  };
}

export interface ReadOpts {
  ttlDays?: number; // if set, UK rows older than this are treated as missing (world fallback / none)
  allowWorldFallback?: boolean; // default true
}

/** Read normalised price views for a set of items. Colour ids normalised to BL. */
export async function readPriceGuide(
  supabase: SupabaseClient,
  items: ItemRef[],
  opts: ReadOpts = {}
): Promise<Map<string, PriceGuideView>> {
  const allowWorld = opts.allowWorldFallback ?? true;
  const out = new Map<string, PriceGuideView>();
  if (items.length === 0) return out;
  const cmap = await loadColourMap(supabase);

  // normalise -> BL, dedupe
  const norm = items.map((i) => ({
    itemType: i.itemType,
    itemNo: i.itemNo,
    blColourId: i.itemType === 'P' ? cmap.toBl(i.colourId, i.scheme ?? 'bl') : 0,
  }));
  const itemNos = [...new Set(norm.map((n) => n.itemNo))];

  // 1. UK rows from price_guide_cache
  const ukRows = new Map<string, Row>();
  const COLS = 'item_type,item_no,colour_id,item_name,fetched_at,uk_detail,' +
    ['new', 'used'].flatMap((c) => [
      `uk_sold_avg_${c}`, `uk_sold_qty_avg_${c}`, `uk_sold_median_${c}`, `uk_sold_lots_${c}`,
      `uk_sold_qty_${c}`, `uk_sold_last2mo_qty_${c}`, `uk_stock_qty_${c}`, `uk_stock_lots_${c}`, `uk_stock_min_${c}`,
    ]).join(',');
  for (let i = 0; i < itemNos.length; i += 300) {
    const batch = itemNos.slice(i, i + 300);
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('bricklink_price_guide_cache')
        .select(COLS)
        .in('item_no', batch)
        .order('id')
        .range(from, from + 999);
      if (error) throw new Error(`readPriceGuide UK read failed: ${error.message}`);
      for (const r of (data ?? []) as unknown as Row[]) ukRows.set(pgKey(String(r.item_type), String(r.item_no), Number(r.colour_id)), r);
      if (!data || data.length < 1000) break;
      from += 1000;
    }
  }

  const now = Date.now();
  const missing: typeof norm = [];
  for (const n of norm) {
    const key = pgKey(n.itemType, n.itemNo, n.blColourId);
    if (out.has(key)) continue;
    const row = ukRows.get(key);
    const ageDays = row ? (now - new Date(String(row.fetched_at)).getTime()) / 86400000 : null;
    const stale = opts.ttlDays != null && ageDays != null && ageDays > opts.ttlDays;
    if (row && !stale) {
      out.set(key, makeView(n, (row.item_name as string | null) ?? null, ukSide(row, 'used'), ukSide(row, 'new'), ageDays, 'uk'));
    } else {
      missing.push(n);
    }
  }

  // 2. world fallback from pg_summary
  if (allowWorld && missing.length) {
    const missNos = [...new Set(missing.map((m) => m.itemNo))];
    const worldRows = new Map<string, Row>();
    const WCOLS = 'item_type,item_no,colour_id,sold6m_new_avg,sold6m_used_avg,sold6m_new_qavg,sold6m_used_qavg,' +
      'sold6m_new_lots,sold6m_used_lots,sold6m_new_qty,sold6m_used_qty,stock_new_lots,stock_used_lots,stock_new_qty,stock_used_qty';
    for (let i = 0; i < missNos.length; i += 300) {
      const batch = missNos.slice(i, i + 300);
      let from = 0;
      for (;;) {
        const { data, error } = await supabase
          .from('bricklink_pg_summary_cache')
          .select(WCOLS)
          .in('item_no', batch)
          .order('id')
          .range(from, from + 999);
        if (error) throw new Error(`readPriceGuide world read failed: ${error.message}`);
        for (const r of (data ?? []) as unknown as Row[]) worldRows.set(pgKey(String(r.item_type), String(r.item_no), Number(r.colour_id)), r);
        if (!data || data.length < 1000) break;
        from += 1000;
      }
    }
    for (const n of missing) {
      const key = pgKey(n.itemType, n.itemNo, n.blColourId);
      if (out.has(key)) continue;
      const row = worldRows.get(key);
      if (row) out.set(key, makeView(n, null, worldSide(row, 'used'), worldSide(row, 'new'), null, 'world_fallback'));
    }
  }

  // 3. anything still absent -> coverage:'none'
  for (const n of norm) {
    const key = pgKey(n.itemType, n.itemNo, n.blColourId);
    if (!out.has(key)) out.set(key, makeView(n, null, { ...EMPTY_SIDE }, { ...EMPTY_SIDE }, null, 'none'));
  }
  return out;
}
