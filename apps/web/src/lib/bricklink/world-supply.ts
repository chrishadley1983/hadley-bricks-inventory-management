/**
 * Worldwide seller supply (from `bricklink_pg_summary_cache`) — the scarcity input
 * to magnet detection.
 *
 * Extracted from bl-store-assessment/engine.ts so the set-lookup Partout tab reads
 * supply through the SAME query as the store assessment rather than a second copy.
 * BL supply is inherently worldwide; the UK price guide has no supply equivalent,
 * which is why the magnet test is defined against this and not against UK lots.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { pgKey } from './price-guide/read';

export interface WorldSupply {
  stockLotsNew: number | null;
  stockLotsUsed: number | null;
  demandRank: number | null;
}

export interface WorldSupplyRef {
  itemType: string;
  itemNo: string;
  blColourId: number;
}

const COLS = 'item_type,item_no,colour_id,stock_new_lots,stock_used_lots,demand_rank';

/**
 * Read worldwide supply for a set of catalogue refs, keyed by `pgKey`.
 *
 * Batched by item number (300 at a time) and paginated within each batch — the
 * 1,000-row Supabase cap silently truncates otherwise, which would read as
 * "no supply data" and quietly suppress every magnet in the batch.
 */
export async function readWorldSupply(
  supabase: SupabaseClient,
  refs: WorldSupplyRef[]
): Promise<Map<string, WorldSupply>> {
  const out = new Map<string, WorldSupply>();
  const itemNos = [...new Set(refs.map((r) => r.itemNo))];
  if (itemNos.length === 0) return out;

  for (let i = 0; i < itemNos.length; i += 300) {
    const batch = itemNos.slice(i, i + 300);
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('bricklink_pg_summary_cache')
        .select(COLS)
        .in('item_no', batch)
        .order('id')
        .range(from, from + 999);
      if (error) throw new Error(`readWorldSupply failed: ${error.message}`);
      for (const r of (data ?? []) as Record<string, unknown>[]) {
        out.set(pgKey(String(r.item_type), String(r.item_no), Number(r.colour_id)), {
          stockLotsNew: r.stock_new_lots == null ? null : Number(r.stock_new_lots),
          stockLotsUsed: r.stock_used_lots == null ? null : Number(r.stock_used_lots),
          demandRank: r.demand_rank == null ? null : Number(r.demand_rank),
        });
      }
      if (!data || data.length < 1000) break;
      from += 1000;
    }
  }
  return out;
}
