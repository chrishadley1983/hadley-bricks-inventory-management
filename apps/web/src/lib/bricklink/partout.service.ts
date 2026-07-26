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
 *  - stockAvailable and timesSold are QUANTITIES (pieces), matching the qty-basis STR
 *    the whole screen gates on. They were lot counts, which put two different
 *    denominators on one table row: njo0658 showed Stock 12 / Sold 6 next to STR 0.02,
 *    because 12 listings held 333 pieces. Same basis everywhere now, so Sold ÷ Stock
 *    visibly reconciles with the STR column.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { RateLimitError, type BrickLinkClient } from './client';
import type { BrickLinkItemType, BrickLinkSubsetEntry } from './types';
import { ensurePriceGuide } from './price-guide/capture';
import {
  readPriceGuide,
  pgKey,
  type ItemRef,
  type PgType,
  type PriceGuideView,
} from './price-guide/read';
import { loadColourMap, type ColourMap } from './colour-map';
import { readWorldSupply, type WorldSupply } from './world-supply';
import { assessPartoutBoth } from './partout-assessment';
import {
  loadOwnStockIndex,
  classifyOverlap,
  type OwnStockIndex,
} from '@/lib/bl-store-assessment/overlap';
import type { ItemTypeCode } from '@/lib/bl-store-assessment/types';
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
 * BrickLink catalogue set numbers carry a sequence suffix ("75192-1"). Asked for a bare
 * "75192" the API answers `PARAMETER_MISSING_OR_INVALID / Invalid item sequence number:
 * null`, which surfaced as an opaque 500. The Set Lookup page happens to pass the
 * Brickset-canonical suffixed form, so the screen worked while the route did not —
 * normalise here so every caller behaves the same.
 *
 * Only bare digits are defaulted to "-1". Anything already carrying a suffix, or a
 * non-numeric identifier, is passed through untouched.
 */
