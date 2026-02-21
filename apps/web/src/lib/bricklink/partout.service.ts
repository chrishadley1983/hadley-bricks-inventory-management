/**
 * Partout Service
 *
 * Calculates the total value of a LEGO set's individual parts if sold separately.
 * Uses caching to minimize BrickLink API calls.
 */

import { RateLimitError, type BrickLinkClient } from './client';
import type { BrickLinkItemType, BrickLinkSubsetEntry } from './types';
import type { PartPriceCacheService } from './part-price-cache.service';
import type {
  PartoutData,
  PartValue,
  PartIdentifier,
  PartPriceData,
  CachedPartWithIdentifier,
  PartoutProgressCallback,
} from '@/types/partout';

/** Color map type */
type ColorMap = Map<number, string>;

/** Batch size for API calls - smaller to avoid rate limiting */
const BATCH_SIZE = 10;

/** Delay between individual API calls in milliseconds */
const REQUEST_DELAY_MS = 200;

/** Delay between batches in milliseconds */
const BATCH_DELAY_MS = 2000;

/** Generate BrickLink image URL for a part */
function getPartImageUrl(type: BrickLinkItemType, partNumber: string, colorId: number): string {
  // BrickLink image URL pattern
  const typeCode = type === 'MINIFIG' ? 'MN' : type === 'SET' ? 'SN' : 'PN';
  return `https://img.bricklink.com/ItemImage/${typeCode}/${colorId}/${partNumber}.png`;
}

/** Delay helper */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Partout Service
 */
export class PartoutService {
  private colorMap: ColorMap | null = null;
  private colorMapPromise: Promise<ColorMap> | null = null;

  constructor(
    private brickLinkClient: BrickLinkClient,
    private cacheService: PartPriceCacheService
  ) {}

  /**
   * Get or fetch the color map
   * Colors are cached for the lifetime of the service instance
   */
  private async getColorMap(): Promise<ColorMap> {
    // Return cached map if available
    if (this.colorMap) {
      return this.colorMap;
    }

    // If a fetch is in progress, wait for it
    if (this.colorMapPromise) {
      return this.colorMapPromise;
    }

    // Start fetching colors
    this.colorMapPromise = this.fetchColors();
    this.colorMap = await this.colorMapPromise;
    this.colorMapPromise = null;

    return this.colorMap;
  }

  /**
   * Fetch all colors from BrickLink and create a lookup map
   */
  private async fetchColors(): Promise<ColorMap> {
    try {
      console.log('[PartoutService] Fetching colors from BrickLink');
      const colors = await this.brickLinkClient.getColors();
      const map = new Map<number, string>();

      for (const color of colors) {
        map.set(color.color_id, color.color_name);
      }

      console.log(`[PartoutService] Loaded ${map.size} colors`);
      return map;
    } catch (error) {
      console.error('[PartoutService] Failed to fetch colors:', error);
      // Return empty map on error - colors will show as "Unknown"
      return new Map();
    }
  }

  /**
   * Get the complete partout value analysis for a set
   * @param setNumber Set number (e.g., "75192-1")
   * @param options Options for the partout calculation
   * @returns Complete partout analysis data
   */
  async getPartoutValue(
    setNumber: string,
    options: {
      onProgress?: PartoutProgressCallback;
      forceRefresh?: boolean;
    } = {}
  ): Promise<PartoutData> {
    const { onProgress, forceRefresh = false } = options;
    console.log(
      `[PartoutService] Getting partout value for set ${setNumber}${forceRefresh ? ' (force refresh)' : ''}`
    );

    // 1. Fetch colors and parts list in parallel
    const [colorMap, subsets] = await Promise.all([
      this.getColorMap(),
      this.brickLinkClient.getSubsets('SET', setNumber, {
        breakMinifigs: false, // Keep minifigs as items, don't break into parts
        breakSets: false, // Keep included sets as items
      }),
    ]);

    // 2. Flatten parts list with color names
    const parts = this.flattenSubsets(subsets, colorMap);
    console.log(`[PartoutService] Found ${parts.length} unique parts/colours`);

    if (parts.length === 0) {
      return this.createEmptyResult(setNumber);
    }

    // 3. If force refresh, delete existing cache entries for these parts
    if (forceRefresh) {
      console.log(`[PartoutService] Force refresh: clearing cache for ${parts.length} parts`);
      await this.cacheService.deleteCachedPrices(parts);
    }

    // 4. Check cache for each part+colour (will be empty if force refreshed)
    const { cached, uncached } = await this.cacheService.getCachedPrices(parts);

    // Report initial progress with cache stats (fetched=0, total=uncached, cached=cached)
    onProgress?.(0, uncached.length, cached.length);

    // 5. Fetch uncached parts in batches
    const freshPrices = await this.fetchUncachedPrices(uncached, cached.length, onProgress);

    // 5. Upsert fresh prices to cache
    if (freshPrices.length > 0) {
      await this.cacheService.upsertPrices(freshPrices);
    }

    // 6. Get set prices for ratio calculation
    const [setPriceNew, setPriceUsed] = await Promise.all([
      this.getSetPrice(setNumber, 'N'),
      this.getSetPrice(setNumber, 'U'),
    ]);

    // 7. Combine cached and fresh data into part values
    const partValues = this.buildPartsList(cached, freshPrices, parts);

    // 8. Calculate totals
    const povNew = partValues.reduce((sum, p) => sum + p.totalNew, 0);
    const povUsed = partValues.reduce((sum, p) => sum + p.totalUsed, 0);

    // 9. Calculate ratios
    const ratioNew = setPriceNew ? povNew / setPriceNew : null;
    const ratioUsed = setPriceUsed ? povUsed / setPriceUsed : null;

    // 10. Determine recommendation based on new condition ratio
    const recommendation = ratioNew !== null && ratioNew > 1 ? 'part-out' : 'sell-complete';

    return {
      setNumber,
      totalParts: parts.length,
      povNew,
      povUsed,
      setPrice: {
        new: setPriceNew,
        used: setPriceUsed,
      },
      ratioNew,
      ratioUsed,
      recommendation,
      cacheStats: {
        fromCache: cached.length,
        fromApi: freshPrices.length,
        total: parts.length,
      },
      parts: partValues.sort((a, b) => b.totalNew - a.totalNew), // Sort by value descending
    };
  }

