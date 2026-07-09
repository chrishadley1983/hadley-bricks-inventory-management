/**
 * Cache service for catalogPG page-scrape results.
 *
 * `bricklink_price_guide_cache` is the system of record for the rich page data
 * (median, monthly velocity, worldwide context). One row per (item_type, item_no,
 * colour_id); one scraped page fills exactly one row (both conditions × sold+stock).
 * This `upsert` is the single physical write path — `capturePriceGuide` (the common
 * write function in price-guide/capture.ts) delegates here. The legacy
 * `bricklink_part_price_cache` write-through was retired with the unified-price-cache
 * cutover; all consumers read via `readPriceGuide`.
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

// v3 (2026-07-08): per-quadrant sold/stock price histograms added to uk_detail/world_detail
// (soldNew.hist, soldUsed.hist, stockNew.hist, stockUsed.hist) — enables qtyShareAtOrAbove
// price-conditional STR. Rows written under v2 have no `hist` key on the detail objects;
// readers must treat it as optional (qtyShareAtOrAbove returns null for absent/empty hist).
// v2 (2026-07-07): true median on even counts; item_name from title; noData size guard.
export const PG_PARSE_VERSION = 3;

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
      soldNew: { min: uk.soldNew.min, max: uk.soldNew.max, byMonth: uk.soldNew.byMonth, hist: uk.soldNew.hist },
      soldUsed: { min: uk.soldUsed.min, max: uk.soldUsed.max, byMonth: uk.soldUsed.byMonth, hist: uk.soldUsed.hist },
      stockNew: { min: uk.stockNew.min, max: uk.stockNew.max, hist: uk.stockNew.hist },
      stockUsed: { min: uk.stockUsed.min, max: uk.stockUsed.max, hist: uk.stockUsed.hist },
    },
    world_detail: {
      soldNew: { lots: world.soldNew.lots, qty: world.soldNew.qty, avg: world.soldNew.avg, median: world.soldNew.median, hist: world.soldNew.hist },
      soldUsed: { lots: world.soldUsed.lots, qty: world.soldUsed.qty, avg: world.soldUsed.avg, median: world.soldUsed.median, hist: world.soldUsed.hist },
      stockNew: { lots: world.stockNew.lots, qty: world.stockNew.qty, avg: world.stockNew.avg, hist: world.stockNew.hist },
      stockUsed: { lots: world.stockUsed.lots, qty: world.stockUsed.qty, avg: world.stockUsed.avg, hist: world.stockUsed.hist },
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

}
