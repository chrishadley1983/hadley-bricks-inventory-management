import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { BrickLinkClient, RateLimitError } from '@/lib/bricklink';
import type { BrickLinkCredentials } from '@/lib/bricklink';
import { CredentialsRepository } from '@/lib/repositories/credentials.repository';
import { PriceCacheService } from './price-cache';
import { MinifigConfigService } from './config.service';
import { PricingEngine } from './pricing-engine';
import { MinifigJobTracker } from './job-tracker';
import type {
  MinifigSyncItem,
  MinifigPriceCache,
  MinifigSyncConfig,
  ResearchResult,
  BrickLinkResearchResult,
} from './types';

interface ResearchJobResult {
  jobId: string;
  itemsProcessed: number;
  itemsResearched: number;
  itemsCached: number;
  itemsErrored: number;
  errors: Array<{ item?: string; error: string }>;
}

export class ResearchService {
  private configService: MinifigConfigService;
  private cacheService: PriceCacheService;
  private jobTracker: MinifigJobTracker;

  constructor(
    private supabase: SupabaseClient<Database>,
    private userId: string,
  ) {
    this.configService = new MinifigConfigService(supabase);
    this.cacheService = new PriceCacheService(supabase);
    this.jobTracker = new MinifigJobTracker(supabase, userId);
  }

