/**
 * eBay Auction Scanner Service
 *
 * Searches for LEGO auctions ending soon on eBay, identifies set numbers,
 * looks up Amazon pricing, calculates profit, and returns opportunities.
 *
 * Token-efficient design:
 * - Single Browse API call with AUCTION filter sorted by endingSoonest
 * - Amazon pricing looked up from local seeded_asin_pricing table (no API calls)
 * - Deduplication against previously alerted auctions
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getEbayBrowseClient, type EbayItemSummary } from '@/lib/ebay/ebay-browse.client';
import { KeepaClient } from '@/lib/keepa/keepa-client';
import { BricksetApiClient } from '@/lib/brickset/brickset-api';
import { BricksetCredentialsService } from '@/lib/services/brickset-credentials.service';
import { apiSetToInternal, internalToDbInsert } from '@/lib/brickset/types';
import { calculateAuctionProfit } from './auction-profit-calculator';
import {
  extractSetNumbers,
  isFalsePositive,
  isJoblot,
  isNewSealed,
  extractJoblotSets,
} from './set-identifier';
import type {
  EbayAuctionConfig,
  EbayAuctionItem,
  AmazonPricingData,
  AuctionOpportunity,
  JoblotOpportunity,
  JoblotSetEntry,
  ScanResult,
  AuctionEvaluation,
  PovData,
} from './types';

const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';

/**
 * Extended item summary with auction-specific fields from eBay Browse API
 */
interface AuctionItemSummary extends EbayItemSummary {
  currentBidPrice?: { value: string; currency: string };
  itemEndDate?: string;
  bidCount?: number;
  buyingOptions?: string[];
}

