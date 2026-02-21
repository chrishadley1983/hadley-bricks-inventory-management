/**
 * Keepa Pricing Sync Service
 *
 * Populates amazon_arbitrage_pricing for seeded ASINs that don't yet have
 * pricing data from the SP-API cron. Uses Keepa's product API to fetch
 * buy box price, sales rank, and offer counts.
 *
 * Token cost: ~3 tokens per 10-ASIN batch = ~312 tokens for ~1,040 ASINs.
 * At 20 tokens/min refill, this takes ~15-20 minutes.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { KeepaClient } from '../keepa/keepa-client';

const BATCH_SIZE = 10; // Keepa max per request

export interface KeepaPricingSyncProgress {
  type: 'start' | 'progress' | 'complete' | 'error';
  processed?: number;
  total?: number;
  percent?: number;
  upserted?: number;
  skipped?: number;
  failed?: number;
  tokensRemaining?: number;
  error?: string;
}

/**
 * Service for syncing Amazon pricing via Keepa for seeded ASINs missing pricing data
 */
export class KeepaPricingSyncService {
  private keepa: KeepaClient;

  constructor(private supabase: SupabaseClient<Database>) {
    this.keepa = new KeepaClient();
  }

  /**
   * Find seeded ASINs that have no amazon_arbitrage_pricing rows
   */
  async getSeededAsinsWithoutPricing(): Promise<string[]> {
    const allAsins: string[] = [];
    const pageSize = 1000;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('seeded_asins')
        .select('asin')
        .eq('discovery_status', 'found')
        .not('asin', 'is', null)
        .range(offset, offset + pageSize - 1);

      if (error) {
        throw new Error(`Failed to fetch seeded ASINs: ${error.message}`);
      }

      const asins = (data ?? []).map((r) => r.asin).filter((a): a is string => a !== null);
      allAsins.push(...asins);
      hasMore = (data?.length ?? 0) === pageSize;
      offset += pageSize;
    }

    if (allAsins.length === 0) return [];

    // Find which ASINs already have pricing
    const withPricing = new Set<string>();
    offset = 0;
    hasMore = true;

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('amazon_arbitrage_pricing')
        .select('asin')
        .in('asin', allAsins.slice(offset, offset + pageSize))
        .range(0, pageSize - 1);

      if (error) {
        throw new Error(`Failed to check existing pricing: ${error.message}`);
      }

      for (const row of data ?? []) {
        withPricing.add(row.asin);
      }

      hasMore = offset + pageSize < allAsins.length;
      offset += pageSize;
    }

    // Return ASINs without pricing
    return allAsins.filter((asin) => !withPricing.has(asin));
  }

  /**
   * Sync pricing from Keepa for seeded ASINs missing amazon_arbitrage_pricing data.
   *
   * @param userId - User ID for inserting pricing rows
   * @param onProgress - Progress callback for streaming updates
   */
  async syncMissingPricing(
    userId: string,
    onProgress?: (progress: KeepaPricingSyncProgress) => void
  ): Promise<{ upserted: number; skipped: number; failed: number; total: number }> {
    if (!this.keepa.isConfigured()) {
      throw new Error('Keepa API key not configured. Set KEEPA_API_KEY environment variable.');
    }

    const missingAsins = await this.getSeededAsinsWithoutPricing();

    if (missingAsins.length === 0) {
      onProgress?.({
        type: 'complete',
        processed: 0,
        total: 0,
        upserted: 0,
        skipped: 0,
        failed: 0,
      });
      return { upserted: 0, skipped: 0, failed: 0, total: 0 };
    }

    const total = missingAsins.length;
    let processed = 0;
    let upserted = 0;
    let skipped = 0;
    let failed = 0;

    onProgress?.({ type: 'start', total, processed: 0, percent: 0 });

    // Process in batches of BATCH_SIZE
    for (let i = 0; i < missingAsins.length; i += BATCH_SIZE) {
      const batch = missingAsins.slice(i, i + BATCH_SIZE);

      try {
        const products = await this.keepa.fetchProducts(batch);

        const today = new Date().toISOString().split('T')[0];

        for (const product of products) {
          try {
            // Extract the latest snapshot
            const snapshots = this.keepa.extractSnapshots(product);

            if (snapshots.length === 0) {
              skipped++;
              continue;
            }

            // Use the most recent snapshot
            const latest = snapshots[snapshots.length - 1];

            // Need at least some price data
            const buyBoxPrice = latest.buy_box_price;
            const amazonPrice = latest.amazon_price;

            if (buyBoxPrice === null && amazonPrice === null) {
              skipped++;
              continue;
            }

            // Upsert into amazon_arbitrage_pricing
            const { error: upsertError } = await this.supabase
              .from('amazon_arbitrage_pricing')
              .upsert(
                {
                  user_id: userId,
                  asin: product.asin,
                  snapshot_date: today,
                  buy_box_price: buyBoxPrice,
                  your_price: amazonPrice ?? buyBoxPrice,
                  your_qty: 0,
                  buy_box_is_yours: false,
                  offer_count: latest.new_offer_count,
                  sales_rank: latest.sales_rank,
                },
                { onConflict: 'asin,snapshot_date' }
              );

            if (upsertError) {
              console.error(
                `[KeepaPricingSync] Upsert error for ${product.asin}:`,
                upsertError.message
              );
              failed++;
            } else {
              upserted++;
            }
          } catch (productError) {
            console.error(`[KeepaPricingSync] Error processing ${product.asin}:`, productError);
            failed++;
          }
        }

        // Count ASINs in batch but not in products (Keepa didn't find them)
        const foundAsins = new Set(products.map((p) => p.asin));
        for (const asin of batch) {
          if (!foundAsins.has(asin)) {
            skipped++;
          }
        }
      } catch (batchError) {
        console.error(`[KeepaPricingSync] Batch error for ASINs ${batch.join(',')}:`, batchError);
        failed += batch.length;
      }

      processed += batch.length;
      const percent = Math.round((processed / total) * 100);

      onProgress?.({
        type: 'progress',
        processed,
        total,
        percent,
        upserted,
        skipped,
        failed,
        tokensRemaining: this.keepa.remainingTokens,
      });
    }

    onProgress?.({
      type: 'complete',
      processed,
      total,
      percent: 100,
      upserted,
      skipped,
      failed,
    });

    return { upserted, skipped, failed, total };
  }
}