  /**
   * Research pricing for all (or specific) sync items.
   * Skips items with valid cache unless forceRefresh is true.
   */
  async researchAll(itemIds?: string[]): Promise<ResearchJobResult> {
    const jobId = await this.jobTracker.start('MARKET_RESEARCH');
    const errors: Array<{ item?: string; error: string }> = [];
    let itemsProcessed = 0;
    let itemsResearched = 0;
    let itemsCached = 0;
    let itemsErrored = 0;

    try {
      const config = await this.configService.getConfig();
      const pricingEngine = new PricingEngine(config);

      const client = await this.getBrickLinkClient();

      // Get items to research (must have a bricklink_id) — paginated (M1)
      const items: Array<Database['public']['Tables']['minifig_sync_items']['Row']> = [];
      const pageSize = 1000;
      let page = 0;
      let hasMore = true;
      while (hasMore) {
        let query = this.supabase
          .from('minifig_sync_items')
          .select('*')
          .eq('user_id', this.userId)
          .not('bricklink_id', 'is', null)
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (itemIds?.length) {
          query = query.in('id', itemIds);
        }

        const { data } = await query;
        items.push(...(data ?? []));
        hasMore = (data?.length ?? 0) === pageSize;
        page++;
      }

      for (const item of items as MinifigSyncItem[]) {
        itemsProcessed++;
        try {
          // Check cache (F20: skip if valid cache exists)
          const cached = await this.cacheService.lookup(item.bricklink_id!);
          if (cached) {
            itemsCached++;
            await this.updateItemFromCache(item, cached, pricingEngine, config);
            continue;
          }

          // No cache or expired — fetch from BrickLink (F16 fallback, F21 expired)
          const result = await this.fetchBrickLinkData(item.bricklink_id!, client);

          // Store in cache (F19)
          await this.cacheService.upsert(
            item.bricklink_id!,
            result,
            config.price_cache_months,
          );

          // Update sync item pricing
          await this.updateItemFromResearch(item, result, pricingEngine, config);
          itemsResearched++;
        } catch (err) {
          itemsErrored++;
          errors.push({
            item: item.bricklink_id || item.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      await this.jobTracker.complete(jobId, {
        itemsProcessed,
        itemsCreated: itemsResearched,
        itemsUpdated: itemsCached,
        itemsErrored,
      });

      return {
        jobId,
        itemsProcessed,
        itemsResearched,
        itemsCached,
        itemsErrored,
        errors,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push({ error: errorMsg });
      await this.jobTracker.fail(jobId, errors, {
        itemsProcessed,
        itemsCreated: itemsResearched,
        itemsUpdated: itemsCached,
        itemsErrored,
      });
      throw err;
    }
  }

  /**
   * Force-refresh research for a specific minifig, bypassing cache (F18).
   */
  async forceRefresh(itemId: string): Promise<void> {
    const config = await this.configService.getConfig();
    const pricingEngine = new PricingEngine(config);

    const { data: item } = await this.supabase
      .from('minifig_sync_items')
      .select('*')
      .eq('id', itemId)
      .eq('user_id', this.userId)
      .single();

    if (!item || !item.bricklink_id) {
      throw new Error('Item not found or missing BrickLink ID');
    }

    // Invalidate existing cache
    await this.cacheService.invalidate(item.bricklink_id);

    const client = await this.getBrickLinkClient();
    const result = await this.fetchBrickLinkData(item.bricklink_id, client);

    // Store fresh cache entry
    await this.cacheService.upsert(
      item.bricklink_id,
      result,
      config.price_cache_months,
    );

    // Update sync item pricing
    await this.updateItemFromResearch(
      item as MinifigSyncItem,
      result,
      pricingEngine,
      config,
    );
  }

  private async getBrickLinkClient(): Promise<BrickLinkClient> {
    const credentialsRepo = new CredentialsRepository(this.supabase);
    const credentials =
      await credentialsRepo.getCredentials<BrickLinkCredentials>(
        this.userId,
        'bricklink',
      );

    if (!credentials) {
      throw new Error('BrickLink credentials not configured');
    }

    return new BrickLinkClient(credentials);
  }

  /**
   * Fetch BrickLink sold price guide with exponential backoff retry (E4).
   */
  private async fetchBrickLinkData(
    bricklinkId: string,
    client: BrickLinkClient,
  ): Promise<BrickLinkResearchResult> {
    const soldGuide = await this.callWithRetry(() =>
      client.getPriceGuide({
        type: 'MINIFIG',
        no: bricklinkId,
        newOrUsed: 'U',
        guideType: 'sold',
        currencyCode: 'GBP',
      }),
    );

    const avgSoldPrice = parseFloat(soldGuide.avg_price) || 0;
    const minSoldPrice = parseFloat(soldGuide.min_price) || 0;
    const maxSoldPrice = parseFloat(soldGuide.max_price) || 0;
    const soldCount = soldGuide.unit_quantity || 0;

    return {
      avgSoldPrice,
      minSoldPrice,
      maxSoldPrice,
      soldCount,
      source: 'bricklink',
    };
  }

  /**
   * Retry with exponential backoff on rate-limit errors (E4).
   * Up to 3 retries: 1s, 2s, 4s delays.
   */
  private async callWithRetry<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
  ): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (err instanceof RateLimitError && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
    throw lastError!;
  }

  /**
   * Update a sync item using freshly-fetched research data.
   */
  private async updateItemFromResearch(
    item: MinifigSyncItem,
    result: ResearchResult,
    pricingEngine: PricingEngine,
    config: MinifigSyncConfig,
  ): Promise<void> {
    const avgShipping =
      result.source === 'terapeak' ? result.avgShipping : 0;
    const sellThroughRate =
      result.source === 'terapeak' ? result.sellThroughRate : 100;

    const meetsThreshold = pricingEngine.evaluateThreshold({
      soldCount: result.soldCount,
      sellThroughRate,
      avgSoldPrice: result.avgSoldPrice,
      avgShipping,
    });

    let recommendedPrice: number | null = null;
    let autoAccept: number | null = null;
    let autoDecline: number | null = null;

    if (meetsThreshold && item.bricqer_price != null) {
      const maxSoldPrice =
        result.source === 'terapeak'
          ? result.maxSoldPrice
          : result.maxSoldPrice;

      recommendedPrice = pricingEngine.calculateRecommendedPrice({
        avgSoldPrice: result.avgSoldPrice,
        maxSoldPrice,
        bricqerPrice: Number(item.bricqer_price),
      });

      const thresholds =
        pricingEngine.calculateBestOfferThresholds(recommendedPrice);
      autoAccept = thresholds.autoAccept;
      autoDecline = thresholds.autoDecline;
    }

    await this.supabase
      .from('minifig_sync_items')
      .update({
        recommended_price: recommendedPrice,
        best_offer_auto_accept: autoAccept,
        best_offer_auto_decline: autoDecline,
        meets_threshold: meetsThreshold,
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id);
  }

  /**
   * Update a sync item using cached data (same pricing logic, no API call).
   */
  private async updateItemFromCache(
    item: MinifigSyncItem,
    cached: MinifigPriceCache,
    pricingEngine: PricingEngine,
    config: MinifigSyncConfig,
  ): Promise<void> {
    const isTerapeak = cached.source === 'terapeak';

    const avgSoldPrice = Number(
      isTerapeak
        ? cached.terapeak_avg_sold_price
        : cached.bricklink_avg_sold_price,
    ) || 0;
    const soldCount = Number(
      isTerapeak
        ? cached.terapeak_sold_count
        : cached.bricklink_sold_count,
    ) || 0;
    const avgShipping = isTerapeak
      ? Number(cached.terapeak_avg_shipping) || 0
      : 0;
    const sellThroughRate = isTerapeak
      ? Number(cached.terapeak_sell_through_rate) || 0
      : 100;
    const maxSoldPrice = Number(cached.terapeak_max_sold_price) || avgSoldPrice;
    const minSoldPrice = Number(cached.terapeak_min_sold_price) || avgSoldPrice;

    const meetsThreshold = pricingEngine.evaluateThreshold({
      soldCount,
      sellThroughRate,
      avgSoldPrice,
      avgShipping,
    });

    let recommendedPrice: number | null = null;
    let autoAccept: number | null = null;
    let autoDecline: number | null = null;

    if (meetsThreshold && item.bricqer_price != null) {
      recommendedPrice = pricingEngine.calculateRecommendedPrice({
        avgSoldPrice,
        maxSoldPrice,
        bricqerPrice: Number(item.bricqer_price),
      });

      const thresholds =
        pricingEngine.calculateBestOfferThresholds(recommendedPrice);
      autoAccept = thresholds.autoAccept;
      autoDecline = thresholds.autoDecline;
    }

    await this.supabase
      .from('minifig_sync_items')
      .update({
        recommended_price: recommendedPrice,
        best_offer_auto_accept: autoAccept,
        best_offer_auto_decline: autoDecline,
        meets_threshold: meetsThreshold,
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id);
  }
}
