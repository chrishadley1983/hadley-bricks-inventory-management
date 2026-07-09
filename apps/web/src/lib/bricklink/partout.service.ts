/**
 * Partout Service
 *
 * Calculates the total value of a LEGO set's individual parts if sold separately.
 * All price reads/fetches go through the unified price cache (`readPriceGuide` /
 * `ensurePriceGuide`) — every API fetch captures a complete 4-quadrant row, and
 * cached data is shared with every other price consumer.
 *
 * Semantics preserved from the legacy implementation:
 *  - prices are UK sold averages, falling back to UK stock (asking) averages
 *  - sell-through rate is LOTS-based ×100 (sold lots / stock lots)
 *  - stockAvailable and timesSold fields are lot counts
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { RateLimitError, type BrickLinkClient } from './client';
import type { BrickLinkItemType, BrickLinkSubsetEntry } from './types';
import { ensurePriceGuide } from './price-guide/capture';
import { readPriceGuide, pgKey, type ItemRef, type PgType, type PriceGuideView } from './price-guide/read';
import { loadColourMap, type ColourMap } from './colour-map';
import type {
  PartoutData,
  PartValue,
  PartIdentifier,
  PartoutProgressCallback,
} from '@/types/partout';

/** Batch size between progress events / batch delays */
const BATCH_SIZE = 10;

/** Delay between per-part fetches in milliseconds (each fetch = 4 parallel BL calls) */
const REQUEST_DELAY_MS = 500;

/** Delay between batches in milliseconds */
const BATCH_DELAY_MS = 2000;

/** Cache freshness for POV reads (matches the legacy 6-month default) */
const POV_TTL_DAYS = 180;

/** Generate BrickLink image URL for a part */
function getPartImageUrl(type: BrickLinkItemType, partNumber: string, colorId: number): string {
  // BrickLink image URL pattern
  const typeCode = type === 'MINIFIG' ? 'MN' : type === 'SET' ? 'SN' : 'PN';
  return `https://img.bricklink.com/ItemImage/${typeCode}/${colorId}/${partNumber}.png`;
}

function toPgType(type: BrickLinkItemType): PgType {
  return type === 'MINIFIG' ? 'M' : type === 'SET' ? 'S' : 'P';
}

/** Delay helper */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Partout Service
 */
export class PartoutService {
  constructor(
    private brickLinkClient: BrickLinkClient,
    private supabase: SupabaseClient
  ) {}

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

    // forceRefresh: a TTL of 0 makes every cached row count as stale, so
    // ensurePriceGuide re-fetches and re-captures each tuple.
    const ttlDays = forceRefresh ? 0 : POV_TTL_DAYS;

    // 1. Fetch colour map and parts list in parallel
    const [colourMap, subsets] = await Promise.all([
      loadColourMap(this.supabase),
      this.brickLinkClient.getSubsets('SET', setNumber, {
        breakMinifigs: false, // Keep minifigs as items, don't break into parts
        breakSets: false, // Keep included sets as items
      }),
    ]);

    // 2. Flatten parts list with colour names
    const parts = this.flattenSubsets(subsets, colourMap);
    console.log(`[PartoutService] Found ${parts.length} unique parts/colours`);

    if (parts.length === 0) {
      return this.createEmptyResult(setNumber);
    }

    // 3. Read fresh UK views from the unified cache
    const refs: ItemRef[] = parts.map((p) => ({
      itemType: toPgType(p.partType),
      itemNo: p.partNumber,
      colourId: p.colourId,
      scheme: 'bl' as const,
    }));
    const views = await readPriceGuide(this.supabase, refs, {
      ttlDays,
      allowWorldFallback: false,
    });

    const keyOf = (p: PartIdentifier) =>
      pgKey(toPgType(p.partType), p.partNumber, toPgType(p.partType) === 'P' ? p.colourId : 0);
    const isCached = (p: PartIdentifier) => views.get(keyOf(p))?.coverage === 'uk';
    const cached = parts.filter((p) => isCached(p));
    const uncached = parts.filter((p) => !isCached(p));

    // Report initial progress with cache stats (fetched=0, total=uncached, cached=cached)
    onProgress?.(0, uncached.length, cached.length);

    // 4. Fetch uncached parts in batches — each fetch captures into the unified cache
    const fetchedCount = await this.fetchUncached(uncached, views, ttlDays, cached.length, onProgress);

    // 5. Get set prices for ratio calculation (captured to the unified cache too)
    const setView = await this.getSetView(setNumber, ttlDays);
    const setPriceNew = setView ? (setView.new.stockAvg ?? setView.new.soldAvg) : null;
    const setPriceUsed = setView ? (setView.used.stockAvg ?? setView.used.soldAvg) : null;

    // 6. Build part values from the views
    const partValues = parts.map((p) => this.toPartValue(p, views.get(keyOf(p)), isCached(p)));

