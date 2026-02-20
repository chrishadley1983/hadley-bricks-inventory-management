import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { BrickLinkClient, RateLimitError } from '@/lib/bricklink';
import type { BrickLinkCredentials } from '@/lib/bricklink';
import { CredentialsRepository } from '@/lib/repositories/credentials.repository';
import { PriceCacheService } from './price-cache';
import { MinifigConfigService } from './config.service';
import { PricingEngine } from './pricing-engine';
import { MinifigJobTracker } from './job-tracker';
import { TerapeakScraper, TerapeakSessionExpiredError } from './terapeak-scraper';
import type {
  MinifigSyncItem,
  MinifigPriceCache,
  MinifigSyncConfig,
  ResearchResult,
  BrickLinkResearchResult,
} from './types';
import type { SyncProgressCallback } from '@/types/minifig-sync-stream';

interface ResearchJobResult {
  jobId: string;
  itemsProcessed: number;
  itemsResearched: number;
  itemsCached: number;
  itemsErrored: number;
  errors: Array<{ item?: string; error: string }>;
}

/**
 * Check if an error indicates Playwright/Chromium is unavailable (e.g. on Vercel).
 */
function isPlaywrightUnavailable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes('playwright') ||
    msg.includes('chromium') ||
    msg.includes('cannot find module') ||
    msg.includes('could not find expected browser')
  );
}

export class ResearchService {
  private configService: MinifigConfigService;
  private cacheService: PriceCacheService;
  private jobTracker: MinifigJobTracker;
  private _terapeakScraper: TerapeakScraper | null = null;

  constructor(
    private supabase: SupabaseClient<Database>,
    private userId: string,
  ) {
    this.configService = new MinifigConfigService(supabase);
    this.cacheService = new PriceCacheService(supabase);
    this.jobTracker = new MinifigJobTracker(supabase, userId);
  }

  private getTerapeakScraper(): TerapeakScraper {
    if (!this._terapeakScraper) {
      this._terapeakScraper = new TerapeakScraper(this.supabase, this.userId);
    }
    return this._terapeakScraper;
  }

