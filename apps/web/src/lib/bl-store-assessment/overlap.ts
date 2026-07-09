/**
 * Lot overlap against OUR OWN inventory — does buying this lot create a NEW unique
 * lot in our store, restock something we've sold out of, or just add depth?
 *
 * Sources (both cache tables, no live calls):
 *   - bricqer_inventory_snapshot: what we currently stock. color_id is the BRICQER
 *     colour scheme — normalised to BL via the colour map (the classic two-scheme
 *     join gotcha from store-quality).
 *   - platform_orders/order_items (BL+BO, trailing window): what we've SOLD. Order
 *     items carry colour NAME only (no id), so the sales key is name-based.
 *
 * Tags (parts/minifigs only — sets don't live in Bricqer, they get null):
 *   NEW          not stocked, never sold by us in the window → widens the catalogue
 *   RESTOCK_OUT  not stocked now, but we sold it → proven demand, we're out
 *   RESTOCK_THIN stocked, but below ~2 months of our own sell rate
 *   DUPLICATE    stocked with adequate depth — adds little
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadColourMap } from '../bricklink/colour-map';
import type { ItemTypeCode, Condition } from './types';

export type OverlapTag = 'NEW' | 'RESTOCK_OUT' | 'RESTOCK_THIN' | 'DUPLICATE';

/** Months of our own sell-rate cover below which stocked lots count as thin. */
export const THIN_COVER_MONTHS = 2;

export interface OwnStockIndex {
  /** bricqer_snapshot_meta.last_full_sync — surface staleness, don't hide it. */
  snapshotAt: string | null;
  salesWindowDays: number;
  /** `${P|M}:${itemNo}:${blColourId}:${N|U}` → our current qty. */
  stockQty: Map<string, number>;
  /** `${P|M}:${itemNo}:${colour name, lowercased}:${N|U}` → units we sold in the window. */
  soldUnits: Map<string, number>;
}

const normColour = (name: string | null | undefined): string => (name ?? '').toLowerCase().trim();
const normCond = (c: string | null | undefined): Condition => (c === 'New' || c === 'N' ? 'N' : 'U');

const stockKey = (t: ItemTypeCode, no: string, blColour: number, cond: Condition) => `${t}:${no}:${blColour}:${cond}`;
const salesKey = (t: ItemTypeCode, no: string, colourName: string | null, cond: Condition) => `${t}:${no}:${normColour(colourName)}:${cond}`;

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

interface SnapshotRow { item_number: string; item_type: string; color_id: number | null; condition: string | null; quantity: number | null }
interface OrderRow { id: string; order_items: Array<{ item_number: string; color_name: string | null; condition: string | null; item_type: string | null; quantity: number | null }> | null }

/** Build the overlap index from our snapshot + realized sales. One read each, paginated. */
export async function loadOwnStockIndex(
  supabase: SupabaseClient,
  userId: string,
  opts: { salesWindowDays?: number } = {},
): Promise<OwnStockIndex> {
  const salesWindowDays = opts.salesWindowDays ?? 180;
  const cutoff = new Date(Date.now() - salesWindowDays * 86400000).toISOString();

  const [rows, metaRes, cmap, orders] = await Promise.all([
    fetchAllRange<SnapshotRow>((from, to) =>
      supabase
        .from('bricqer_inventory_snapshot')
        .select('item_number,item_type,color_id,condition,quantity')
        .eq('user_id', userId)
        .in('item_type', ['Part', 'Minifig'])
        .gt('quantity', 0)
        .order('bricqer_item_id', { ascending: true })
        .range(from, to)
    ),
    supabase.from('bricqer_snapshot_meta').select('last_full_sync').eq('user_id', userId).maybeSingle(),
    loadColourMap(supabase),
    fetchAllRange<OrderRow>((from, to) =>
      supabase
        .from('platform_orders')
        .select('id,order_items(item_number,color_name,condition,item_type,quantity)')
        .eq('user_id', userId)
        .in('platform', ['bricklink', 'brickowl'])
        .gte('order_date', cutoff)
        .order('id', { ascending: true })
        .range(from, to)
    ),
  ]);

  const stockQty = new Map<string, number>();
  for (const r of rows) {
    const t: ItemTypeCode = r.item_type === 'Part' ? 'P' : 'M';
    const blColour = t === 'P' ? cmap.toBl(r.color_id ?? 0, 'bricqer') : 0;
    const k = stockKey(t, r.item_number, blColour, normCond(r.condition));
    stockQty.set(k, (stockQty.get(k) ?? 0) + (r.quantity ?? 0));
  }

  const soldUnits = new Map<string, number>();
  for (const o of orders) {
    for (const it of o.order_items ?? []) {
      const type = (it.item_type ?? '').toUpperCase();
      const t: ItemTypeCode | null = type === 'PART' ? 'P' : type === 'MINIFIG' || type === 'MINIFIGURE' ? 'M' : null;
      if (!t) continue;
      const k = salesKey(t, it.item_number, it.color_name, normCond(it.condition));
      soldUnits.set(k, (soldUnits.get(k) ?? 0) + (it.quantity ?? 0));
    }
  }

  return { snapshotAt: metaRes.data?.last_full_sync ?? null, salesWindowDays, stockQty, soldUnits };
}

export interface OverlapResult {
  tag: OverlapTag | null; // null = not applicable (sets) or no index
  ourQty: number | null;
  ourSoldWindow: number | null;
}

/** Classify one lot against our stock + sales. Sets always get null (not Bricqer-held). */
export function classifyOverlap(
  lot: { itemType: ItemTypeCode; itemNo: string; blColourId: number; colourName: string | null; condition: Condition },
  index: OwnStockIndex | null | undefined,
): OverlapResult {
  if (!index || lot.itemType === 'S') return { tag: null, ourQty: null, ourSoldWindow: null };
  const qty = index.stockQty.get(stockKey(lot.itemType, lot.itemNo, lot.blColourId, lot.condition)) ?? 0;
  const sold = index.soldUnits.get(salesKey(lot.itemType, lot.itemNo, lot.colourName, lot.condition)) ?? 0;
  if (qty > 0) {
    const monthlyRate = sold / (index.salesWindowDays / 30);
    const thin = monthlyRate > 0 && qty < THIN_COVER_MONTHS * monthlyRate;
    return { tag: thin ? 'RESTOCK_THIN' : 'DUPLICATE', ourQty: qty, ourSoldWindow: sold };
  }
  return { tag: sold > 0 ? 'RESTOCK_OUT' : 'NEW', ourQty: 0, ourSoldWindow: sold };
}