export function normaliseSetNumber(setNumber: string): string {
  const trimmed = setNumber.trim();
  return /^\d+$/.test(trimmed) ? `${trimmed}-1` : trimmed;
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
   * What would a full part-out run COST, without running it?
   *
   * The single-screen layout removed the tab that used to gate this, so the run has to be
   * explicit — and to be explicit it has to be quantified. This does steps 1-3 of
   * getPartoutValue (colour map, subsets, cache read) and stops before fetching anything
   * uncached.
   *
   * Cost: ONE BrickLink call (getSubsets). Each uncached lot then costs FOUR — the
   * quadrants are fetched in parallel per part (sold/stock x new/used), and the standard
   * pattern requires all four so the shared cache gets a complete row.
   */
  async estimatePartoutCost(rawSetNumber: string): Promise<{
    setNumber: string;
    totalLots: number;
    cachedLots: number;
    uncachedLots: number;
    /** BrickLink calls a full run would make from here. */
    estimatedApiCalls: number;
  }> {
    const setNumber = normaliseSetNumber(rawSetNumber);

    const [colourMap, subsets] = await Promise.all([
      loadColourMap(this.supabase),
      this.brickLinkClient.getSubsets('SET', setNumber, {
        breakMinifigs: false,
        breakSets: false,
      }),
    ]);

    const parts = this.flattenSubsets(subsets, colourMap);
    if (parts.length === 0) {
      return {
        setNumber,
        totalLots: 0,
        cachedLots: 0,
        uncachedLots: 0,
        estimatedApiCalls: 0,
      };
    }

    const refs: ItemRef[] = parts.map((p) => ({
      itemType: toPgType(p.partType),
      itemNo: p.partNumber,
      colourId: p.colourId,
      scheme: 'bl' as const,
    }));
    const views = await readPriceGuide(this.supabase, refs, {
      ttlDays: POV_TTL_DAYS,
      allowWorldFallback: false,
    });

    const keyOf = (p: PartIdentifier) =>
      pgKey(toPgType(p.partType), p.partNumber, toPgType(p.partType) === 'P' ? p.colourId : 0);
    const cachedLots = parts.filter((p) => views.get(keyOf(p))?.coverage === 'uk').length;
    const uncachedLots = parts.length - cachedLots;

    return {
      setNumber,
      totalLots: parts.length,
      cachedLots,
      uncachedLots,
      // 4 quadrants per uncached lot, plus one more getSubsets and the set-price lookup.
      estimatedApiCalls: uncachedLots * 4 + (uncachedLots > 0 ? 5 : 1),
    };
  }

  /**
   * Get the complete partout value analysis for a set
   * @param setNumber Set number (e.g., "75192-1")
   * @param options Options for the partout calculation
   * @returns Complete partout analysis data
   */
  async getPartoutValue(
    rawSetNumber: string,
    options: {
      onProgress?: PartoutProgressCallback;
      forceRefresh?: boolean;
      /**
       * When supplied, the set's lots are classified against our own Bricqer stock
       * (NEW / RESTOCK_OUT / RESTOCK_THIN / DUPLICATE). Omit to skip the overlap
       * read entirely — the assessment then reports `overlap: null` rather than
       * pretending we hold nothing.
       */
      userId?: string;
    } = {}
  ): Promise<PartoutData> {
    const { onProgress, forceRefresh = false, userId } = options;
    const setNumber = normaliseSetNumber(rawSetNumber);
    console.log(
      `[PartoutService] Getting partout value for set ${setNumber}${
        setNumber !== rawSetNumber.trim() ? ` (normalised from "${rawSetNumber}")` : ''
      }${forceRefresh ? ' (force refresh)' : ''}`
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
    const fetchedCount = await this.fetchUncached(
      uncached,
      views,
      ttlDays,
      cached.length,
      onProgress
    );

    // 5. Get set prices for ratio calculation (captured to the unified cache too),
    //    plus the two decision inputs the assessment needs: worldwide supply for
    //    magnets and our own stock index for overlap. Neither is on the critical
    //    path for POV, so a failure degrades the assessment rather than the page.
    const [setView, supply, ownStock] = await Promise.all([
      this.getSetView(setNumber, ttlDays),
      this.readSupplySafely(parts),
      this.readOwnStockSafely(userId),
    ]);
    const setPriceNew = setView ? (setView.new.stockAvg ?? setView.new.soldAvg) : null;
    const setPriceUsed = setView ? (setView.used.stockAvg ?? setView.used.soldAvg) : null;

    // 6. Build part values from the views
    const partValues = parts.map((p) =>
      this.toPartValue(p, views.get(keyOf(p)), isCached(p), supply.get(keyOf(p)), ownStock)
    );

    // 7. Calculate totals
    const povNew = partValues.reduce((sum, p) => sum + p.totalNew, 0);
    const povUsed = partValues.reduce((sum, p) => sum + p.totalUsed, 0);

    // 8. Calculate ratios
    const ratioNew = setPriceNew ? povNew / setPriceNew : null;
    const ratioUsed = setPriceUsed ? povUsed / setPriceUsed : null;

    // 9. Legacy headline recommendation. Kept for back-compat with existing
    //    consumers, but it is the OLD gross ratio > 1 test — the canonical verdict
    //    (fee- and liquidity-aware, gated at POV_MULTIPLE_MIN) lives on `assessment`.
    const recommendation = ratioNew !== null && ratioNew > 1 ? 'part-out' : 'sell-complete';

    // 10. Canonical assessment: honesty ladder, part-out gate, STR bands, magnets,
    //     value concentration and store overlap — per condition.
    const assessment = assessPartoutBoth(
      partValues,
      { new: setPriceNew, used: setPriceUsed },
      {
        overlapMeta: ownStock
          ? { snapshotAt: ownStock.snapshotAt, salesWindowDays: ownStock.salesWindowDays }
          : null,
      }
    );

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
      assessment,
    };
  }

  /**
   * Worldwide supply for magnet detection. Non-fatal: without it magnets simply
   * don't fire, which is the honest outcome — we can't claim scarcity we can't see.
   */
  private async readSupplySafely(parts: PartIdentifier[]): Promise<Map<string, WorldSupply>> {
    try {
      return await readWorldSupply(
        this.supabase,
        parts.map((p) => ({
          itemType: toPgType(p.partType),
          itemNo: p.partNumber,
          blColourId: toPgType(p.partType) === 'P' ? p.colourId : 0,
        }))
      );
    } catch (error) {
      console.warn('[PartoutService] World supply read failed; magnets disabled:', error);
      return new Map();
    }
  }

  /**
   * Our own stock index for overlap tagging. Non-fatal and skipped entirely when no
   * userId was supplied.
   */
  private async readOwnStockSafely(userId: string | undefined): Promise<OwnStockIndex | null> {
    if (!userId) return null;
    try {
      return await loadOwnStockIndex(this.supabase, userId);
    } catch (error) {
      console.warn('[PartoutService] Own-stock index failed; overlap disabled:', error);
      return null;
    }
  }

  /**
   * Flatten subset entries into a list of part identifiers
   */
  private flattenSubsets(subsets: BrickLinkSubsetEntry[], colourMap: ColourMap): PartIdentifier[] {
    // MERGED BY part+colour, not appended.
    //
    // BrickLink returns subsets grouped, and the same part+colour can legitimately appear
    // in more than one group (71741 lists 98138pb027 White twice, qty 2 and qty 1). Kept
    // as separate rows that produced a duplicate lot for a single sellable lot: the parts
    // table rendered two rows with the same React key — which is what made a sorted column
    // put an out-of-place row at the top — and every lot COUNT was inflated (1,145 rows for
    // 1,141 real lots), which feeds pricedLots, the STR bands and the concentration split.
    //
    // Quantities are summed, which is both the correct total and how we would actually
    // list it: one lot of 3, not a lot of 2 and a lot of 1.
    const merged = new Map<string, PartIdentifier>();

    for (const subset of subsets) {
      for (const entry of subset.entries) {
        // Skip alternates and counterparts - only include primary parts
        if (entry.is_alternate || entry.is_counterpart) {
          continue;
        }

        // Colour ids in subsets are BL-scheme; name from the canonical map
        const colourName = colourMap.name(entry.color_id) || entry.color_name || 'Unknown';
        const key = `${entry.item.type}:${entry.item.no}:${entry.color_id}`;

        const existing = merged.get(key);
        if (existing) {
          existing.quantity += entry.quantity;
          continue;
        }

        merged.set(key, {
          partNumber: entry.item.no,
          partType: entry.item.type,
          colourId: entry.color_id,
          colourName,
          name: entry.item.name,
          quantity: entry.quantity,
        });
      }
    }

    return [...merged.values()];
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
  private toPartValue(
    part: PartIdentifier,
    view: PriceGuideView | undefined,
    fromCache: boolean,
    supply: WorldSupply | undefined,
    ownStock: OwnStockIndex | null
  ): PartValue {
    const hasData = view != null && view.coverage === 'uk';
    const priceNew = hasData ? (view.new.soldAvg ?? view.new.stockAvg) : null;
    const priceUsed = hasData ? (view.used.soldAvg ?? view.used.stockAvg) : null;

    // Overlap is condition-specific: holding 40 of a part in Used says nothing about
    // whether we're short of it in New.
    const itemType: ItemTypeCode = part.partType === 'MINIFIG' ? 'M' : 'P';
    const blColourId = itemType === 'P' ? part.colourId : 0;
    const overlapFor = (condition: 'N' | 'U') =>
      classifyOverlap(
        {
          itemType,
          itemNo: part.partNumber,
          blColourId,
          colourName: part.colourName ?? null,
          condition,
        },
        ownStock
      );
    const overlapN = overlapFor('N');
    const overlapU = overlapFor('U');

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
      // Qty-basis STR as a fraction — what every gate, magnet test and capture-curve
      // lookup consumes. Deliberately NOT the ×100 lots-basis fields above.
      strQtyNew: hasData ? view.new.strQty : null,
      strQtyUsed: hasData ? view.used.strQty : null,
      worldSupplyLotsNew: supply?.stockLotsNew ?? null,
      worldSupplyLotsUsed: supply?.stockLotsUsed ?? null,
      overlapNew: overlapN.tag,
      overlapUsed: overlapU.tag,
      ourQtyNew: overlapN.ourQty,
      ourQtyUsed: overlapU.ourQty,
      stockAvailableNew: hasData ? view.new.stockQty : null,
      stockAvailableUsed: hasData ? view.used.stockQty : null,
      timesSoldNew: hasData ? view.new.soldQty : null,
      timesSoldUsed: hasData ? view.used.soldQty : null,
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
      // No parts means nothing to assess — null rather than a zeroed assessment that
      // would render as a confident "SKIP" verdict on data we never had.
      assessment: null,
    };
  }
}