    // 7. Calculate totals
    const povNew = partValues.reduce((sum, p) => sum + p.totalNew, 0);
    const povUsed = partValues.reduce((sum, p) => sum + p.totalUsed, 0);

    // 8. Calculate ratios
    const ratioNew = setPriceNew ? povNew / setPriceNew : null;
    const ratioUsed = setPriceUsed ? povUsed / setPriceUsed : null;

    // 9. Determine recommendation based on new condition ratio
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
        fromApi: fetchedCount,
        total: parts.length,
      },
      parts: partValues.sort((a, b) => b.totalNew - a.totalNew), // Sort by value descending
    };
  }

  /**
   * Flatten subset entries into a list of part identifiers
   */
  private flattenSubsets(subsets: BrickLinkSubsetEntry[], colourMap: ColourMap): PartIdentifier[] {
    const parts: PartIdentifier[] = [];

    for (const subset of subsets) {
      for (const entry of subset.entries) {
        // Skip alternates and counterparts - only include primary parts
        if (entry.is_alternate || entry.is_counterpart) {
          continue;
        }

        // Colour ids in subsets are BL-scheme; name from the canonical map
        const colourName = colourMap.name(entry.color_id) || entry.color_name || 'Unknown';

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
   * Fetch views for uncached parts via ensurePriceGuide, updating `views` in place.
   * Sequential with delays to respect BrickLink rate limits; stops on RateLimitError.
   * Returns the number of parts fetched.
   */
  private async fetchUncached(
    parts: PartIdentifier[],
    views: Map<string, PriceGuideView>,
    ttlDays: number,
    cachedCount: number,
    onProgress?: PartoutProgressCallback
  ): Promise<number> {
    if (parts.length === 0) {
      return 0;
    }

    console.log(
      `[PartoutService] Fetching ${parts.length} uncached parts from BrickLink (sequential with ${REQUEST_DELAY_MS}ms delay)`
    );

    let fetchedCount = 0;
    let rateLimitHit = false;

    for (let i = 0; i < parts.length && !rateLimitHit; i += BATCH_SIZE) {
      const batch = parts.slice(i, i + BATCH_SIZE);

      for (let j = 0; j < batch.length && !rateLimitHit; j++) {
        const part = batch[j];
        const itemType = toPgType(part.partType);

        try {
          const view = await ensurePriceGuide(
            this.brickLinkClient,
            this.supabase,
            { itemType, itemNo: part.partNumber, colourId: part.colourId },
            { ttlDays }
          );
          views.set(pgKey(itemType, part.partNumber, itemType === 'P' ? part.colourId : 0), view);
          fetchedCount++;
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
        `[PartoutService] Rate limit stopped fetching. Got ${fetchedCount}/${parts.length} parts before limit.`
      );
    } else {
      console.log(`[PartoutService] Fetched ${fetchedCount}/${parts.length} prices from API`);
    }
    return fetchedCount;
  }

  /** Build a PartValue from a price view (or an empty one when no data). */
  private toPartValue(part: PartIdentifier, view: PriceGuideView | undefined, fromCache: boolean): PartValue {
    const hasData = view != null && view.coverage === 'uk';
    const priceNew = hasData ? (view.new.soldAvg ?? view.new.stockAvg) : null;
    const priceUsed = hasData ? (view.used.soldAvg ?? view.used.stockAvg) : null;

    return {
      partNumber: part.partNumber,
      partType: part.partType,
      name: part.name,
      colourId: part.colourId,
      colourName: part.colourName ?? 'Unknown',
      imageUrl: getPartImageUrl(part.partType, part.partNumber, part.colourId),
      quantity: part.quantity,
      priceNew,
      priceUsed,
      totalNew: (priceNew ?? 0) * part.quantity,
      totalUsed: (priceUsed ?? 0) * part.quantity,
      sellThroughRateNew: hasData && view.new.strLots !== null ? view.new.strLots * 100 : null,
      sellThroughRateUsed: hasData && view.used.strLots !== null ? view.used.strLots * 100 : null,
      stockAvailableNew: hasData ? view.new.stockLots : null,
      stockAvailableUsed: hasData ? view.used.stockLots : null,
      timesSoldNew: hasData ? view.new.soldLots : null,
      timesSoldUsed: hasData ? view.used.soldLots : null,
      fromCache: hasData && fromCache,
    };
  }

  /**
   * Get the price view for the complete set (ensures + captures on miss)
   */
  private async getSetView(setNumber: string, ttlDays: number): Promise<PriceGuideView | null> {
    try {
      return await ensurePriceGuide(
        this.brickLinkClient,
        this.supabase,
        { itemType: 'S', itemNo: setNumber, colourId: 0 },
        { ttlDays }
      );
    } catch (error) {
      console.warn(`[PartoutService] Could not get set price for ${setNumber}:`, error);
      return null;
    }
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
