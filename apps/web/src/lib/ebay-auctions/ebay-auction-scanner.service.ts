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
        return this.createResult(startTime, { auctionsFound: 0 });
      }

      // 3. Filter and identify sets
      const { singles, joblots } = this.categorizeAuctions(auctionItems, config);

      // 4. Look up Amazon pricing for identified sets (batch query)
      const allSetNumbers = [
        ...singles.map((s) => s.setNumber),
        ...joblots.flatMap((j) => j.setNumbers),
      ];
      const uniqueSetNumbers = [...new Set(allSetNumbers)];
      const amazonPricing = await this.lookupAmazonPricing(uniqueSetNumbers);

      // 5. Calculate opportunities for single sets
      const opportunities = this.evaluateSingleOpportunities(singles, amazonPricing, config);

      // 6. Evaluate joblots
      const joblotOpps = config.joblotAnalysisEnabled
        ? this.evaluateJoblotOpportunities(joblots, amazonPricing, config)
        : [];

      // 7. Deduplicate against previously alerted auctions
      const newOpportunities = await this.deduplicateAlerts(
        opportunities,
        config.userId || DEFAULT_USER_ID
      );
      const newJoblots = await this.deduplicateJoblotAlerts(
        joblotOpps,
        config.userId || DEFAULT_USER_ID
      );

      return {
        auctionsFound: auctionItems.length,
        auctionsWithSets: singles.length + joblots.length,
        opportunitiesFound: newOpportunities.length,
        alertsSent: 0, // Caller handles sending
        joblotsFound: newJoblots.length,
        apiCallsMade: this.apiCallsMade,
        durationMs: Date.now() - startTime,
        opportunities: newOpportunities,
        joblots: newJoblots,
      };
    } catch (error) {
      return {
        auctionsFound: 0,
        auctionsWithSets: 0,
        opportunitiesFound: 0,
        alertsSent: 0,
        joblotsFound: 0,
        apiCallsMade: this.apiCallsMade,
        durationMs: Date.now() - startTime,
        opportunities: [],
        joblots: [],
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
    config: EbayAuctionConfig
  ): {
    singles: Array<{ auction: EbayAuctionItem; setNumber: string; confidence: string }>;
    joblots: Array<{ auction: EbayAuctionItem; setNumbers: string[] }>;
  } {
    const singles: Array<{ auction: EbayAuctionItem; setNumber: string; confidence: string }> = [];
    const joblots: Array<{ auction: EbayAuctionItem; setNumbers: string[] }> = [];
    const excludedSetsSet = new Set(config.excludedSets);

    for (const auction of items) {
      // Skip false positives (minifigs, instructions, etc.)
      if (isFalsePositive(auction.title)) continue;

      // Must be new/sealed (primary focus)
      if (!isNewSealed(auction.title, auction.condition)) continue;

      // Check minimum bids
      if (auction.bidCount < config.minBids) continue;

      // Check if it's a joblot
      if (isJoblot(auction.title)) {
        const setNumbers = extractJoblotSets(auction.title);
        const filtered = setNumbers.filter((s) => !excludedSetsSet.has(s));
        if (filtered.length >= 2) {
          joblots.push({ auction, setNumbers: filtered });
        }
        continue;
      }

      // Try to identify single set
      const identifiedSets = extractSetNumbers(auction.title);
      if (identifiedSets.length > 0) {
        const bestMatch = identifiedSets[0]; // Highest confidence first
        if (!excludedSetsSet.has(bestMatch.setNumber)) {
          singles.push({
            auction,
            setNumber: bestMatch.setNumber,
            confidence: bestMatch.confidence,
          });
        }
      }
    }

    return { singles, joblots };
  }

  /**
   * Batch look up Amazon pricing from seeded_asin_pricing table.
   * This is token-efficient - no external API calls, just a local DB query.
   */
  private async lookupAmazonPricing(
    setNumbers: string[]
  ): Promise<Map<string, AmazonPricingData>> {
    const map = new Map<string, AmazonPricingData>();
    if (setNumbers.length === 0) return map;

    // Query seeded_asin_pricing for these set numbers
    const { data, error } = await this.supabase
      .from('seeded_asin_pricing')
      .select('set_number, set_name, amazon_price, was_price_90d, uk_retail_price, asin')
      .in('set_number', setNumbers)
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

      map.set(row.set_number, {
        asin: row.asin || '',
        amazonPrice: row.amazon_price,
        was90dAvg: row.was_price_90d || arbInfo?.was90d || null,
        salesRank: arbInfo?.salesRank || null,
        setName: row.set_name || null,
        ukRrp: row.uk_retail_price || null,
      });
    }

    return map;
  }

  /**
   * Evaluate single-set opportunities against Amazon pricing.
   */
  private evaluateSingleOpportunities(
    singles: Array<{ auction: EbayAuctionItem; setNumber: string; confidence: string }>,
    amazonPricing: Map<string, AmazonPricingData>,
    config: EbayAuctionConfig
  ): AuctionOpportunity[] {
    const opportunities: AuctionOpportunity[] = [];

    for (const { auction, setNumber, confidence } of singles) {
      const amazon = amazonPricing.get(setNumber);
      if (!amazon) continue;

      // Use default postage if eBay didn't provide it
      const postage = auction.postageGbp > 0 ? auction.postageGbp : config.defaultPostageGbp;
      const totalCost = auction.currentBidGbp + postage;

      // Check sales rank filter
      if (config.maxSalesRank && amazon.salesRank && amazon.salesRank > config.maxSalesRank) {
        continue;
      }

      const profit = calculateAuctionProfit(auction.currentBidGbp, postage, amazon.amazonPrice);
      if (!profit) continue;

      // Check thresholds
      if (profit.profitMarginPercent < config.minMarginPercent) continue;
      if (profit.totalProfit < config.minProfitGbp) continue;

      const alertTier =
        profit.profitMarginPercent >= config.greatMarginPercent ? 'great' : 'good';

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
   * Filter out opportunities that have already been alerted.
   */
  private async deduplicateAlerts(
    opportunities: AuctionOpportunity[],
    userId: string
  ): Promise<AuctionOpportunity[]> {
    if (opportunities.length === 0) return [];

    const itemIds = opportunities.map((o) => o.auction.itemId);
    const { data: existing } = await this.supabase
      .from('ebay_auction_alerts')
      .select('ebay_item_id')
      .eq('user_id', userId)
      .in('ebay_item_id', itemIds);

    const existingSet = new Set((existing || []).map((e) => e.ebay_item_id));
    return opportunities.filter((o) => !existingSet.has(o.auction.itemId));
  }

  /**
   * Filter out joblot opportunities that have already been alerted.
   */
  private async deduplicateJoblotAlerts(
    joblots: JoblotOpportunity[],
    userId: string
  ): Promise<JoblotOpportunity[]> {
    if (joblots.length === 0) return [];

    const itemIds = joblots.map((j) => j.auction.itemId);
    const { data: existing } = await this.supabase
      .from('ebay_auction_alerts')
      .select('ebay_item_id')
      .eq('user_id', userId)
      .in('ebay_item_id', itemIds);

    const existingSet = new Set((existing || []).map((e) => e.ebay_item_id));
    return joblots.filter((j) => !existingSet.has(j.auction.itemId));
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
      durationMs: Date.now() - startTime,
      opportunities: [],
      joblots: [],
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
      durationMs: Date.now() - startTime,
      opportunities: [],
      joblots: [],
      ...partial,
    };
  }
}
