/**
 * ASIN Matching Service
 *
 * Matches LEGO set numbers to ASINs via the seeded_asins table.
 * Also fetches Amazon pricing for matched ASINs.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { toBricksetFormat, fromBricksetFormat } from '@/lib/utils/set-number-extraction';

export interface AsinMatch {
  setNumber: string;
  asin: string | null;
  ukRetailPrice: number | null;
  setName: string | null;
}

export interface AsinWithPricing extends AsinMatch {
  buyBoxPrice: number | null;
  wasPrice: number | null;
}

/**
 * Service for matching LEGO set numbers to ASINs
 */
export class AsinMatchingService {
  constructor(private supabase: SupabaseClient<Database>) {}

  /**
   * Match a single set number to its ASIN
   *
   * @param setNumber - Raw set number (e.g., "75192")
   * @returns ASIN match result or null if not found
   */
  async matchSingle(setNumber: string): Promise<AsinMatch | null> {
    const results = await this.matchMultiple([setNumber]);
    return results.get(setNumber) || null;
  }

  /**
   * Match multiple set numbers to their ASINs
   *
   * @param setNumbers - Array of raw set numbers (e.g., ["75192", "10300"])
   * @returns Map of set number to ASIN match result
   */
  async matchMultiple(setNumbers: string[]): Promise<Map<string, AsinMatch>> {
    const results = new Map<string, AsinMatch>();

    if (setNumbers.length === 0) {
      return results;
    }

    // Convert to Brickset format for lookup
    const bricksetNumbers = setNumbers.map((s) => toBricksetFormat(s));

    // First, get all brickset_sets data (for set names even without ASINs)
    const { data: bricksetSets, error: bricksetError } = await this.supabase
      .from('brickset_sets')
      .select('id, set_number, set_name, uk_retail_price')
      .in('set_number', bricksetNumbers);

    if (bricksetError) {
      console.error('[AsinMatchingService] Brickset query error:', bricksetError);
      return results;
    }

    // Build a map of brickset_set_id to brickset data
    const bricksetById = new Map<string, { set_number: string; set_name: string; uk_retail_price: number | null }>();
    const bricksetByNumber = new Map<string, { id: string; set_number: string; set_name: string; uk_retail_price: number | null }>();

    bricksetSets?.forEach((bs) => {
      bricksetById.set(bs.id, { set_number: bs.set_number, set_name: bs.set_name, uk_retail_price: bs.uk_retail_price });
      bricksetByNumber.set(bs.set_number, bs);
    });

    // Initialize results with brickset data (no ASIN yet)
    bricksetSets?.forEach((bs) => {
      const rawSetNumber = fromBricksetFormat(bs.set_number);
      results.set(rawSetNumber, {
        setNumber: rawSetNumber,
        asin: null,
        ukRetailPrice: bs.uk_retail_price,
        setName: bs.set_name,
      });
    });

    // Now get ASINs for sets that have them discovered
    const bricksetIds = bricksetSets?.map((bs) => bs.id) ?? [];
    if (bricksetIds.length > 0) {
      const { data: seededAsins, error: asinError } = await this.supabase
        .from('seeded_asins')
        .select('asin, brickset_set_id')
        .in('brickset_set_id', bricksetIds)
        .eq('discovery_status', 'found');

      if (asinError) {
        console.error('[AsinMatchingService] ASIN query error:', asinError);
        // Return results with set names but no ASINs
        return results;
      }

      // Update results with ASIN data
      seededAsins?.forEach((sa) => {
        const brickset = bricksetById.get(sa.brickset_set_id);
        if (brickset) {
          const rawSetNumber = fromBricksetFormat(brickset.set_number);
          const existing = results.get(rawSetNumber);
          if (existing) {
            existing.asin = sa.asin;
          }
        }
      });
    }

    return results;
  }

  /**
   * Get ASIN for a set number (simple lookup)
   *
   * @param setNumber - Raw set number
   * @returns ASIN or null if not found
   */
  async getAsin(setNumber: string): Promise<string | null> {
    const match = await this.matchSingle(setNumber);
    return match?.asin || null;
  }

  /**
   * Get UK RRP for a set number
   *
   * @param setNumber - Raw set number
   * @returns UK RRP or null if not found
   */
  async getUkRrp(setNumber: string): Promise<number | null> {
    const match = await this.matchSingle(setNumber);
    return match?.ukRetailPrice || null;
  }