  /**
   * Flatten subset entries into a list of part identifiers
   * @param subsets Subset entries from BrickLink API
   * @param colorMap Map of color IDs to color names
   */
  private flattenSubsets(subsets: BrickLinkSubsetEntry[], colorMap: ColorMap): PartIdentifier[] {
    const parts: PartIdentifier[] = [];

    for (const subset of subsets) {
      for (const entry of subset.entries) {
        // Skip alternates and counterparts - only include primary parts
        if (entry.is_alternate || entry.is_counterpart) {
          continue;
        }

        // Get color name from our fetched color map (API response may not include it)
        const colourName = colorMap.get(entry.color_id) || entry.color_name || 'Unknown';

        parts.push({
          partNumber: entry.item.no,
          partType: entry.item.type,
          colourId: entry.color_id,
          colourName,
          name: entry.item.name,
          quantity: entry.quantity,
        });
      }
    }

    return parts;
  }

  /**
   * Fetch prices for uncached parts in batches with rate limiting protection
   * Uses sequential requests with delays to avoid hitting BrickLink's rate limit
   */
  private async fetchUncachedPrices(
    parts: PartIdentifier[],
    cachedCount: number,
    onProgress?: PartoutProgressCallback
  ): Promise<PartPriceData[]> {
    if (parts.length === 0) {
      return [];
    }

    console.log(
      `[PartoutService] Fetching ${parts.length} uncached parts from BrickLink (sequential with ${REQUEST_DELAY_MS}ms delay)`
    );

    const results: PartPriceData[] = [];
    let rateLimitHit = false;

    for (let i = 0; i < parts.length && !rateLimitHit; i += BATCH_SIZE) {
      const batch = parts.slice(i, i + BATCH_SIZE);

      // Process batch sequentially with delays between requests
      for (let j = 0; j < batch.length && !rateLimitHit; j++) {
        const part = batch[j];

        try {
          const priceData = await this.fetchPartPrice(part);
          if (priceData) {
            results.push(priceData);
          }
        } catch (error) {
          if (error instanceof RateLimitError) {
            console.warn(`[PartoutService] Rate limit hit at part ${part.partNumber}. Stopping.`);
            rateLimitHit = true;
            break;
          } else {
            console.warn(`[PartoutService] Failed to fetch price for ${part.partNumber}:`, error);
          }
        }

        // Delay between individual requests (except for last in batch)
        if (j < batch.length - 1 && !rateLimitHit) {
          await delay(REQUEST_DELAY_MS);
        }
      }

      // Report progress after each batch
      const fetched = Math.min(i + BATCH_SIZE, parts.length);
      onProgress?.(fetched, parts.length, cachedCount);

      // Longer delay between batches (except after the last batch or if rate limited)
      if (i + BATCH_SIZE < parts.length && !rateLimitHit) {
        await delay(BATCH_DELAY_MS);
      }
    }

    if (rateLimitHit) {
      console.warn(
        `[PartoutService] Rate limit stopped fetching. Got ${results.length}/${parts.length} parts before limit.`
      );
    } else {
      console.log(`[PartoutService] Fetched ${results.length}/${parts.length} prices from API`);
    }
    return results;
  }

