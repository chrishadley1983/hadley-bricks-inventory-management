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
   * Fetch ASINs to sync, prioritised:
   *   Tier 1: In-stock ASINs (qty >= 1) not refreshed today
   *   Tier 2: Stalest ASINs (oldest snapshot_date first)
   *
   * Returns at most `budget` ASINs.
   */
  private async getPrioritisedAsins(
    userId: string,
    budget: number,
    today: string
  ): Promise<{ asins: string[]; inStockCount: number; staleCount: number }> {
    const PAGE_SIZE = 1000;

    // Step 1: Fetch all active tracked ASINs with quantity
    const allTracked: { asin: string; quantity: number }[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('tracked_asins')
        .select('asin, quantity')
        .eq('user_id', userId)
        .eq('status', 'active')
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (error) {
        throw new Error(`Failed to fetch tracked ASINs: ${error.message}`);
      }

      allTracked.push(...(data ?? []).map((r) => ({ asin: r.asin, quantity: r.quantity ?? 0 })));
      hasMore = (data?.length ?? 0) === PAGE_SIZE;
      page++;
    }

    // Step 2: Fetch seeded ASINs
    const seededAsins: string[] = [];
    page = 0;
    hasMore = true;

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('user_seeded_asin_preferences')
        .select(
          `
          seeded_asins!inner(asin),
          manual_asin_override
        `
        )
        .eq('user_id', userId)
        .eq('include_in_sync', true)
        .eq('user_status', 'active')
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (error) {
        console.error('[KeepaArbitrageSync] Error fetching seeded ASINs:', error);
        break;
      }

      const pageAsins = (data ?? [])
        .map((p) => {
          const sa = p.seeded_asins as unknown as { asin: string | null };
          return p.manual_asin_override ?? sa?.asin;
        })
        .filter((a): a is string => a !== null && a !== undefined);

      seededAsins.push(...pageAsins);
      hasMore = (data?.length ?? 0) === PAGE_SIZE;
      page++;
    }

    // Step 3: Build sets
    const inStockAsins = allTracked.filter((t) => t.quantity > 0).map((t) => t.asin);
    const allAsins = [...new Set([...allTracked.map((t) => t.asin), ...seededAsins])];

    console.log(
      `[KeepaArbitrageSync] Total: ${allAsins.length} ASINs (${inStockAsins.length} in-stock, ${seededAsins.length} seeded)`
    );

    // Step 4: Get latest snapshot_date per ASIN
    const snapshotMap = new Map<string, string | null>();

    for (let i = 0; i < allAsins.length; i += PAGE_SIZE) {
      const chunk = allAsins.slice(i, i + PAGE_SIZE);
      const { data, error } = await this.supabase
        .from('amazon_arbitrage_pricing')
        .select('asin, snapshot_date')
        .in('asin', chunk)
        .order('snapshot_date', { ascending: false });

      if (error) {
        console.error('[KeepaArbitrageSync] Error fetching snapshot dates:', error);
        continue;
      }

      for (const row of data ?? []) {
        if (!snapshotMap.has(row.asin)) {
          snapshotMap.set(row.asin, row.snapshot_date);
        }
      }
    }

    // Step 5: Tier 1 — in-stock ASINs not yet refreshed today
    const tier1 = inStockAsins.filter((asin) => {
      const lastSnapshot = snapshotMap.get(asin);
      return !lastSnapshot || lastSnapshot < today;
    });

    // Step 6: Tier 2 — all remaining ASINs sorted by staleness
    const tier1Set = new Set(tier1);
    const tier2 = allAsins
      .filter((asin) => !tier1Set.has(asin))
      .sort((a, b) => {
        const dateA = snapshotMap.get(a) ?? '1970-01-01';
        const dateB = snapshotMap.get(b) ?? '1970-01-01';
        return dateA.localeCompare(dateB);
      });

    // Step 7: Fill budget — tier 1 first, then tier 2
    const result: string[] = [];
    let inStockCount = 0;

    for (const asin of tier1) {
      if (result.length >= budget) break;
      result.push(asin);
      inStockCount++;
    }

    const staleStart = result.length;
    for (const asin of tier2) {
      if (result.length >= budget) break;
      result.push(asin);
    }

    const staleCount = result.length - staleStart;

    console.log(
      `[KeepaArbitrageSync] Budget ${budget}: ${inStockCount} in-stock (${tier1.length} needed) + ${staleCount} stale`
    );

    return { asins: result, inStockCount, staleCount };
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
