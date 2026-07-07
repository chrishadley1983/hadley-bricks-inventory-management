/**
 * Cache service for catalogPG page-scrape results.
 *
 * Two-layer save:
 *  1. `bricklink_price_guide_cache` — system of record for the rich page data
 *     (median, monthly velocity, worldwide context). One row per (item_type, item_no,
 *     colour_id); one scraped page fills exactly one row (both conditions × sold+stock).
 *  2. Write-through to `bricklink_part_price_cache` (parts + minifigs) using its existing
 *     semantics — price_* = UK sold avg, times_sold_* = UK sold TOTAL QTY (not lots; that's
 *     what bl-basket wrote from the API), stock_available_* = UK stock qty — so bl-basket,
 *     the stale-pricing screener and store-quality benefit with zero code changes.
 *
 * Reads paginate explicitly (Supabase caps responses at 1,000 rows — the same trap that
 * bit bl-basket's cache reads; see that script's enrichWithPrices comment).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  recentMonthsQty,
  type PgItemRef,
  type PgItemType,
  type PgScrapeResult,
} from './price-guide-page';

export interface PgCacheRow {
  item_type: PgItemType;
  item_no: string;
  colour_id: number;
  item_name: string | null;
  uk_sold_avg_new: number | null;
  uk_sold_avg_used: number | null;
  uk_sold_qty_avg_new: number | null;
  uk_sold_qty_avg_used: number | null;
  uk_sold_median_new: number | null;
  uk_sold_median_used: number | null;
  uk_sold_lots_new: number;
  uk_sold_lots_used: number;
  uk_sold_qty_new: number;
  uk_sold_qty_used: number;
  uk_sold_last2mo_qty_new: number;
  uk_sold_last2mo_qty_used: number;
  uk_stock_qty_new: number;
  uk_stock_qty_used: number;
  uk_stock_lots_new: number;
  uk_stock_lots_used: number;
  uk_stock_min_new: number | null;
  uk_stock_min_used: number | null;
  uk_detail: unknown;
  world_detail: unknown;
  parse_version: number;
  fetched_at: string;
}

export const PG_PARSE_VERSION = 1;

export function pgCacheKey(item: { itemType: PgItemType; itemNo: string; colourId: number }): string {
  return `${item.itemType}:${item.itemNo}:${item.colourId}`;
}

/** Map one scrape result to its cache row. Exported for unit testing. */
export function toPgCacheRow(r: PgScrapeResult): PgCacheRow {
  const { uk, world } = r;
  return {
    item_type: r.item.itemType,
    item_no: r.item.itemNo,
    colour_id: r.item.itemType === 'P' ? r.item.colourId : 0,
    item_name: r.itemName,
    uk_sold_avg_new: uk.soldNew.avg,
    uk_sold_avg_used: uk.soldUsed.avg,
    uk_sold_qty_avg_new: uk.soldNew.qtyAvg,
    uk_sold_qty_avg_used: uk.soldUsed.qtyAvg,
    uk_sold_median_new: uk.soldNew.median,
    uk_sold_median_used: uk.soldUsed.median,
    uk_sold_lots_new: uk.soldNew.lots,
    uk_sold_lots_used: uk.soldUsed.lots,
    uk_sold_qty_new: uk.soldNew.qty,
    uk_sold_qty_used: uk.soldUsed.qty,
    uk_sold_last2mo_qty_new: recentMonthsQty(uk.soldNew, 2),
    uk_sold_last2mo_qty_used: recentMonthsQty(uk.soldUsed, 2),
    uk_stock_qty_new: uk.stockNew.qty,
    uk_stock_qty_used: uk.stockUsed.qty,
    uk_stock_lots_new: uk.stockNew.lots,
    uk_stock_lots_used: uk.stockUsed.lots,
    uk_stock_min_new: uk.stockNew.min,
    uk_stock_min_used: uk.stockUsed.min,
    uk_detail: {
      soldNew: { min: uk.soldNew.min, max: uk.soldNew.max, byMonth: uk.soldNew.byMonth },
      soldUsed: { min: uk.soldUsed.min, max: uk.soldUsed.max, byMonth: uk.soldUsed.byMonth },
      stockNew: { min: uk.stockNew.min, max: uk.stockNew.max },
      stockUsed: { min: uk.stockUsed.min, max: uk.stockUsed.max },
    },
    world_detail: {
      soldNew: { lots: world.soldNew.lots, qty: world.soldNew.qty, avg: world.soldNew.avg, median: world.soldNew.median },
      soldUsed: { lots: world.soldUsed.lots, qty: world.soldUsed.qty, avg: world.soldUsed.avg, median: world.soldUsed.median },
      stockNew: { lots: world.stockNew.lots, qty: world.stockNew.qty, avg: world.stockNew.avg },
      stockUsed: { lots: world.stockUsed.lots, qty: world.stockUsed.qty, avg: world.stockUsed.avg },
    },
    parse_version: PG_PARSE_VERSION,
    fetched_at: r.scrapedAt,
  };
}

