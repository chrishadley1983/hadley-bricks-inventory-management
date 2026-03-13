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

      if (auctionItems.length === 0) {
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

      // 5. Calculate opportunities for single sets (updates evaluations in-place)
      const opportunities = this.evaluateSingleOpportunities(singles, amazonPricing, config, evaluations);

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
  private async searchEndingSoonAuctions(config: EbayAuctionConfig): Promise<EbayAuctionItem[]> {
    const client = getEbayBrowseClient();
    this.apiCallsMade++;

    // Build filter for LEGO auctions ending soon, new condition, UK
    const filters = [
      'buyingOptions:{AUCTION}',
      'conditions:{NEW}',
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
   * Evaluate single-set opportunities against Amazon pricing.
   */
  private evaluateSingleOpportunities(
    singles: Array<{ auction: EbayAuctionItem; setNumber: string; confidence: string }>,
    amazonPricing: Map<string, AmazonPricingData>,
    config: EbayAuctionConfig,
    evaluations: AuctionEvaluation[]
  ): AuctionOpportunity[] {
    const opportunities: AuctionOpportunity[] = [];

    for (const { auction, setNumber, confidence } of singles) {
      // Find the existing evaluation record for this auction
      const ev = evaluations.find((e) => e.itemId === auction.itemId);

      const amazon = amazonPricing.get(setNumber);
      if (!amazon) {
        if (ev) ev.filterReason = 'no_amazon_price';
        continue;
      }

      // Populate Amazon data on the evaluation
      if (ev) {
        ev.amazonPrice = amazon.amazonPrice;
        ev.amazon90dAvg = amazon.was90dAvg;
        ev.amazonAsin = amazon.asin;
        ev.amazonSalesRank = amazon.salesRank;
        ev.amazonSetName = amazon.setName;
      }

      // Use default postage if eBay didn't provide it
      const postage = auction.postageGbp > 0 ? auction.postageGbp : config.defaultPostageGbp;
      const totalCost = auction.currentBidGbp + postage;

      // Check sales rank filter
      if (config.maxSalesRank && amazon.salesRank && amazon.salesRank > config.maxSalesRank) {
        if (ev) ev.filterReason = 'sales_rank_too_high';
        continue;
      }

      const profit = calculateAuctionProfit(auction.currentBidGbp, postage, amazon.amazonPrice);
      if (!profit) continue;

      // Populate profit data on the evaluation
      if (ev) {
        ev.profitGbp = profit.totalProfit;
        ev.marginPercent = profit.profitMarginPercent;
        ev.roiPercent = profit.roiPercent;
      }

      // Check thresholds
      if (profit.profitMarginPercent < config.minMarginPercent) {
        if (ev) ev.filterReason = 'below_min_margin';
        continue;
      }
      if (profit.totalProfit < config.minProfitGbp) {
        if (ev) ev.filterReason = 'below_min_profit';
        continue;
      }

      const alertTier =
        profit.profitMarginPercent >= config.greatMarginPercent ? 'great' : 'good';

      // Mark as passed with tier
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
      });
    }

    // Sort by margin descending
    opportunities.sort((a, b) => b.profitBreakdown.profitMarginPercent - a.profitBreakdown.profitMarginPercent);

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
    const { auction, setIdentification, amazonData, profitBreakdown, alertTier } = opportunity;

    await this.supabase.from('ebay_auction_alerts').upsert(
      {
        user_id: userId,
        ebay_item_id: auction.itemId,
        ebay_title: auction.title,
        ebay_url: auction.itemUrl,
        ebay_image_url: auction.imageUrl,
        set_number: setIdentification.setNumber,
        set_name: amazonData.setName,
        current_bid_gbp: auction.currentBidGbp,
        postage_gbp: auction.postageGbp,
        total_cost_gbp: auction.totalCostGbp,
        bid_count: auction.bidCount,
        amazon_price_gbp: amazonData.amazonPrice,
        amazon_90d_avg_gbp: amazonData.was90dAvg,
        amazon_asin: amazonData.asin,
        amazon_sales_rank: amazonData.salesRank,
        profit_gbp: profitBreakdown.totalProfit,
        margin_percent: profitBreakdown.profitMarginPercent,
        roi_percent: profitBreakdown.roiPercent,
        alert_tier: alertTier,
        is_joblot: false,
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
        alert_tier: joblot.marginPercent >= 25 ? 'great' : 'good',
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
