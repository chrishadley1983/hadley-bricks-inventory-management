/**
 * Keepa Arbitrage Sync Service
 *
 * Syncs buy_box_price, sales_rank, was_price_90d, offer_count, and
 * lowest_offer_price for active ASINs using the Keepa product API.
 *
 * Budget-spread strategy (EUR 49 plan, 20 tokens/min):
 * - Called every 30 minutes by Cloud Scheduler (48 invocations/day)
 * - Each invocation processes a fixed ASIN budget (~56 ASINs)
 * - Priority: in-stock ASINs first (same-day freshness), then stalest items
 * - Leaves ~40% token headroom for other Keepa-consuming processes
 *
 * Token economics (EUR 49):
 *   20 tokens/min × 30 min = 600 tokens per window
 *   Budget per invocation: ~170 tokens (~57 ASINs × 3 tokens)
 *   Daily capacity: ~2,700 ASINs (232 in-stock + ~2,450 stale)
 *   Full cycle for ~8,600 non-in-stock ASINs: ~3.5 days
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { KeepaClient } from '../keepa/keepa-client';

const KEEPA_BATCH_SIZE = 10; // Keepa max per request

/** Default ASINs per invocation — conservative to avoid 429s */
const DEFAULT_BUDGET_PER_INVOCATION = 57;

/** Safety margin before Vercel timeout (ms) */
const SAFETY_MARGIN_MS = 30_000;

export class KeepaArbitrageSyncService {
  private keepa: KeepaClient;

  constructor(private supabase: SupabaseClient<Database>) {
    this.keepa = new KeepaClient();
  }

  /**
   * Get the per-invocation ASIN budget from env or default.
   */
  private getBudget(): number {
    return parseInt(
      process.env.KEEPA_BUDGET_PER_INVOCATION ?? String(DEFAULT_BUDGET_PER_INVOCATION),
      10
    );
  }

  /**
   * Fetch ASINs to sync via a single SQL RPC, prioritised:
   *   Tier 1: In-stock ASINs (qty >= 1) not refreshed today
   *   Tier 2: Stalest ASINs (oldest snapshot_date first, excluding already refreshed today)
   *
   * Returns at most `budget` ASINs in 1 DB call instead of 10+.
   */
  private async getPrioritisedAsins(
    userId: string,
    budget: number,
    today: string
  ): Promise<{ asins: string[]; inStockCount: number }> {
    const { data, error } = await this.supabase.rpc('get_keepa_priority_asins', {
      p_user_id: userId,
      p_today: today,
      p_budget: budget,
    });

    if (error) {
      throw new Error(`get_keepa_priority_asins RPC failed: ${error.message}`);
    }

    const rows = (data ?? []) as { asin: string; quantity: number; last_snapshot: string | null; priority: number }[];
    const asins = rows.map((r) => r.asin);
    const inStockCount = rows.filter((r) => r.priority === 1).length;
    const staleCount = rows.filter((r) => r.priority === 2).length;

    console.log(
      `[KeepaArbitrageSync] Budget ${budget}: ${inStockCount} in-stock + ${staleCount} stale (1 RPC call)`
    );

    return { asins, inStockCount };
  }