export class PriceGuideCacheService {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Fetch fresh cache rows for the given items. Returns a Map keyed by pgCacheKey.
   * Stale rows (older than ttlDays) are omitted so callers re-scrape them.
   */
  async getFresh(items: PgItemRef[], ttlDays: number): Promise<Map<string, PgCacheRow>> {
    const out = new Map<string, PgCacheRow>();
    if (items.length === 0) return out;
    const cutoff = Date.now() - ttlDays * 24 * 60 * 60 * 1000;
    const itemNos = [...new Set(items.map((i) => i.itemNo))];
    const wanted = new Set(items.map((i) => pgCacheKey({ ...i, colourId: i.itemType === 'P' ? i.colourId : 0 })));
    const CHUNK = 400;
    const PAGE = 1000;
    for (let i = 0; i < itemNos.length; i += CHUNK) {
      const chunk = itemNos.slice(i, i + CHUNK);
      let pageStart = 0;
      for (;;) {
        const { data, error } = await this.supabase
          .from('bricklink_price_guide_cache')
          .select('*')
          .in('item_no', chunk)
          .range(pageStart, pageStart + PAGE - 1);
        if (error) throw new Error(`pg cache read failed: ${error.message}`);
        const rows = (data ?? []) as PgCacheRow[];
        for (const row of rows) {
          if (new Date(row.fetched_at).getTime() < cutoff) continue;
          const key = pgCacheKey({ itemType: row.item_type, itemNo: row.item_no, colourId: row.colour_id });
          if (wanted.has(key)) out.set(key, row);
        }
        if (rows.length < PAGE) break;
        pageStart += PAGE;
      }
    }
    return out;
  }

  /** Upsert scrape results into the rich cache. */
  async upsert(results: PgScrapeResult[]): Promise<void> {
    if (results.length === 0) return;
    const rows = results.map(toPgCacheRow).map((r) => ({ ...r, updated_at: new Date().toISOString() }));
    const CHUNK = 100;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await this.supabase
        .from('bricklink_price_guide_cache')
        .upsert(rows.slice(i, i + CHUNK), { onConflict: 'item_type,item_no,colour_id' });
      if (error) throw new Error(`pg cache upsert failed: ${error.message}`);
    }
  }

  /**
   * Write-through to the legacy part-price cache (parts + minifigs only — that table has
   * no set rows). Preserves that table's semantics exactly as bl-basket writes them from
   * the API: null price + 0 sold is the honoured "no UK sales" sentinel.
   */
  async writeThroughPartPriceCache(results: PgScrapeResult[]): Promise<number> {
    const pm = results.filter((r) => r.item.itemType === 'P' || r.item.itemType === 'M');
    if (pm.length === 0) return 0;
    const now = new Date().toISOString();
    const rows = pm.map((r) => ({
      part_number: r.item.itemNo,
      part_type: r.item.itemType === 'P' ? 'PART' : 'MINIFIG',
      colour_id: r.item.itemType === 'P' ? r.item.colourId : 0,
      price_new: r.uk.soldNew.avg,
      price_used: r.uk.soldUsed.avg,
      stock_available_new: r.uk.stockNew.qty,
      stock_available_used: r.uk.stockUsed.qty,
      times_sold_new: r.uk.soldNew.qty,
      times_sold_used: r.uk.soldUsed.qty,
      fetched_at: now,
      updated_at: now,
    }));
    const CHUNK = 100;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await this.supabase
        .from('bricklink_part_price_cache')
        .upsert(rows.slice(i, i + CHUNK), { onConflict: 'part_number,colour_id', ignoreDuplicates: false });
      if (error) throw new Error(`part price cache write-through failed: ${error.message}`);
    }
    return rows.length;
  }
}
