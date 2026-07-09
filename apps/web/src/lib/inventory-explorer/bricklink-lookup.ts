/**
 * Helper to look up BrickLink price data for snapshot items.
 * Shared between overview, items and sync-status API routes.
 *
 * Reads via the unified price cache (`readPriceGuide`) — snapshot colour ids are
 * Bricqer-scheme and are normalised to BL ids internally; the returned map is
 * keyed by the CALLER's scheme (`itemNumber|bricqerColourId`) so route keying
 * is unchanged. STR here is the house sold/stock ratio ×100 (can exceed 100).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { readPriceGuide, pgKey, type ItemRef, type PgType, type Coverage } from '@/lib/bricklink/price-guide/read';
import { loadColourMap } from '@/lib/bricklink/colour-map';

export interface BLCacheEntry {
  partNumber: string;
  colourId: number;
  priceNew: number | null;
  priceUsed: number | null;
  strNew: number | null;
  strUsed: number | null;
  stockNew: number | null;
  stockUsed: number | null;
  soldNew: number | null;
  soldUsed: number | null;
  coverage: Coverage;
  freshnessDays: number | null;
}

export interface BLLookupRef {
  itemNumber: string;
  /** Bricqer-scheme colour id from the snapshot (null = not colour-keyed). */
  colorId: number | null;
  /** Explorer item type: 'Part' | 'Set' | 'Minifig'. Defaults to Part. */
  itemType?: string;
}

function toPgType(itemType: string | undefined): PgType {
  if (itemType === 'Set') return 'S';
  if (itemType === 'Minifig') return 'M';
  return 'P';
}

/**
 * Fetch price views for a list of snapshot lots.
 * Returns a Map keyed by "itemNumber|bricqerColourId" ('' when colorId is null).
 */
export async function fetchBLCache(
  supabase: SupabaseClient<Database>,
  refs: BLLookupRef[],
  opts: { ttlDays?: number; allowWorldFallback?: boolean } = {}
): Promise<Map<string, BLCacheEntry>> {
  const map = new Map<string, BLCacheEntry>();
  if (refs.length === 0) return map;

  const cmap = await loadColourMap(supabase);

  // Dedupe on the caller's key; remember one representative ref per key
  const byCallerKey = new Map<string, BLLookupRef>();
  for (const r of refs) {
    const key = `${r.itemNumber}|${r.colorId ?? ''}`;
    if (!byCallerKey.has(key)) byCallerKey.set(key, r);
  }

  const items: ItemRef[] = [...byCallerKey.values()].map((r) => ({
    itemType: toPgType(r.itemType),
    itemNo: r.itemNumber,
    colourId: r.colorId ?? 0,
    scheme: 'bricqer' as const,
  }));

  const views = await readPriceGuide(supabase, items, {
    ttlDays: opts.ttlDays,
    allowWorldFallback: opts.allowWorldFallback ?? true,
  });

  for (const [callerKey, r] of byCallerKey) {
    const itemType = toPgType(r.itemType);
    const blColourId = itemType === 'P' ? cmap.toBl(r.colorId ?? 0, 'bricqer') : 0;
    const view = views.get(pgKey(itemType, r.itemNumber, blColourId));
    if (!view || view.coverage === 'none') continue;

    map.set(callerKey, {
      partNumber: r.itemNumber,
      colourId: r.colorId ?? 0,
      priceNew: view.new.soldAvg,
      priceUsed: view.used.soldAvg,
      strNew: view.new.strQty === null ? null : view.new.strQty * 100,
      strUsed: view.used.strQty === null ? null : view.used.strQty * 100,
      stockNew: view.new.stockQty,
      stockUsed: view.used.stockQty,
      soldNew: view.new.soldQty,
      soldUsed: view.used.soldQty,
      coverage: view.coverage,
      freshnessDays: view.freshnessDays,
    });
  }

  return map;
}

/**
 * Get STR for a lot based on its condition and BL cache entry.
 */
export function getSTR(condition: string, entry: BLCacheEntry | undefined): number | null {
  if (!entry) return null;
  return condition === 'New' ? entry.strNew : entry.strUsed;
}

/**
 * Get sold count for a lot based on its condition.
 */
export function getSold(condition: string, entry: BLCacheEntry | undefined): number | null {
  if (!entry) return null;
  return condition === 'New' ? entry.soldNew : entry.soldUsed;
}

/**
 * Get for-sale count for a lot based on its condition.
 */
export function getForSale(condition: string, entry: BLCacheEntry | undefined): number | null {
  if (!entry) return null;
  return condition === 'New' ? entry.stockNew : entry.stockUsed;
}

/**
 * Get BL average price for a lot based on its condition.
 */
export function getBLAvg(condition: string, entry: BLCacheEntry | undefined): number | null {
  if (!entry) return null;
  return condition === 'New' ? entry.priceNew : entry.priceUsed;
}