  /**
   * Research pricing for all (or specific) sync items.
   * Uses 4-step priority: Terapeak cache -> Live Terapeak -> BrickLink cache -> Live BrickLink.
   */
  async researchAll(itemIds?: string[], options?: { onProgress?: SyncProgressCallback }): Promise<ResearchJobResult> {
    const onProgress = options?.onProgress;
    const jobId = await this.jobTracker.start('MARKET_RESEARCH');
    const errors: Array<{ item?: string; error: string }> = [];
    let itemsProcessed = 0;
    let itemsResearched = 0;
    let itemsCached = 0;
    let itemsErrored = 0;

    // Terapeak availability flag — disabled on session expiry or Playwright unavailable
    let terapeakAvailable = true;

    try {
      await onProgress?.({ type: 'stage', stage: 'config', message: 'Loading configuration...' });
      const config = await this.configService.getConfig();
      const pricingEngine = new PricingEngine(config);

      await onProgress?.({ type: 'stage', stage: 'credentials', message: 'Checking credentials...' });
      const client = await this.getBrickLinkClient();

      // Get items to research (must have a bricklink_id) — paginated (M1)
      await onProgress?.({ type: 'stage', stage: 'fetch', message: 'Loading sync items...' });
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

      await onProgress?.({ type: 'stage', stage: 'research', message: 'Researching pricing...' });
      for (let i = 0; i < items.length; i++) {
        const item = items[i] as MinifigSyncItem;
        const bricklinkId = item.bricklink_id!;
        itemsProcessed++;
        await onProgress?.({
          type: 'progress',
          current: i + 1,
          total: items.length,
          message: bricklinkId || item.name || `Item ${i + 1}`,
        });
        try {
          // ── Step 1: Terapeak cache hit ──
          if (terapeakAvailable) {
            const terapeakCached = await this.cacheService.lookupBySource(bricklinkId, 'terapeak');
            if (terapeakCached) {
              itemsCached++;
              await this.updateItemFromCache(item, terapeakCached, pricingEngine, config);
              continue;
            }
          }

          // ── Step 2: Live Terapeak scrape ──
          if (terapeakAvailable) {
            try {
              const scraper = this.getTerapeakScraper();
              const terapeakResult = await scraper.research(
                item.name || '',
                bricklinkId,
              );

              if (terapeakResult) {
                await this.cacheService.upsert(bricklinkId, terapeakResult, config.price_cache_months);
                await this.updateItemFromResearch(item, terapeakResult, pricingEngine, config);
                itemsResearched++;
                continue;
              }
              // null result (no Terapeak data) — fall through to BrickLink
            } catch (terapeakErr) {
              if (terapeakErr instanceof TerapeakSessionExpiredError) {
                console.warn('[Research] Terapeak session expired — disabling for rest of batch');
                terapeakAvailable = false;
              } else if (isPlaywrightUnavailable(terapeakErr)) {
                console.warn('[Research] Playwright unavailable — disabling Terapeak for this batch');
                terapeakAvailable = false;
              } else {
                console.warn(`[Research] Terapeak error for ${bricklinkId}, falling back to BrickLink:`, terapeakErr);
              }
              // Fall through to BrickLink
            }
          }

          // ── Step 3: BrickLink cache hit ──
          const bricklinkCached = await this.cacheService.lookupBySource(bricklinkId, 'bricklink');
          if (bricklinkCached) {
            itemsCached++;
            await this.updateItemFromCache(item, bricklinkCached, pricingEngine, config);
            continue;
          }

          // ── Step 4: Live BrickLink API ──
          const result = await this.fetchBrickLinkData(bricklinkId, client);
          await this.cacheService.upsert(bricklinkId, result, config.price_cache_months);
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
   * Tries Terapeak first, falls back to BrickLink.
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

    // Try Terapeak first
    try {
      const scraper = this.getTerapeakScraper();
      const terapeakResult = await scraper.research(
        item.name || '',
        item.bricklink_id,
      );

      if (terapeakResult) {
        await this.cacheService.upsert(item.bricklink_id, terapeakResult, config.price_cache_months);
        await this.updateItemFromResearch(item as MinifigSyncItem, terapeakResult, pricingEngine, config);
        return;
      }
    } catch (err) {
      if (err instanceof TerapeakSessionExpiredError || isPlaywrightUnavailable(err)) {
        console.warn('[ForceRefresh] Terapeak unavailable, falling back to BrickLink');
      } else {
        console.warn(`[ForceRefresh] Terapeak error for ${item.bricklink_id}, falling back to BrickLink:`, err);
      }
    }

    // Fall back to BrickLink
    const client = await this.getBrickLinkClient();
    const result = await this.fetchBrickLinkData(item.bricklink_id, client);

    await this.cacheService.upsert(
      item.bricklink_id,
      result,
      config.price_cache_months,
    );

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
    _config: MinifigSyncConfig,
  ): Promise<void> {
    // Use conservative defaults when BrickLink data has no sell-through/shipping info (M8)
    const avgShipping =
      result.source === 'terapeak' ? result.avgShipping : 1.50;
    const sellThroughRate =
      result.source === 'terapeak' ? result.sellThroughRate : 50;

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
      const maxSoldPrice = result.maxSoldPrice;

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
      .eq('id', item.id)
      .eq('user_id', this.userId);
  }

  /**
   * Update a sync item using cached data (same pricing logic, no API call).
   */
  private async updateItemFromCache(
    item: MinifigSyncItem,
    cached: MinifigPriceCache,
    pricingEngine: PricingEngine,
    _config: MinifigSyncConfig,
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
    // Use conservative defaults when BrickLink data has no sell-through/shipping info (M8)
    const avgShipping = isTerapeak
      ? Number(cached.terapeak_avg_shipping) || 0
      : 1.50;
    const sellThroughRate = isTerapeak
      ? Number(cached.terapeak_sell_through_rate) || 0
      : 50;
    const maxSoldPrice = Number(cached.terapeak_max_sold_price) || avgSoldPrice;

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
      .eq('id', item.id)
      .eq('user_id', this.userId);
  }
}