  /**
   * Sync pricing for a budget of ASINs using Keepa.
   * Self-contained: no cursor needed. Each invocation picks the highest-priority ASINs.
   *
   * @param userId - User ID
   * @param options.maxDurationMs - Hard time limit (Vercel timeout), defaults to 300_000 (5 min)
   * @param options.startTime - Start timestamp for timeout tracking
   * @returns processed, failed, updated counts + metadata
   */
  async syncPricingBatch(
    userId: string,
    options: {
      maxDurationMs?: number;
      startTime?: number;
    } = {}
  ): Promise<{
    processed: number;
    failed: number;
    updated: number;
    inStockSynced: number;
    staleSynced: number;
    inStockRemaining: number;
    rateLimited: boolean;
  }> {
    if (!this.keepa.isConfigured()) {
      throw new Error('Keepa API key not configured. Set KEEPA_API_KEY environment variable.');
    }

    const budget = this.getBudget();
    const maxDuration = options.maxDurationMs ?? 300_000;
    const startTime = options.startTime ?? Date.now();
    const today = new Date().toISOString().split('T')[0];

    console.log(`[KeepaArbitrageSync] Starting batch — budget: ${budget}`);

    // Get prioritised ASIN list
    const { asins: batchAsins, inStockCount } = await this.getPrioritisedAsins(
      userId,
      budget,
      today
    );

    if (batchAsins.length === 0) {
      console.log('[KeepaArbitrageSync] No ASINs to process');
      return {
        processed: 0,
        failed: 0,
        updated: 0,
        inStockSynced: 0,
        staleSynced: 0,
        inStockRemaining: 0,
        rateLimited: false,
      };
    }

    let updated = 0;
    let failed = 0;
    let processedCount = 0;
    let rateLimited = false;

    // Process in Keepa batches of 10
    for (let i = 0; i < batchAsins.length; i += KEEPA_BATCH_SIZE) {
      // Safety timer — stop before Vercel kills us
      const elapsed = Date.now() - startTime;
      if (elapsed > maxDuration - SAFETY_MARGIN_MS) {
        console.warn(
          `[KeepaArbitrageSync] Safety timer: ${Math.round(elapsed / 1000)}s elapsed, stopping`
        );
        break;
      }

      const batch = batchAsins.slice(i, i + KEEPA_BATCH_SIZE);

      try {
        const products = await this.keepa.fetchProducts(batch);

        const upsertData: {
          user_id: string;
          asin: string;
          snapshot_date: string;
          buy_box_price: number | null;
          sales_rank: number | null;
          was_price_90d: number | null;
          offer_count: number | null;
          lowest_offer_price: number | null;
        }[] = [];

        for (const product of products) {
          const pricing = this.keepa.extractCurrentPricing(product);

          upsertData.push({
            user_id: userId,
            asin: product.asin,
            snapshot_date: today,
            buy_box_price: pricing.buyBoxPrice,
            sales_rank: pricing.salesRank,
            was_price_90d: pricing.was90dAvg,
            offer_count: pricing.offerCount,
            lowest_offer_price: pricing.lowestNewPrice,
          });
        }

        if (upsertData.length > 0) {
          const { error: upsertError } = await this.supabase
            .from('amazon_arbitrage_pricing')
            .upsert(upsertData, {
              onConflict: 'asin,snapshot_date',
            });

          if (upsertError) {
            console.error(`[KeepaArbitrageSync] Upsert error:`, upsertError.message);
            failed += batch.length;
          } else {
            updated += upsertData.length;
          }
        }

        const notFound = batch.filter((a) => !products.some((p) => p.asin === a));
        if (notFound.length > 0) {
          console.warn(`[KeepaArbitrageSync] ${notFound.length} ASINs not found by Keepa`);
        }

        processedCount += batch.length;
      } catch (batchError) {
        // Check if this is a rate limit error
        const errMsg = batchError instanceof Error ? batchError.message : String(batchError);
        if (errMsg.includes('429')) {
          console.warn(`[KeepaArbitrageSync] Rate limited — stopping batch early`);
          rateLimited = true;
          break;
        }

        console.error(`[KeepaArbitrageSync] Batch error:`, batchError);
        failed += batch.length;
        processedCount += batch.length;
      }
    }

    const duration = Date.now() - startTime;
    const inStockSynced = Math.min(processedCount, inStockCount);
    const staleSynced = Math.max(0, processedCount - inStockCount);
    const inStockRemaining = Math.max(0, inStockCount - inStockSynced);

    console.log(
      `[KeepaArbitrageSync] Batch done in ${Math.round(duration / 1000)}s: ${processedCount} processed (${inStockSynced} in-stock, ${staleSynced} stale), ${updated} updated, ${failed} failed, tokens left: ${this.keepa.remainingTokens}${rateLimited ? ' [RATE LIMITED]' : ''}`
    );

    return {
      processed: processedCount,
      failed,
      updated,
      inStockSynced,
      staleSynced,
      inStockRemaining,
      rateLimited,
    };
  }
}
