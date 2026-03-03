/**
 * BrickLink Store Deal Service
 *
 * Orchestrates the store scraper, exclusion filtering, shipping estimation,
 * and database storage for the deal finder feature.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import {
  BrickLinkStoreScraper,
  BrickLinkSessionExpiredError,
} from './bricklink-store-scraper';
import { BrickLinkStoreExclusionService } from './bricklink-store-exclusion.service';

// Shipping heuristics by store country (always in GBP)
const UK_CODES = new Set(['UK', 'GB']);
const EU_CODES = new Set([
  'DE', 'FR', 'NL', 'BE', 'AT', 'IT', 'ES', 'PL', 'PT', 'IE', 'SE', 'DK',
  'FI', 'CZ', 'HU', 'RO', 'BG', 'HR', 'SK', 'SI', 'LT', 'LV', 'EE', 'LU',
]);

const SHIPPING_HEURISTICS = {
  uk: 3.50,
  eu: 8.00,
  row: 15.00,
} as const;

const PAGE_SIZE = 1000;
const BATCH_SIZE = 100;

export type ShippingTier = 'uk' | 'eu' | 'row';

export interface StoreListing {
  id: string;
  bricklinkSetNumber: string;
  storeName: string;
  storeCountry: string | null;
  storeFeedback: number | null;
  unitPrice: number;
  quantity: number;
  minBuy: number | null;
  shipsToUk: boolean | null;
  condition: string;
  currencyCode: string;
  estimatedShipping: number;
  estimatedTotal: number;
  shippingTier: ShippingTier;
  scrapedAt: string;
  isExcluded: boolean;
}

export interface ScrapeResult {
  stored: number;
  excluded: number;
  total: number;
}

export interface BatchScrapeResult {
  processed: number;
  failed: number;
  totalListings: number;
}

export class BrickLinkStoreDealService {
  private scraper = new BrickLinkStoreScraper();
  private exclusionService: BrickLinkStoreExclusionService;

  constructor(private supabase: SupabaseClient<Database>) {
    this.exclusionService = new BrickLinkStoreExclusionService(supabase);
  }

  /**
   * Scrape listings for a single set, filter, estimate shipping, and store in DB.
   */
  async scrapeAndStore(userId: string, setNumber: string): Promise<ScrapeResult> {
    // Scrape from BrickLink
    const rawListings = await this.scraper.scrapeListings(setNumber);

    // Get excluded store names
    const excludedNames = await this.exclusionService.getExcludedStoreNames(userId);

    // Process all listings (both excluded and not)
    let excludedCount = 0;
    const rows: Array<{
      user_id: string;
      bricklink_set_number: string;
      store_name: string;
      store_country: string | null;
      store_feedback: number | null;
      unit_price: number;
      quantity: number;
      min_buy: number | null;
      ships_to_uk: boolean | null;
      condition: string;
      currency_code: string;
      estimated_shipping: number;
      estimated_total: number;
      shipping_tier: ShippingTier;
      scraped_at: string;
    }> = [];

    const now = new Date().toISOString();

    for (const listing of rawListings) {
      if (excludedNames.has(listing.storeName)) {
        excludedCount++;
      }

      const { cost: estShipping, tier } = this.estimateShipping(listing.storeCountry);

      // Only sum price + shipping when both are in the same currency (GBP).
      // For non-GBP listings, estimated_total is the price alone (shipping
      // would need currency conversion which we don't have).
      const estimatedTotal = listing.currencyCode === 'GBP'
        ? listing.unitPrice + estShipping
        : listing.unitPrice;

      rows.push({
        user_id: userId,
        bricklink_set_number: setNumber,
        store_name: listing.storeName,
        store_country: listing.storeCountry,
        store_feedback: listing.storeFeedback,
        unit_price: listing.unitPrice,
        quantity: listing.quantity,
        min_buy: listing.minBuy,
        ships_to_uk: listing.shipsToUk,
        condition: listing.condition,
        currency_code: listing.currencyCode,
        estimated_shipping: estShipping,
        estimated_total: estimatedTotal,
        shipping_tier: tier,
        scraped_at: now,
      });
    }

    // Upsert new rows first, then prune stale ones (atomic-safe: if crash
    // occurs after upsert but before prune, we just have extra rows rather
    // than losing all cached data for this set).
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error } = await this.supabase
        .from('bricklink_store_listings')
        .upsert(batch, { onConflict: 'user_id,bricklink_set_number,store_name' });

      if (error) {
        console.error('[BrickLinkStoreDealService.scrapeAndStore] Upsert error:', error);
        throw new Error(`Failed to upsert listings: ${error.message}`);
      }
    }

    // Remove stale rows (stores no longer in the fresh scrape)
    if (rows.length > 0) {
      const { error: pruneError } = await this.supabase
        .from('bricklink_store_listings')
        .delete()
        .eq('user_id', userId)
        .eq('bricklink_set_number', setNumber)
        .lt('scraped_at', now);

      if (pruneError) {
        console.error('[BrickLinkStoreDealService.scrapeAndStore] Prune error:', pruneError);
        // Non-fatal: stale rows remain but fresh data is already saved
      }
    }

    return {
      stored: rows.length,
      excluded: excludedCount,
      total: rawListings.length,
    };
  }

  /**
   * Scrape listings for a batch of sets sequentially with progress reporting.
   */
  async scrapeAndStoreBatch(
    userId: string,
    setNumbers: string[],
    onProgress?: (processed: number, total: number) => Promise<void>
  ): Promise<BatchScrapeResult> {
    let processed = 0;
    let failed = 0;
    let totalListings = 0;

    for (const setNumber of setNumbers) {
      try {
        const result = await this.scrapeAndStore(userId, setNumber);
        totalListings += result.stored;
        processed++;
      } catch (err) {
        if (err instanceof BrickLinkSessionExpiredError) {
          throw err;
        }
        console.error(
          `[BrickLinkStoreDealService.scrapeAndStoreBatch] Error scraping ${setNumber}:`,
          err instanceof Error ? err.message : err
        );
        failed++;
        processed++;
      }

      await onProgress?.(processed, setNumbers.length);
    }

    return { processed, failed, totalListings };
  }

  /**
   * Get cached listings for a set, optionally filtering out excluded stores.
   * Paginates to handle tables exceeding Supabase's 1,000-row limit.
   */
  async getListingsForSet(
    userId: string,
    setNumber: string,
    options: { excludeStores?: boolean; maxAgeDays?: number } = {}
  ): Promise<StoreListing[]> {
    const { excludeStores = true, maxAgeDays = 7 } = options;

    const allData: Array<Record<string, unknown>> = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      let query = this.supabase
        .from('bricklink_store_listings')
        .select('*')
        .eq('user_id', userId)
        .eq('bricklink_set_number', setNumber)
        .order('estimated_total', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      // Filter by max age
      if (maxAgeDays > 0) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - maxAgeDays);
        query = query.gte('scraped_at', cutoff.toISOString());
      }

      const { data, error } = await query;

      if (error) {
        console.error('[BrickLinkStoreDealService.getListingsForSet] Error:', error);
        throw new Error(`Failed to fetch listings: ${error.message}`);
      }

      for (const row of data ?? []) {
        allData.push(row as Record<string, unknown>);
      }

      hasMore = (data?.length ?? 0) === PAGE_SIZE;
      page++;
    }

    // Get exclusions for tagging
    const excludedNames = excludeStores
      ? await this.exclusionService.getExcludedStoreNames(userId)
      : new Set<string>();

    return allData.map((row) => ({
      id: row.id as string,
      bricklinkSetNumber: row.bricklink_set_number as string,
      storeName: row.store_name as string,
      storeCountry: row.store_country as string | null,
      storeFeedback: row.store_feedback ? Number(row.store_feedback) : null,
      unitPrice: Number(row.unit_price),
      quantity: row.quantity as number,
      minBuy: row.min_buy ? Number(row.min_buy) : null,
      shipsToUk: row.ships_to_uk as boolean | null,
      condition: (row.condition as string) ?? 'N',
      currencyCode: (row.currency_code as string) ?? 'GBP',
      estimatedShipping: Number(row.estimated_shipping ?? 0),
      estimatedTotal: Number(row.estimated_total ?? 0),
      shippingTier: ((row.shipping_tier as string) ?? 'row') as ShippingTier,
      scrapedAt: row.scraped_at as string,
      isExcluded: excludedNames.has(row.store_name as string),
    }));
  }

  /**
   * Get set numbers from the arbitrage view that have good margins.
   * These are the sets worth scraping for store-level deals.
   * Paginates to handle tables exceeding Supabase's 1,000-row limit.
   */
  async getPromisingSetNumbers(
    userId: string,
    minMarginPercent: number = 25
  ): Promise<string[]> {
    const setNumbers: string[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('arbitrage_current_view')
        .select('bricklink_set_number')
        .eq('user_id', userId)
        .not('bricklink_set_number', 'is', null)
        .gte('margin_percent', minMarginPercent)
        .order('margin_percent', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (error) {
        console.error('[BrickLinkStoreDealService.getPromisingSetNumbers] Error:', error);
        throw new Error(`Failed to fetch promising sets: ${error.message}`);
      }

      for (const row of data ?? []) {
        if (row.bricklink_set_number) {
          setNumbers.push(row.bricklink_set_number);
        }
      }

      hasMore = (data?.length ?? 0) === PAGE_SIZE;
      page++;
    }

    return setNumbers;
  }

  /**
   * Estimate shipping cost based on store country.
   * Shipping estimates are always in GBP.
   */
  private estimateShipping(storeCountry: string | null): {
    cost: number;
    tier: ShippingTier;
  } {
    if (!storeCountry) return { cost: SHIPPING_HEURISTICS.row, tier: 'row' };
    if (UK_CODES.has(storeCountry)) return { cost: SHIPPING_HEURISTICS.uk, tier: 'uk' };
    if (EU_CODES.has(storeCountry)) return { cost: SHIPPING_HEURISTICS.eu, tier: 'eu' };
    return { cost: SHIPPING_HEURISTICS.row, tier: 'row' };
  }
}