  /**
   * Fetch price for a single part from BrickLink
   * Makes sequential API calls with delays to avoid rate limiting.
   * Fetches: new stock, used stock, new sold, and used sold data
   */
  private async fetchPartPrice(part: PartIdentifier): Promise<PartPriceData | null> {
    try {
      // Make API calls sequentially with delays to avoid rate limiting
      // Call 1: New stock
      const stockNew = await this.safeGetPriceGuide(part, 'N', 'stock');
      await delay(REQUEST_DELAY_MS);

      // Call 2: Used stock
      const stockUsed = await this.safeGetPriceGuide(part, 'U', 'stock');
      await delay(REQUEST_DELAY_MS);

      // Call 3: New sold data (for sell-through calculation)
      const soldNew = await this.safeGetPriceGuide(part, 'N', 'sold');
      await delay(REQUEST_DELAY_MS);

      // Call 4: Used sold data (for sell-through calculation)
      const soldUsed = await this.safeGetPriceGuide(part, 'U', 'sold');

      // Log when we can't get prices
      if (!stockNew && !stockUsed) {
        console.warn(
          `[PartoutService] No price data for ${part.partType} ${part.partNumber} color ${part.colourId}`
        );
      }

      // Extract stock and sold quantities (unit_quantity = number of lots/transactions)
      const stockAvailableNew = stockNew?.unit_quantity ?? null;
      const stockAvailableUsed = stockUsed?.unit_quantity ?? null;
      const timesSoldNew = soldNew?.unit_quantity ?? null;
      const timesSoldUsed = soldUsed?.unit_quantity ?? null;

      // Calculate sell-through rates: (times sold / stock available) * 100
      const sellThroughRateNew =
        stockAvailableNew && timesSoldNew && stockAvailableNew > 0
          ? (timesSoldNew / stockAvailableNew) * 100
          : null;
      const sellThroughRateUsed =
        stockAvailableUsed && timesSoldUsed && stockAvailableUsed > 0
          ? (timesSoldUsed / stockAvailableUsed) * 100
          : null;

      // Parse prices from SOLD data (actual sale prices, not asking prices)
      // Fall back to stock prices if no sold data available
      const priceNew =
        soldNew && soldNew.total_quantity > 0
          ? parseFloat(soldNew.avg_price)
          : stockNew && stockNew.total_quantity > 0
            ? parseFloat(stockNew.avg_price)
            : null;
      const priceUsed =
        soldUsed && soldUsed.total_quantity > 0
          ? parseFloat(soldUsed.avg_price)
          : stockUsed && stockUsed.total_quantity > 0
            ? parseFloat(stockUsed.avg_price)
            : null;

      return {
        partNumber: part.partNumber,
        partType: part.partType,
        colourId: part.colourId,
        colourName: part.colourName ?? null,
        priceNew: priceNew && priceNew > 0 ? priceNew : null,
        priceUsed: priceUsed && priceUsed > 0 ? priceUsed : null,
        sellThroughRateNew,
        sellThroughRateUsed,
        stockAvailableNew,
        stockAvailableUsed,
        timesSoldNew,
        timesSoldUsed,
      };
    } catch (error) {
      console.error(`[PartoutService] Error fetching price for ${part.partNumber}:`, error);
      return null;
    }
  }