export class EbayAuctionScannerService {
  private supabase: SupabaseClient;
  private apiCallsMade = 0;
  private keepaCallsMade = 0;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Run a full scan cycle.
   * Returns opportunities found and scan statistics.
   */
  async scan(config: EbayAuctionConfig): Promise<ScanResult> {
    const startTime = Date.now();
    this.apiCallsMade = 0;
    this.keepaCallsMade = 0;
    const evaluations: AuctionEvaluation[] = [];

    try {
      // 1. Check quiet hours
      if (this.isInQuietHours(config)) {
        return this.createSkippedResult(startTime, 'quiet_hours');
      }

      if (!config.enabled) {
        return this.createSkippedResult(startTime, 'disabled');
      }

      // 2. Search eBay for auctions ending soon
      const auctionItems = await this.searchEndingSoonAuctions(config);

      // An empty NEW search must not skip the opt-in USED scan (step 5b) —
      // all downstream steps are safe on an empty item list.
      if (auctionItems.length === 0 && !config.usedPovModeEnabled) {
        return this.createResult(startTime, { auctionsFound: 0, evaluations: [] });
      }

      // 3. Categorize auctions and build per-auction evaluation records
      const { singles, joblots } = this.categorizeAuctions(auctionItems, config, evaluations);

      // 4. Look up Amazon pricing for ALL identified sets (including filtered ones for debug)
      const allEvalSetNumbers = evaluations
        .filter((e) => e.setNumber)
        .map((e) => e.setNumber!);
      const joblotSetNumbers = joblots.flatMap((j) => j.setNumbers);
      const uniqueSetNumbers = [...new Set([...allEvalSetNumbers, ...joblotSetNumbers])];
      const amazonPricing = await this.lookupAmazonPricing(uniqueSetNumbers);

      // 4c. Part-Out-Value (cache-only) for the same sets — drives the hybrid buy signal.
      const povData = await this.lookupPovBatch(uniqueSetNumbers);

      // 4b. Backfill Amazon data on ALL evaluations (even filtered ones) for debug visibility
      for (const ev of evaluations) {
        if (ev.setNumber && !ev.amazonPrice) {
          const amazon = amazonPricing.get(ev.setNumber);
          if (amazon) {
            ev.amazonPrice = amazon.amazonPrice;
            ev.amazon90dAvg = amazon.was90dAvg;
            ev.amazonAsin = amazon.asin;
            ev.amazonSalesRank = amazon.salesRank;
            ev.amazonSetName = amazon.setName;
          }
        }
      }

      // 5. Calculate opportunities for single sets (updates evaluations in-place).
      //    New-condition path: Amazon margin OR (povBuyEnabled && New POV >= povMultiple).
      const newSingleOpps = this.evaluateSingleOpportunities(singles, amazonPricing, povData, config, evaluations);

      // 5b. Opt-in: scan USED auctions, judged purely on Used POV >= povMultiple × cost.
      const usedSingleOpps = config.usedPovModeEnabled
        ? await this.scanUsedPov(config, evaluations)
        : [];

      const opportunities = [...newSingleOpps, ...usedSingleOpps];

      // 6. Evaluate joblots
      const joblotOpps = config.joblotAnalysisEnabled
        ? this.evaluateJoblotOpportunities(joblots, amazonPricing, config)
        : [];

      // 7. Deduplicate against previously alerted auctions
      const alreadyAlertedIds = await this.getAlreadyAlertedIds(config.userId || DEFAULT_USER_ID, [
        ...opportunities.map((o) => o.auction.itemId),
        ...joblotOpps.map((j) => j.auction.itemId),
      ]);

      const newOpportunities = opportunities.filter((o) => {
        if (alreadyAlertedIds.has(o.auction.itemId)) {
          // Update the evaluation record for this item
          const ev = evaluations.find((e) => e.itemId === o.auction.itemId);
          if (ev) {
            ev.filterReason = 'already_alerted';
            ev.alertTier = null;
          }
          return false;
        }
        return true;
      });

      const newJoblots = joblotOpps.filter((j) => !alreadyAlertedIds.has(j.auction.itemId));

      return {
        auctionsFound: auctionItems.length,
        auctionsWithSets: singles.length + joblots.length,
        opportunitiesFound: newOpportunities.length,
        alertsSent: 0, // Caller handles sending
        joblotsFound: newJoblots.length,
        apiCallsMade: this.apiCallsMade,
        keepaCallsMade: this.keepaCallsMade,
        durationMs: Date.now() - startTime,
        opportunities: newOpportunities,
        joblots: newJoblots,
        evaluations,
      };
    } catch (error) {
      return {
        auctionsFound: 0,
        auctionsWithSets: 0,
        opportunitiesFound: 0,
        alertsSent: 0,
        joblotsFound: 0,
        apiCallsMade: this.apiCallsMade,
        keepaCallsMade: this.keepaCallsMade,
        durationMs: Date.now() - startTime,
        opportunities: [],
        joblots: [],
        evaluations,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Search eBay Browse API for LEGO auctions ending within the scan window.
   */
  private async searchEndingSoonAuctions(
    config: EbayAuctionConfig,
    conditionFilter: 'NEW' | 'USED' = 'NEW'
  ): Promise<EbayAuctionItem[]> {
    const client = getEbayBrowseClient();
    this.apiCallsMade++;

    // Build filter for LEGO auctions ending soon, UK
    const filters = [
      'buyingOptions:{AUCTION}',
      `conditions:{${conditionFilter}}`,
      'itemLocationCountry:GB',
    ];

    // Add max price filter if configured
    if (config.maxBidPriceGbp) {
      filters.push(`price:[..${config.maxBidPriceGbp}],priceCurrency:GBP`);
    }

    const response = await client.searchItems('LEGO', {
      categoryId: '19006', // LEGO Complete Sets & Packs
      filter: filters.join(','),
      sort: 'endingSoonest',
      limit: 200, // Max to get as many ending-soon as possible
    });

    if (!response.itemSummaries?.length) {
      return [];
    }

    const now = Date.now();
    const windowMs = config.scanWindowMinutes * 60 * 1000;

    return (response.itemSummaries as AuctionItemSummary[])
      .filter((item) => {
        // Must have end date
        if (!item.itemEndDate) return false;

        const endTime = new Date(item.itemEndDate).getTime();
        const remaining = endTime - now;

        // Must be ending within the scan window and not already ended
        return remaining > 0 && remaining <= windowMs;
      })
      .map((item) => this.mapToAuctionItem(item, now))
      .filter((item): item is EbayAuctionItem => item !== null);
  }

  /**
   * Map eBay API response to our auction item type.
   * Returns null if critical fields are missing or invalid.
   */
  private mapToAuctionItem(item: AuctionItemSummary, now: number): EbayAuctionItem | null {
    if (!item.itemEndDate || !item.itemId || !item.title) return null;

    const endTime = new Date(item.itemEndDate).getTime();
    const bidPrice = item.currentBidPrice?.value || item.price?.value || '0';
    const postage = item.shippingOptions?.[0]?.shippingCost?.value || '0';

    const currentBidGbp = parseFloat(bidPrice);
    const postageGbp = parseFloat(postage);

    // Validate parsed numbers
    if (isNaN(currentBidGbp) || currentBidGbp < 0) return null;
    const safePostage = isNaN(postageGbp) ? 0 : postageGbp;

    return {
      itemId: item.itemId,
      title: item.title,
      currentBidGbp,
      postageGbp: safePostage,
      totalCostGbp: currentBidGbp + safePostage,
      bidCount: item.bidCount || 0,
      auctionEndTime: item.itemEndDate,
      minutesRemaining: Math.round((endTime - now) / 60000),
      itemUrl: item.itemWebUrl || '',
      imageUrl: item.image?.imageUrl || null,
      condition: item.condition || null,
      seller: item.seller
        ? {
            username: item.seller.username,
            feedbackPercentage: parseFloat(item.seller.feedbackPercentage || '0'),
            feedbackScore: item.seller.feedbackScore || 0,
          }
        : null,
    };
  }

  /**
   * Categorize auctions into singles and joblots, filtering out false positives.
   */
  private categorizeAuctions(
    items: EbayAuctionItem[],
    config: EbayAuctionConfig,
    evaluations: AuctionEvaluation[]
  ): {
    singles: Array<{ auction: EbayAuctionItem; setNumber: string; confidence: string }>;
    joblots: Array<{ auction: EbayAuctionItem; setNumbers: string[] }>;
  } {
    const singles: Array<{ auction: EbayAuctionItem; setNumber: string; confidence: string }> = [];
    const joblots: Array<{ auction: EbayAuctionItem; setNumbers: string[] }> = [];
    const excludedSetsSet = new Set(config.excludedSets);

    for (const auction of items) {
      const isFP = isFalsePositive(auction.title);
      const isNS = isNewSealed(auction.title, auction.condition);
      const isJL = isJoblot(auction.title);
      const identifiedSets = extractSetNumbers(auction.title);
      const bestMatch = identifiedSets.length > 0 ? identifiedSets[0] : null;

      // Build base evaluation (Amazon data filled in later for singles that pass)
      const ev: AuctionEvaluation = {
        itemId: auction.itemId,
        title: auction.title,
        currentBidGbp: auction.currentBidGbp,
        postageGbp: auction.postageGbp,
        totalCostGbp: auction.totalCostGbp,
        bidCount: auction.bidCount,
        minutesRemaining: auction.minutesRemaining,
        itemUrl: auction.itemUrl,
        imageUrl: auction.imageUrl,
        condition: auction.condition,
        setNumber: bestMatch?.setNumber || null,
        setConfidence: bestMatch?.confidence || null,
        isJoblot: isJL,
        isFalsePositive: isFP,
        isNewSealed: isNS,
        amazonPrice: null,
        amazon90dAvg: null,
        amazonAsin: null,
        amazonSalesRank: null,
        amazonSetName: null,
        profitGbp: null,
        marginPercent: null,
        roiPercent: null,
        filterReason: 'passed',
        alertTier: null,
      };

      // Apply filters in order, recording the first reason that stops it
      if (isFP) {
        ev.filterReason = 'false_positive';
        evaluations.push(ev);
        continue;
      }

      if (!isNS) {
        ev.filterReason = 'not_new_sealed';
        evaluations.push(ev);
        continue;
      }

      if (auction.bidCount < config.minBids) {
        ev.filterReason = 'below_min_bids';
        evaluations.push(ev);
        continue;
      }

      if (isJL) {
        ev.filterReason = 'joblot';
        const setNumbers = extractJoblotSets(auction.title);
        const filtered = setNumbers.filter((s) => !excludedSetsSet.has(s));
        if (filtered.length >= 2) {
          joblots.push({ auction, setNumbers: filtered });
        }
        evaluations.push(ev);
        continue;
      }

      if (!bestMatch) {
        ev.filterReason = 'no_set_identified';
        evaluations.push(ev);
        continue;
      }

      if (excludedSetsSet.has(bestMatch.setNumber)) {
        ev.filterReason = 'excluded_set';
        evaluations.push(ev);
        continue;
      }

      // Passed categorization — will be evaluated further in evaluateSingleOpportunities
      evaluations.push(ev);
      singles.push({
        auction,
        setNumber: bestMatch.setNumber,
        confidence: bestMatch.confidence,
      });
    }

    return { singles, joblots };
  }

  /**
   * Batch look up Amazon pricing from seeded_asin_pricing table.
   * Falls back to Keepa API for set numbers not found locally,
   * then saves discovered data so future scans hit the local DB.
   */
  private async lookupAmazonPricing(
    setNumbers: string[]
  ): Promise<Map<string, AmazonPricingData>> {
    const map = new Map<string, AmazonPricingData>();
    if (setNumbers.length === 0) return map;

    // brickset_sets stores set numbers as "NNNNN-1" format, but eBay titles give us "NNNNN"
    // Query with both variants to ensure we match
    const variantSetNumbers = setNumbers.flatMap((s) =>
      s.includes('-') ? [s] : [s, `${s}-1`]
    );

    // Map variant back to original: "42201-1" → "42201"
    const variantToOriginal = new Map<string, string>();
    for (const s of setNumbers) {
      variantToOriginal.set(s, s);
      if (!s.includes('-')) variantToOriginal.set(`${s}-1`, s);
    }

    // Query seeded_asin_pricing for these set numbers
    const { data, error } = await this.supabase
      .from('seeded_asin_pricing')
      .select('set_number, set_name, amazon_price, was_price_90d, uk_retail_price, asin')
      .in('set_number', variantSetNumbers)
      .not('amazon_price', 'is', null);

    if (error) {
      console.error('[AuctionScanner] Failed to look up Amazon pricing:', error.message);
      return map;
    }

    // Also check amazon_arbitrage_pricing for buy box / sales rank data
    const asins = (data || []).filter((d) => d.asin).map((d) => d.asin!);
    const arbitragePricing: Record<string, { salesRank: number | null; was90d: number | null }> = {};

    if (asins.length > 0) {
      const { data: arbData } = await this.supabase
        .from('amazon_arbitrage_pricing')
        .select('asin, sales_rank, was_price_90d')
        .in('asin', asins)
        .order('snapshot_date', { ascending: false });

      if (arbData) {
        // Take the most recent snapshot for each ASIN
        for (const row of arbData) {
          if (!arbitragePricing[row.asin]) {
            arbitragePricing[row.asin] = {
              salesRank: row.sales_rank,
              was90d: row.was_price_90d,
            };
          }
        }
      }
    }

    for (const row of data || []) {
      if (!row.amazon_price) continue;

      const arbInfo = row.asin ? arbitragePricing[row.asin] : undefined;
      // Map back to the original set number (e.g. "42201-1" → "42201")
      const originalSetNum = variantToOriginal.get(row.set_number) || row.set_number;

      map.set(originalSetNum, {
        asin: row.asin || '',
        amazonPrice: row.amazon_price,
        was90dAvg: row.was_price_90d || arbInfo?.was90d || null,
        salesRank: arbInfo?.salesRank || null,
        setName: row.set_name || null,
        ukRrp: row.uk_retail_price || null,
      });
    }

    // Keepa fallback for set numbers not found locally
    const missingSetNumbers = setNumbers.filter((s) => !map.has(s));
    if (missingSetNumbers.length > 0) {
      console.log(`[AuctionScanner] Keepa fallback for ${missingSetNumbers.length} sets: ${missingSetNumbers.join(', ')}`);
      const keepaResults = await this.keepaFallbackLookup(missingSetNumbers);
      for (const [setNum, pricing] of keepaResults) {
        map.set(setNum, pricing);
      }
    }

    console.log(`[AuctionScanner] Pricing: ${map.size}/${setNumbers.length} sets matched`);
    return map;
  }

  /**
   * Keepa fallback: discover ASINs via EAN lookup, fetch pricing, and save to DB
   * so future scans hit the local cache. Cost: ~1 token per EAN + ~3 tokens per ASIN.
   */
  private async keepaFallbackLookup(
    setNumbers: string[]
  ): Promise<Map<string, AmazonPricingData>> {
    const map = new Map<string, AmazonPricingData>();
    const keepa = new KeepaClient();

    if (!keepa.isConfigured()) {
      console.log('[AuctionScanner] Keepa not configured, skipping fallback lookup');
      return map;
    }

    try {
      // 1. Look up EANs from brickset_sets (try both "NNNNN" and "NNNNN-1" formats)
      const bricksetVariants = setNumbers.flatMap((s) =>
        s.includes('-') ? [s] : [s, `${s}-1`]
      );
      const { data: bricksetRows } = await this.supabase
        .from('brickset_sets')
        .select('id, set_number, set_name, ean, uk_retail_price')
        .in('set_number', bricksetVariants);

      // Track which original set numbers were found (strip -1 suffix for matching)
      const foundOriginals = new Set(
        (bricksetRows || []).map((r) => r.set_number.replace(/-1$/, ''))
      );
      const missingFromBrickset = setNumbers.filter(
        (s) => !foundOriginals.has(s) && !foundOriginals.has(s.replace(/-1$/, ''))
      );

      // 1b. Discover missing sets from Brickset API and save to DB
      if (missingFromBrickset.length > 0) {
        const newRows = await this.discoverFromBricksetApi(missingFromBrickset);
        if (newRows.length > 0 && bricksetRows) {
          bricksetRows.push(...newRows);
        }
      }

      // Filter to only rows with EANs
      const rowsWithEans = (bricksetRows || []).filter((r) => r.ean);

      if (!rowsWithEans.length) {
        console.log(`[AuctionScanner] No EANs found for: ${setNumbers.join(', ')}`);
        return map;
      }

      // 2. Discover ASINs via Keepa EAN search (1 token per matched product)
      const eans = rowsWithEans.map((r) => r.ean!).filter(Boolean);
      const eanToSetMap = new Map<string, typeof rowsWithEans[0]>();
      for (const row of rowsWithEans) {
        if (row.ean) eanToSetMap.set(row.ean, row);
      }

      this.keepaCallsMade++;
      const discoveredProducts = await keepa.searchByCode(eans);

      if (discoveredProducts.length === 0) {
        console.log(`[AuctionScanner] Keepa found no products for EANs: ${eans.join(', ')}`);
        return map;
      }

      // Map discovered ASINs back to set numbers
      const asinToSetInfo = new Map<string, typeof rowsWithEans[0]>();
      for (const product of discoveredProducts) {
        // Match product back to our set via EAN
        for (const ean of product.eanList || []) {
          const setInfo = eanToSetMap.get(ean);
          if (setInfo) {
            asinToSetInfo.set(product.asin, setInfo);
            break;
          }
        }
      }

      if (asinToSetInfo.size === 0) return map;

      // 3. Fetch full pricing for discovered ASINs (3 tokens per ASIN)
      const asinsToFetch = [...asinToSetInfo.keys()];
      this.keepaCallsMade++;
      const pricedProducts = await keepa.fetchProducts(asinsToFetch);

      const today = new Date().toISOString().split('T')[0];

      for (const product of pricedProducts) {
        const setInfo = asinToSetInfo.get(product.asin);
        if (!setInfo) continue;

        const pricing = keepa.extractCurrentPricing(product);
        const amazonPrice = pricing.buyBoxPrice || pricing.lowestNewPrice;
        if (!amazonPrice) continue;

        // 4. Save to seeded_asins (upsert) so the view picks it up
        const { error: upsertErr } = await this.supabase.from('seeded_asins').upsert(
          {
            brickset_set_id: setInfo.id,
            asin: product.asin,
            discovery_status: 'found',
            match_method: 'ean',
            match_confidence: 100,
            amazon_title: product.title || null,
            amazon_price: amazonPrice,
          },
          { onConflict: 'brickset_set_id' }
        );
        if (upsertErr) {
          console.error(`[AuctionScanner] seeded_asins upsert failed for ${product.asin}:`, upsertErr.message);
        }

        // 5. Save to amazon_arbitrage_pricing for freshness
        const { error: arbErr } = await this.supabase.from('amazon_arbitrage_pricing').upsert(
          {
            user_id: DEFAULT_USER_ID,
            asin: product.asin,
            snapshot_date: today,
            buy_box_price: pricing.buyBoxPrice,
            sales_rank: pricing.salesRank,
            was_price_90d: pricing.was90dAvg,
            offer_count: pricing.offerCount,
          },
          { onConflict: 'asin,snapshot_date' }
        );
        if (arbErr) {
          console.error(`[AuctionScanner] arbitrage_pricing upsert failed for ${product.asin}:`, arbErr.message);
        }

        // 6. Return pricing for this scan (use original set number without -1 suffix)
        const origSetNum = setInfo.set_number.replace(/-1$/, '');
        map.set(origSetNum, {
          asin: product.asin,
          amazonPrice,
          was90dAvg: pricing.was90dAvg,
          salesRank: pricing.salesRank,
          setName: setInfo.set_name || product.title || null,
          ukRrp: setInfo.uk_retail_price ? Number(setInfo.uk_retail_price) : null,
        });

        console.log(
          `[AuctionScanner] Keepa discovered ${setInfo.set_number} → ${product.asin} (£${amazonPrice})`
        );
      }
    } catch (err) {
      console.error('[AuctionScanner] Keepa fallback error:', err);
    }

    return map;
  }

  /**
   * Discover sets from Brickset API that aren't in our local brickset_sets table.
   * Fetches full set data including EAN, saves to DB, returns rows for Keepa lookup.
   */
  private async discoverFromBricksetApi(
    setNumbers: string[]
  ): Promise<Array<{ id: string; set_number: string; set_name: string; ean: string | null; uk_retail_price: number | null }>> {
    const results: Array<{ id: string; set_number: string; set_name: string; ean: string | null; uk_retail_price: number | null }> = [];

    try {
      const credService = new BricksetCredentialsService(this.supabase);
      const apiKey = await credService.getApiKey(DEFAULT_USER_ID);
      if (!apiKey) {
        console.log('[AuctionScanner] No Brickset API key configured, skipping discovery');
        return results;
      }

      const bricksetClient = new BricksetApiClient(apiKey);

      for (const setNum of setNumbers) {
        try {
          // Brickset expects "NNNNN-1" format
          const queryNum = setNum.includes('-') ? setNum : `${setNum}-1`;
          const apiSet = await bricksetClient.getSetByNumber(queryNum);

          if (!apiSet) {
            console.log(`[AuctionScanner] Brickset: set ${setNum} not found`);
            continue;
          }

          // Convert to internal format and save to DB
          const internal = apiSetToInternal(apiSet);
          const dbRow = internalToDbInsert(internal);

          const { data: inserted, error } = await this.supabase
            .from('brickset_sets')
            .upsert(dbRow, { onConflict: 'set_number' })
            .select('id, set_number, set_name, ean, uk_retail_price')
            .single();

          if (error) {
            console.error(`[AuctionScanner] Failed to save brickset set ${setNum}:`, error.message);
            continue;
          }

          if (inserted) {
            results.push(inserted);
            console.log(
              `[AuctionScanner] Brickset discovered ${setNum}: ${internal.setName} (EAN: ${internal.ean || 'none'})`
            );
          }
        } catch (setErr) {
          console.error(`[AuctionScanner] Brickset API error for ${setNum}:`, setErr);
        }
      }
    } catch (err) {
      console.error('[AuctionScanner] Brickset discovery error:', err);
    }

    return results;
  }

  /**
   * Batch cache-only Part-Out-Value read (the cron has no CDP, so it never scrapes).
   * Returns Map<bareSetNumber, { new, used }>; aggregate listings are excluded and the
   * lowest item_seq with sold data wins per condition. Chunked to stay under the 1000-row cap.
   */
  private async lookupPovBatch(
    setNumbers: string[]
  ): Promise<Map<string, { new: PovData | null; used: PovData | null }>> {
    const map = new Map<string, { new: PovData | null; used: PovData | null }>();
    const bare = [...new Set(setNumbers.map((s) => s.split('-')[0]).filter(Boolean))];
    if (bare.length === 0) return map;

    type Row = {
      set_number: string;
      set_name: string | null;
      item_seq: number;
      condition: string;
      sold_6mo_avg_gbp: number | string | null;
      for_sale_avg_gbp: number | string | null;
      uk_retail_gbp: number | string | null;
      partout_multiple: number | string | null;
      sold_6mo_lots: number | null;
    };

    const rows: Row[] = [];
    // A single set can hold multiple cached rows (item_seq × condition × break/option variants),
    // so the row count is NOT simply 2/set. Chunk the set list to bound the IN() size AND paginate
    // each chunk with .range() so we never silently truncate at PostgREST's 1000-row default.
    const CHUNK = 100;
    const PAGE = 1000;
    for (let i = 0; i < bare.length; i += CHUNK) {
      const slice = bare.slice(i, i + CHUNK);
      let offset = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await this.supabase
          .from('bricklink_part_out_value_cache')
          .select(
            'set_number, set_name, item_seq, condition, sold_6mo_avg_gbp, for_sale_avg_gbp, uk_retail_gbp, partout_multiple, sold_6mo_lots'
          )
          .in('set_number', slice)
          .eq('is_aggregate_listing', false)
          .order('set_number', { ascending: true })
          .order('item_seq', { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (error) {
          console.error('[AuctionScanner] POV lookup failed:', error.message);
          break;
        }
        const page = (data || []) as Row[];
        rows.push(...page);
        if (page.length < PAGE) break;
        offset += PAGE;
      }
    }

    const num = (v: number | string | null): number | null =>
      v == null ? null : typeof v === 'string' ? parseFloat(v) : v;

    const bySet = new Map<string, Row[]>();
    for (const r of rows) {
      if (!bySet.has(r.set_number)) bySet.set(r.set_number, []);
      bySet.get(r.set_number)!.push(r);
    }

    const pick = (group: Row[], cond: 'N' | 'U'): PovData | null => {
      const matches = group
        .filter((r) => r.condition === cond)
        .sort((a, b) => a.item_seq - b.item_seq);
      if (matches.length === 0) return null;
      const r = matches.find((x) => x.sold_6mo_avg_gbp != null) || matches[0];
      return {
        condition: cond === 'N' ? 'new' : 'used',
        setName: r.set_name,
        soldAvgGbp: num(r.sold_6mo_avg_gbp),
        forSaleAvgGbp: num(r.for_sale_avg_gbp),
        rrpGbp: num(r.uk_retail_gbp),
        rrpMultiple: num(r.partout_multiple),
        lots: r.sold_6mo_lots ?? null,
      };
    };

    for (const [setNum, group] of bySet) {
      map.set(setNum, { new: pick(group, 'N'), used: pick(group, 'U') });
    }
    return map;
  }

  /**
   * Evaluate single (new-condition) opportunities.
   * Buy signal = Amazon resale margin OR (povBuyEnabled && New POV >= povMultiple × total cost).
   */
  private evaluateSingleOpportunities(
    singles: Array<{ auction: EbayAuctionItem; setNumber: string; confidence: string }>,
    amazonPricing: Map<string, AmazonPricingData>,
    povData: Map<string, { new: PovData | null; used: PovData | null }>,
    config: EbayAuctionConfig,
    evaluations: AuctionEvaluation[]
  ): AuctionOpportunity[] {
    const opportunities: AuctionOpportunity[] = [];
    const mult = config.povMultiple || 3;
    const greatMult = config.povGreatMultiple || 4;
    const round2 = (n: number) => Math.round(n * 100) / 100;

    for (const { auction, setNumber, confidence } of singles) {
      const ev = evaluations.find((e) => e.itemId === auction.itemId);
      const amazon = amazonPricing.get(setNumber) || null;
      const newPov = povData.get(setNumber.split('-')[0])?.new || null;

      const postage = auction.postageGbp > 0 ? auction.postageGbp : config.defaultPostageGbp;
      const totalCost = auction.currentBidGbp + postage;

      // --- Amazon resale signal ---
      let amazonTier: 'great' | 'good' | null = null;
      let profit: ReturnType<typeof calculateAuctionProfit> = null;
      if (amazon) {
        if (ev) {
          ev.amazonPrice = amazon.amazonPrice;
          ev.amazon90dAvg = amazon.was90dAvg;
          ev.amazonAsin = amazon.asin;
          ev.amazonSalesRank = amazon.salesRank;
          ev.amazonSetName = amazon.setName;
        }
        const salesRankOk = !(config.maxSalesRank && amazon.salesRank && amazon.salesRank > config.maxSalesRank);
        profit = calculateAuctionProfit(auction.currentBidGbp, postage, amazon.amazonPrice);
        if (profit && ev) {
          ev.profitGbp = profit.totalProfit;
          ev.marginPercent = profit.profitMarginPercent;
          ev.roiPercent = profit.roiPercent;
        }
        if (
          salesRankOk &&
          profit &&
          profit.profitMarginPercent >= config.minMarginPercent &&
          profit.totalProfit >= config.minProfitGbp
        ) {
          amazonTier = profit.profitMarginPercent >= config.greatMarginPercent ? 'great' : 'good';
        }
      }

      // --- New POV signal ---
      const povMultiple = newPov?.soldAvgGbp && totalCost > 0 ? newPov.soldAvgGbp / totalCost : null;
      const povTier: 'great' | 'good' | null =
        config.povBuyEnabled && povMultiple != null
          ? povMultiple >= greatMult
            ? 'great'
            : povMultiple >= mult
              ? 'good'
              : null
          : null;
      if (ev) {
        ev.conditionMode = 'new';
        ev.povSoldGbp = newPov?.soldAvgGbp ?? null;
        ev.povMultiple = povMultiple != null ? round2(povMultiple) : null;
      }

      const signals: string[] = [];
      if (amazonTier && profit) signals.push(`Amazon ${profit.profitMarginPercent.toFixed(1)}%`);
      if (povTier && povMultiple != null) signals.push(`New POV ${povMultiple.toFixed(1)}× cost`);

      const alertTier: 'great' | 'good' | null =
        amazonTier === 'great' || povTier === 'great'
          ? 'great'
          : amazonTier || povTier
            ? 'good'
            : null;

      if (!alertTier) {
        if (ev) {
          ev.filterReason = !amazon
            ? 'no_amazon_price'
            : povMultiple != null
              ? 'below_pov_multiple'
              : 'below_min_margin';
          ev.alertTier = null;
        }
        continue;
      }

      if (ev) {
        ev.filterReason = 'passed';
        ev.alertTier = alertTier;
      }

      opportunities.push({
        auction: { ...auction, postageGbp: postage, totalCostGbp: totalCost },
        setIdentification: {
          setNumber,
          confidence: confidence as 'high' | 'medium' | 'low',
          method: 'regex_title',
        },
        amazonData: amazon,
        profitBreakdown: profit,
        alertTier,
        conditionMode: 'new',
        pov: newPov,
        povMultiple: povMultiple != null ? round2(povMultiple) : null,
        signals,
      });
    }

    // Sort: greats first, then by the stronger of Amazon margin / POV multiple.
    const score = (o: AuctionOpportunity) =>
      Math.max(o.profitBreakdown?.profitMarginPercent ?? 0, (o.povMultiple ?? 0) * 10);
    opportunities.sort((a, b) => score(b) - score(a));

    return opportunities;
  }

  /**
   * Opt-in USED-auction scan (config.usedPovModeEnabled). Judged purely on
   * Used POV >= povMultiple × total cost — no Amazon leg, no new-sealed gate.
   */
  private async scanUsedPov(
    config: EbayAuctionConfig,
    evaluations: AuctionEvaluation[]
  ): Promise<AuctionOpportunity[]> {
    // Gated solely by usedPovModeEnabled (checked by the caller). povBuyEnabled governs the
    // separate New-POV hybrid signal and must NOT also gate the used scan.
    const mult = config.povMultiple || 3;
    const greatMult = config.povGreatMultiple || 4;
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const excludedSets = new Set(config.excludedSets);

    const items = await this.searchEndingSoonAuctions(config, 'USED');
    if (items.length === 0) return [];

    const candidates: Array<{ auction: EbayAuctionItem; setNumber: string; confidence: string }> = [];
    for (const auction of items) {
      const isFP = isFalsePositive(auction.title);
      const isJL = isJoblot(auction.title);
      const identified = extractSetNumbers(auction.title);
      const best = identified.length > 0 ? identified[0] : null;

      const ev: AuctionEvaluation = {
        itemId: auction.itemId,
        title: auction.title,
        currentBidGbp: auction.currentBidGbp,
        postageGbp: auction.postageGbp,
        totalCostGbp: auction.totalCostGbp,
        bidCount: auction.bidCount,
        minutesRemaining: auction.minutesRemaining,
        itemUrl: auction.itemUrl,
        imageUrl: auction.imageUrl,
        condition: auction.condition,
        setNumber: best?.setNumber || null,
        setConfidence: best?.confidence || null,
        isJoblot: isJL,
        isFalsePositive: isFP,
        isNewSealed: false,
        amazonPrice: null,
        amazon90dAvg: null,
        amazonAsin: null,
        amazonSalesRank: null,
        amazonSetName: null,
        profitGbp: null,
        marginPercent: null,
        roiPercent: null,
        conditionMode: 'used',
        povSoldGbp: null,
        povMultiple: null,
        filterReason: 'passed',
        alertTier: null,
      };

      if (isFP) { ev.filterReason = 'false_positive'; evaluations.push(ev); continue; }
      if (auction.bidCount < config.minBids) { ev.filterReason = 'below_min_bids'; evaluations.push(ev); continue; }
      if (isJL) { ev.filterReason = 'joblot'; evaluations.push(ev); continue; }
      if (!best) { ev.filterReason = 'no_set_identified'; evaluations.push(ev); continue; }
      if (excludedSets.has(best.setNumber)) { ev.filterReason = 'excluded_set'; evaluations.push(ev); continue; }

      evaluations.push(ev);
      candidates.push({ auction, setNumber: best.setNumber, confidence: best.confidence });
    }

    if (candidates.length === 0) return [];

    const povData = await this.lookupPovBatch(candidates.map((c) => c.setNumber));
    const opportunities: AuctionOpportunity[] = [];

    for (const { auction, setNumber, confidence } of candidates) {
      const ev = evaluations.find((e) => e.itemId === auction.itemId);
      const usedPov = povData.get(setNumber.split('-')[0])?.used || null;
      const postage = auction.postageGbp > 0 ? auction.postageGbp : config.defaultPostageGbp;
      const totalCost = auction.currentBidGbp + postage;
      const povMultiple = usedPov?.soldAvgGbp && totalCost > 0 ? usedPov.soldAvgGbp / totalCost : null;
      if (ev) {
        ev.povSoldGbp = usedPov?.soldAvgGbp ?? null;
        ev.povMultiple = povMultiple != null ? round2(povMultiple) : null;
      }

      const tier: 'great' | 'good' | null =
        povMultiple == null ? null : povMultiple >= greatMult ? 'great' : povMultiple >= mult ? 'good' : null;
      if (!tier) {
        if (ev) ev.filterReason = povMultiple != null ? 'below_pov_multiple' : 'no_signal';
        continue;
      }
      if (ev) { ev.filterReason = 'passed'; ev.alertTier = tier; }

      opportunities.push({
        auction: { ...auction, postageGbp: postage, totalCostGbp: totalCost },
        setIdentification: {
          setNumber,
          confidence: confidence as 'high' | 'medium' | 'low',
          method: 'regex_title',
        },
        amazonData: null,
        profitBreakdown: null,
        alertTier: tier,
        conditionMode: 'used',
        pov: usedPov,
        povMultiple: povMultiple != null ? round2(povMultiple) : null,
        signals: [`Used POV ${povMultiple!.toFixed(1)}× cost`],
      });
    }

    return opportunities;
  }

  /**
   * Evaluate joblot opportunities.
   */
  private evaluateJoblotOpportunities(
    joblots: Array<{ auction: EbayAuctionItem; setNumbers: string[] }>,
    amazonPricing: Map<string, AmazonPricingData>,
    config: EbayAuctionConfig
  ): JoblotOpportunity[] {
    const opportunities: JoblotOpportunity[] = [];

    for (const { auction, setNumbers } of joblots) {
      const sets: JoblotSetEntry[] = [];
      let totalAmazonValue = 0;

      for (const setNum of setNumbers) {
        const amazon = amazonPricing.get(setNum);
        sets.push({
          setNumber: setNum,
          setName: amazon?.setName || null,
          amazonPrice: amazon?.amazonPrice || null,
          asin: amazon?.asin || null,
        });
        if (amazon?.amazonPrice) {
          totalAmazonValue += amazon.amazonPrice;
        }
      }

      // Need at least some Amazon value to evaluate
      if (totalAmazonValue < config.joblotMinTotalValueGbp) continue;

      const postage = auction.postageGbp > 0 ? auction.postageGbp : config.defaultPostageGbp;
      const totalCost = auction.currentBidGbp + postage;

      // Rough profit estimate: assume ~18% fees on each individual sale + shipping
      const estimatedFees = totalAmazonValue * 0.1836;
      const estimatedShipping = sets.filter((s) => s.amazonPrice).length * 3.5; // Avg shipping
      const estimatedProfit = totalAmazonValue - estimatedFees - estimatedShipping - totalCost;
      const marginPercent = totalAmazonValue > 0 ? (estimatedProfit / totalAmazonValue) * 100 : 0;

      if (marginPercent >= config.minMarginPercent && estimatedProfit >= config.minProfitGbp) {
        opportunities.push({
          auction: { ...auction, postageGbp: postage, totalCostGbp: totalCost },
          sets,
          totalAmazonValue,
          totalCost,
          estimatedProfit,
          marginPercent,
        });
      }
    }

    return opportunities;
  }

  /**
   * Get set of item IDs that have already been alerted.
   */
  private async getAlreadyAlertedIds(
    userId: string,
    itemIds: string[]
  ): Promise<Set<string>> {
    if (itemIds.length === 0) return new Set();

    const { data: existing } = await this.supabase
      .from('ebay_auction_alerts')
      .select('ebay_item_id')
      .eq('user_id', userId)
      .in('ebay_item_id', itemIds);

    return new Set((existing || []).map((e) => e.ebay_item_id));
  }

  /**
   * Check if current time is within quiet hours.
   */
  isInQuietHours(config: EbayAuctionConfig): boolean {
    if (!config.quietHoursEnabled) return false;

    const now = new Date();
    const currentHour = now.getUTCHours();

    if (config.quietHoursStart <= config.quietHoursEnd) {
      // Simple range (e.g., 8-17)
      return currentHour >= config.quietHoursStart && currentHour < config.quietHoursEnd;
    } else {
      // Wraps midnight (e.g., 22-7)
      return currentHour >= config.quietHoursStart || currentHour < config.quietHoursEnd;
    }
  }

  /**
   * Save an alert record to the database.
   */
  async saveAlert(
    userId: string,
    opportunity: AuctionOpportunity,
    discordSent: boolean
  ): Promise<void> {
    const { auction, setIdentification, amazonData, profitBreakdown, alertTier, pov, povMultiple, conditionMode, signals } = opportunity;

    await this.supabase.from('ebay_auction_alerts').upsert(
      {
        user_id: userId,
        ebay_item_id: auction.itemId,
        ebay_title: auction.title,
        ebay_url: auction.itemUrl,
        ebay_image_url: auction.imageUrl,
        set_number: setIdentification.setNumber,
        set_name: amazonData?.setName ?? pov?.setName ?? null,
        current_bid_gbp: auction.currentBidGbp,
        postage_gbp: auction.postageGbp,
        total_cost_gbp: auction.totalCostGbp,
        bid_count: auction.bidCount,
        amazon_price_gbp: amazonData?.amazonPrice ?? null,
        amazon_90d_avg_gbp: amazonData?.was90dAvg ?? null,
        amazon_asin: amazonData?.asin ?? null,
        amazon_sales_rank: amazonData?.salesRank ?? null,
        profit_gbp: profitBreakdown?.totalProfit ?? null,
        margin_percent: profitBreakdown?.profitMarginPercent ?? null,
        roi_percent: profitBreakdown?.roiPercent ?? null,
        alert_tier: alertTier,
        is_joblot: false,
        pov_condition: conditionMode,
        pov_sold_gbp: pov?.soldAvgGbp ?? null,
        pov_multiple: povMultiple ?? null,
        buy_signal: signals.join(' + ') || null,
        auction_end_time: auction.auctionEndTime,
        discord_sent: discordSent,
        discord_sent_at: discordSent ? new Date().toISOString() : null,
      },
      { onConflict: 'user_id,ebay_item_id' }
    );
  }

  /**
   * Save a joblot alert record.
   */
  async saveJoblotAlert(
    userId: string,
    joblot: JoblotOpportunity,
    discordSent: boolean
  ): Promise<void> {
    await this.supabase.from('ebay_auction_alerts').upsert(
      {
        user_id: userId,
        ebay_item_id: joblot.auction.itemId,
        ebay_title: joblot.auction.title,
        ebay_url: joblot.auction.itemUrl,
        ebay_image_url: joblot.auction.imageUrl,
        set_number: joblot.sets.map((s) => s.setNumber).join(', '),
        set_name: 'Joblot',
        current_bid_gbp: joblot.auction.currentBidGbp,
        postage_gbp: joblot.auction.postageGbp,
        total_cost_gbp: joblot.totalCost,
        bid_count: joblot.auction.bidCount,
        amazon_price_gbp: joblot.totalAmazonValue,
        profit_gbp: joblot.estimatedProfit,
        margin_percent: joblot.marginPercent,
        alert_tier: joblot.marginPercent >= 30 ? 'great' : 'good',
        is_joblot: true,
        joblot_sets: joblot.sets as unknown as Record<string, unknown>,
        auction_end_time: joblot.auction.auctionEndTime,
        discord_sent: discordSent,
        discord_sent_at: discordSent ? new Date().toISOString() : null,
      },
      { onConflict: 'user_id,ebay_item_id' }
    );
  }

  /**
   * Save scan log entry.
   */
  async saveScanLog(userId: string, result: ScanResult): Promise<void> {
    await this.supabase.from('ebay_auction_scan_log').insert({
      user_id: userId,
      auctions_found: result.auctionsFound,
      auctions_with_sets: result.auctionsWithSets,
      opportunities_found: result.opportunitiesFound,
      alerts_sent: result.alertsSent,
      joblots_found: result.joblotsFound,
      duration_ms: result.durationMs,
      api_calls_made: result.apiCallsMade,
      keepa_calls_made: result.keepaCallsMade || 0,
      evaluation_details: result.evaluations?.length ? result.evaluations : null,
      error_message: result.error || null,
      skipped_reason: result.skippedReason || null,
    });
  }

  /**
   * Load config from database.
   */
  async loadConfig(userId: string): Promise<EbayAuctionConfig | null> {
    const { data, error } = await this.supabase
      .from('ebay_auction_config')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) return null;

    return {
      id: data.id,
      userId: data.user_id,
      enabled: data.enabled,
      minMarginPercent: Number(data.min_margin_percent),
      greatMarginPercent: Number(data.great_margin_percent),
      minProfitGbp: Number(data.min_profit_gbp),
      maxBidPriceGbp: data.max_bid_price_gbp ? Number(data.max_bid_price_gbp) : null,
      defaultPostageGbp: Number(data.default_postage_gbp),
      quietHoursEnabled: data.quiet_hours_enabled,
      quietHoursStart: data.quiet_hours_start,
      quietHoursEnd: data.quiet_hours_end,
      excludedSets: (data.excluded_sets as string[]) || [],
      scanWindowMinutes: data.scan_window_minutes,
      minBids: data.min_bids,
      maxSalesRank: data.max_sales_rank,
      joblotAnalysisEnabled: data.joblot_analysis_enabled,
      joblotMinTotalValueGbp: Number(data.joblot_min_total_value_gbp),
      povBuyEnabled: data.pov_buy_enabled ?? true,
      povMultiple: data.pov_multiple != null ? Number(data.pov_multiple) : 3,
      povGreatMultiple: data.pov_great_multiple != null ? Number(data.pov_great_multiple) : 4,
      usedPovModeEnabled: data.used_pov_mode_enabled ?? false,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  private createSkippedResult(startTime: number, reason: string): ScanResult {
    return {
      auctionsFound: 0,
      auctionsWithSets: 0,
      opportunitiesFound: 0,
      alertsSent: 0,
      joblotsFound: 0,
      apiCallsMade: 0,
      keepaCallsMade: 0,
      durationMs: Date.now() - startTime,
      opportunities: [],
      joblots: [],
      evaluations: [],
      skippedReason: reason,
    };
  }

  private createResult(
    startTime: number,
    partial: Partial<ScanResult>
  ): ScanResult {
    return {
      auctionsFound: 0,
      auctionsWithSets: 0,
      opportunitiesFound: 0,
      alertsSent: 0,
      joblotsFound: 0,
      apiCallsMade: this.apiCallsMade,
      keepaCallsMade: this.keepaCallsMade,
      durationMs: Date.now() - startTime,
      opportunities: [],
      joblots: [],
      evaluations: [],
      ...partial,
    };
  }
}