  /**
   * Get set name for a set number
   *
   * @param setNumber - Raw set number
   * @returns Set name or null if not found
   */
  async getSetName(setNumber: string): Promise<string | null> {
    const match = await this.matchSingle(setNumber);
    return match?.setName || null;
  }

  /**
   * Get Amazon price for a set number
   * First tries Buy Box price, falls back to UK RRP
   *
   * @param setNumber - Raw set number
   * @param amazonClient - Optional Amazon pricing client for Buy Box lookup
   * @returns Price or null if not found
   */
  async getAmazonPrice(
    setNumber: string,
    amazonClient?: { getCompetitivePricing: (asins: string[]) => Promise<Array<{ asin: string; buyBoxPrice: number | null }>> }
  ): Promise<number | null> {
    const match = await this.matchSingle(setNumber);
    if (!match) {
      return null;
    }

    // If we have an Amazon client and ASIN, try Buy Box first
    if (amazonClient && match.asin) {
      try {
        const pricing = await amazonClient.getCompetitivePricing([match.asin]);
        const asinPricing = pricing.find((p) => p.asin === match.asin);
        if (asinPricing?.buyBoxPrice) {
          return asinPricing.buyBoxPrice;
        }
      } catch (err) {
        console.warn('[AsinMatchingService] Amazon pricing failed, using RRP fallback:', err);
      }
    }

    // Fall back to UK RRP
    return match.ukRetailPrice;
  }

  /**
   * Get Amazon prices for multiple set numbers
   *
   * @param setNumbers - Array of raw set numbers
   * @param amazonClient - Optional Amazon pricing client
   * @returns Map of set number to price
   */
  async getAmazonPrices(
    setNumbers: string[],
    amazonClient?: {
      getCompetitivePricing: (asins: string[]) => Promise<Array<{ asin: string; buyBoxPrice: number | null }>>;
      getCompetitiveSummary?: (asins: string[]) => Promise<Array<{ asin: string; wasPrice: number | null; lowestOffer?: { totalPrice: number } | null }>>;
    }
  ): Promise<Map<string, AsinWithPricing>> {
    const matches = await this.matchMultiple(setNumbers);
    const results = new Map<string, AsinWithPricing>();

    // Initialize results with RRP fallback
    for (const [setNumber, match] of matches) {
      results.set(setNumber, {
        ...match,
        buyBoxPrice: null,
        wasPrice: null,
      });
    }

    // If no Amazon client, return with RRP only
    if (!amazonClient) {
      return results;
    }

    // Get ASINs that need pricing
    const asinsToPrice = [...matches.values()]
      .filter((m) => m.asin)
      .map((m) => m.asin!);

    if (asinsToPrice.length === 0) {
      return results;
    }

    // Build ASIN to set number map
    const asinToSet = new Map<string, string>();
    for (const [setNumber, match] of matches) {
      if (match.asin) {
        asinToSet.set(match.asin, setNumber);
      }
    }

    // Fetch Buy Box prices
    try {
      const pricing = await amazonClient.getCompetitivePricing(asinsToPrice);
      for (const p of pricing) {
        const setNumber = asinToSet.get(p.asin);
        if (setNumber && results.has(setNumber)) {
          const current = results.get(setNumber)!;
          current.buyBoxPrice = p.buyBoxPrice;
        }
      }
    } catch (err) {
      console.warn('[AsinMatchingService] Competitive pricing failed:', err);
    }

    // Fetch Was Prices if available (limit to 20 for rate limiting)
    if (amazonClient.getCompetitiveSummary) {
      try {
        const limitedAsins = asinsToPrice.slice(0, 20);
        const summaries = await amazonClient.getCompetitiveSummary(limitedAsins);
        for (const s of summaries) {
          const setNumber = asinToSet.get(s.asin);
          if (setNumber && results.has(setNumber)) {
            const current = results.get(setNumber)!;
            current.wasPrice = s.wasPrice;
            // If no Buy Box but have lowest offer, use that
            if (!current.buyBoxPrice && s.lowestOffer?.totalPrice) {
              current.buyBoxPrice = s.lowestOffer.totalPrice;
            }
          }
        }
      } catch (err) {
        console.warn('[AsinMatchingService] Competitive summary failed:', err);
      }
    }

    return results;
  }
}