  /**
   * Safe wrapper for getPartPriceGuide that handles errors gracefully
   * Returns null on normal errors (404, etc.) but re-throws RateLimitError
   */
  private async safeGetPriceGuide(
    part: PartIdentifier,
    condition: 'N' | 'U',
    guideType: 'stock' | 'sold'
  ): Promise<{ avg_price: string; total_quantity: number; unit_quantity: number } | null> {
    try {
      const result = await this.brickLinkClient.getPartPriceGuide(
        part.partType,
        part.partNumber,
        part.colourId,
        {
          condition,
          guideType,
          countryCode: 'UK',
          currencyCode: 'GBP',
        }
      );
      return result;
    } catch (error) {
      // Re-throw rate limit errors so the batch processor can stop
      if (error instanceof RateLimitError) {
        throw error;
      }
      // Log and return null for other errors (404 not found, etc.)
      console.warn(
        `[PartoutService] safeGetPriceGuide failed for ${part.partNumber} (${condition}/${guideType}):`,
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }

  /**
   * Get the price for the complete set
   */
  private async getSetPrice(setNumber: string, condition: 'N' | 'U'): Promise<number | null> {
    try {
      const priceGuide = await this.brickLinkClient.getSetPriceGuide(setNumber, {
        condition,
      });
      return priceGuide ? parseFloat(priceGuide.avg_price) : null;
    } catch (error) {
      console.warn(`[PartoutService] Could not get set price for ${setNumber}:`, error);
      return null;
    }
  }

  /**
   * Build the parts list combining cached and fresh data
   */
  private buildPartsList(
    cached: CachedPartWithIdentifier[],
    freshPrices: PartPriceData[],
    allParts: PartIdentifier[]
  ): PartValue[] {
    const partValues: PartValue[] = [];

    // Create a map of fresh prices for easy lookup
    const freshMap = new Map<string, PartPriceData>();
    for (const price of freshPrices) {
      const key = `${price.partNumber}:${price.colourId}`;
      freshMap.set(key, price);
    }

    // Process cached parts
    for (const cachedPart of cached) {
      const priceNew = cachedPart.priceNew ?? 0;
      const priceUsed = cachedPart.priceUsed ?? 0;

      partValues.push({
        partNumber: cachedPart.partNumber,
        partType: cachedPart.partType as BrickLinkItemType,
        name: cachedPart.name,
        colourId: cachedPart.colourId,
        colourName: cachedPart.colourName ?? 'Unknown',
        imageUrl: getPartImageUrl(
          cachedPart.partType as BrickLinkItemType,
          cachedPart.partNumber,
          cachedPart.colourId
        ),
        quantity: cachedPart.quantity,
        priceNew: cachedPart.priceNew,
        priceUsed: cachedPart.priceUsed,
        totalNew: priceNew * cachedPart.quantity,
        totalUsed: priceUsed * cachedPart.quantity,
        sellThroughRateNew: cachedPart.sellThroughRateNew,
        sellThroughRateUsed: cachedPart.sellThroughRateUsed,
        stockAvailableNew: cachedPart.stockAvailableNew,
        stockAvailableUsed: cachedPart.stockAvailableUsed,
        timesSoldNew: cachedPart.timesSoldNew,
        timesSoldUsed: cachedPart.timesSoldUsed,
        fromCache: true,
      });
    }

    // Process parts that were fetched from API
    for (const price of freshPrices) {
      // Find the original part to get name and quantity
      const originalPart = allParts.find(
        (p) => p.partNumber === price.partNumber && p.colourId === price.colourId
      );

      if (!originalPart) continue;

      const priceNew = price.priceNew ?? 0;
      const priceUsed = price.priceUsed ?? 0;

      partValues.push({
        partNumber: price.partNumber,
        partType: price.partType as BrickLinkItemType,
        name: originalPart.name,
        colourId: price.colourId,
        colourName: price.colourName ?? originalPart.colourName ?? 'Unknown',
        imageUrl: getPartImageUrl(
          price.partType as BrickLinkItemType,
          price.partNumber,
          price.colourId
        ),
        quantity: originalPart.quantity,
        priceNew: price.priceNew,
        priceUsed: price.priceUsed,
        totalNew: priceNew * originalPart.quantity,
        totalUsed: priceUsed * originalPart.quantity,
        sellThroughRateNew: price.sellThroughRateNew,
        sellThroughRateUsed: price.sellThroughRateUsed,
        stockAvailableNew: price.stockAvailableNew,
        stockAvailableUsed: price.stockAvailableUsed,
        timesSoldNew: price.timesSoldNew,
        timesSoldUsed: price.timesSoldUsed,
        fromCache: false,
      });
    }

    // Handle parts with no price data (neither cached nor fetched)
    const processedKeys = new Set([
      ...cached.map((c) => `${c.partNumber}:${c.colourId}`),
      ...freshPrices.map((f) => `${f.partNumber}:${f.colourId}`),
    ]);

    for (const part of allParts) {
      const key = `${part.partNumber}:${part.colourId}`;
      if (!processedKeys.has(key)) {
        // Part has no price data
        partValues.push({
          partNumber: part.partNumber,
          partType: part.partType,
          name: part.name,
          colourId: part.colourId,
          colourName: part.colourName ?? 'Unknown',
          imageUrl: getPartImageUrl(part.partType, part.partNumber, part.colourId),
          quantity: part.quantity,
          priceNew: null,
          priceUsed: null,
          totalNew: 0,
          totalUsed: 0,
          sellThroughRateNew: null,
          sellThroughRateUsed: null,
          stockAvailableNew: null,
          stockAvailableUsed: null,
          timesSoldNew: null,
          timesSoldUsed: null,
          fromCache: false,
        });
      }
    }

    return partValues;
  }

  /**
   * Create an empty result for sets with no parts
   */
  private createEmptyResult(setNumber: string): PartoutData {
    return {
      setNumber,
      totalParts: 0,
      povNew: 0,
      povUsed: 0,
      setPrice: { new: null, used: null },
      ratioNew: null,
      ratioUsed: null,
      recommendation: 'sell-complete',
      cacheStats: { fromCache: 0, fromApi: 0, total: 0 },
      parts: [],
    };
  }
}
