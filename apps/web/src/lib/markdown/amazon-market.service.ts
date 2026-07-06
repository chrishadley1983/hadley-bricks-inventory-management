/**
 * Amazon market-context builder for the markdown sweep.
 *
 * Reads the daily amazon_arbitrage_pricing snapshots (properly paginated —
 * the table holds one row per ASIN per day, ~100+ rows each) and condenses
 * them into the stable, blip-resistant references the pricing engine needs:
 *
 *  - stableBuyBox:    median buy-box price over the trailing reference window
 *  - persistence:     fraction of recent snapshots where the box sat below us
 *  - latest position: buy_box_is_yours / offer counts / sales rank
 *  - Keepa cross-refs: was_price_180d / was_price_90d / sales_rank_drops_90d
 *  - anchorPrice:     highest historical your_price (decay bound)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { fetchAllRecords } from '@/lib/supabase/pagination';
import type { AmazonMarketContext } from '@/lib/pricing/engine';
import type { MarkdownConfig } from './types';

interface SnapshotRow {
  asin: string;
  snapshot_date: string;
  buy_box_price: number | null;
  buy_box_is_yours: boolean | null;
  total_offer_count: number | null;
  offer_count: number | null;
  sales_rank: number | null;
  sales_rank_drops_90d: number | null;
  was_price_90d: number | null;
  was_price_180d: number | null;
  your_price: number | null;
}

const ASIN_BATCH = 100;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Latest non-null value walking snapshots newest-first. */
function latestNonNull<T>(rows: SnapshotRow[], pick: (r: SnapshotRow) => T | null): T | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = pick(rows[i]);
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

/**
 * Build per-ASIN market contexts for the given ASINs.
 *
 * @param currentPriceByAsin fallback "our price" per ASIN (listing_value) for
 *   persistence comparison on snapshots that lack your_price.
 */
export async function buildAmazonMarketContexts(
  supabase: SupabaseClient<Database>,
  userId: string,
  asins: string[],
  config: MarkdownConfig,
  currentPriceByAsin: Map<string, number>
): Promise<Map<string, AmazonMarketContext>> {
  const contexts = new Map<string, AmazonMarketContext>();
  if (asins.length === 0) return contexts;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - config.amazon_reference_window_days);
  const cutoffISO = cutoff.toISOString().split('T')[0];

  const persistenceCutoff = new Date();
  persistenceCutoff.setDate(persistenceCutoff.getDate() - config.amazon_persistence_window_days);
  const persistenceCutoffISO = persistenceCutoff.toISOString().split('T')[0];

  // Fetch the full window per ASIN batch, paginated past the 1,000-row cap.
  const byAsin = new Map<string, SnapshotRow[]>();
  for (let i = 0; i < asins.length; i += ASIN_BATCH) {
    const batch = asins.slice(i, i + ASIN_BATCH);
    const rows = (await fetchAllRecords(supabase, 'amazon_arbitrage_pricing', {
      select:
        'asin, snapshot_date, buy_box_price, buy_box_is_yours, total_offer_count, offer_count, sales_rank, sales_rank_drops_90d, was_price_90d, was_price_180d, your_price',
      eq: { user_id: userId },
      in: { asin: batch },
      gte: { snapshot_date: cutoffISO },
      // (asin, snapshot_date) is unique — composite order gives the total
      // ordering range pagination needs (single-column order can skip or
      // duplicate boundary rows and corrupt the median / latest position).
      orderBy: [
        { column: 'asin', ascending: true },
        { column: 'snapshot_date', ascending: true },
      ],
    })) as unknown as SnapshotRow[];

    for (const row of rows) {
      const list = byAsin.get(row.asin);
      if (list) list.push(row);
      else byAsin.set(row.asin, [row]);
    }
  }

  for (const asin of asins) {
    const rows = byAsin.get(asin) ?? [];
    if (rows.length === 0) continue;

    const boxPrices = rows
      .map((r) => (r.buy_box_price !== null ? Number(r.buy_box_price) : null))
      .filter((v): v is number => v !== null && v > 0);

    const fallbackPrice = currentPriceByAsin.get(asin) ?? null;
    const persistenceRows = rows.filter(
      (r) => r.snapshot_date >= persistenceCutoffISO && r.buy_box_price !== null && Number(r.buy_box_price) > 0
    );
    let belowCount = 0;
    let compared = 0;
    for (const r of persistenceRows) {
      const ourPrice = r.your_price !== null ? Number(r.your_price) : fallbackPrice;
      if (ourPrice === null || ourPrice <= 0) continue;
      compared++;
      if (Number(r.buy_box_price) < ourPrice - 0.005) belowCount++;
    }

    const anchorValues = rows
      .map((r) => (r.your_price !== null ? Number(r.your_price) : null))
      .filter((v): v is number => v !== null && v > 0);

    const latestBox = latestNonNull(rows, (r) => (r.buy_box_price !== null ? Number(r.buy_box_price) : null));
    const anchorPrice = anchorValues.length > 0 ? Math.max(...anchorValues, fallbackPrice ?? 0) : fallbackPrice;

    contexts.set(asin, {
      stableBuyBox: median(boxPrices),
      currentBuyBox: latestBox,
      keepaAvg180: latestNonNull(rows, (r) => (r.was_price_180d !== null ? Number(r.was_price_180d) : null)),
      keepaAvg90: latestNonNull(rows, (r) => (r.was_price_90d !== null ? Number(r.was_price_90d) : null)),
      persistenceBelowPct: compared > 0 ? belowCount / compared : null,
      persistenceSampleSize: compared,
      buyBoxIsYours: latestNonNull(rows, (r) => r.buy_box_is_yours),
      totalOfferCount: latestNonNull(rows, (r) =>
        r.total_offer_count !== null ? r.total_offer_count : r.offer_count
      ),
      salesRank: latestNonNull(rows, (r) => r.sales_rank),
      salesRankDrops90: latestNonNull(rows, (r) => r.sales_rank_drops_90d),
      anchorPrice,
      lastAppliedMatch: null, // attached per inventory item by the caller
    });
  }

  return contexts;
}

/**
 * Pre-v2 proposals also used markdown_step=1 but matched a spot price against
 * a different reference — they must not seed tier-2 escalation. Only matches
 * applied after the v2 deploy count.
 */
const V2_EPOCH = '2026-07-06';

/**
 * Most recent APPLIED tier-1 match proposal per inventory item — feeds the
 * tier-2 escalation ("we matched, waited, still not the box").
 */
export async function getLastAppliedMatches(
  supabase: SupabaseClient<Database>,
  userId: string,
  inventoryItemIds: string[]
): Promise<Map<string, { price: number; appliedAt: string }>> {
  const result = new Map<string, { price: number; appliedAt: string }>();
  const pageSize = 200;
  for (let i = 0; i < inventoryItemIds.length; i += pageSize) {
    const batch = inventoryItemIds.slice(i, i + pageSize);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('markdown_proposals')
      .select('inventory_item_id, proposed_price, applied_at')
      .eq('user_id', userId)
      .eq('platform', 'amazon')
      .eq('markdown_step', 1)
      .in('status', ['APPROVED', 'AUTO_APPLIED'])
      .not('applied_at', 'is', null)
      .gte('applied_at', V2_EPOCH)
      .not('proposed_price', 'is', null)
      .in('inventory_item_id', batch)
      .order('applied_at', { ascending: false });

    for (const row of data ?? []) {
      if (!result.has(row.inventory_item_id)) {
        result.set(row.inventory_item_id, {
          price: Number(row.proposed_price),
          appliedAt: row.applied_at,
        });
      }
    }
  }
  return result;
}
