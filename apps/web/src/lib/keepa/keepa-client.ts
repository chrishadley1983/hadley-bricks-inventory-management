/**
 * Keepa API Client
 *
 * Fetches historical Amazon UK price and sales rank data for LEGO ASINs.
 * Keepa provides 10+ years of daily pricing history per ASIN.
 *
 * Rate limit: 20 tokens/minute. Each product lookup costs ~3 tokens.
 * Batch size: up to 10 ASINs per request.
 *
 * Domain 2 = Amazon UK (amazon.co.uk)
 */

/**
 * Keepa stats object returned when stats parameter is set.
 * Contains current, average, min, max values for each CSV type.
 * Array indices match KEEPA_CSV_INDEX values.
 */
export interface KeepaStats {
  /** Current value for each CSV type (index matches KEEPA_CSV_INDEX) */
  current?: (number | null)[];
  /** Average over the stats period for each CSV type */
  avg?: (number | null)[];
  /** Average over 30 days for each CSV type */
  avg30?: (number | null)[];
  /** Average over 90 days for each CSV type */
  avg90?: (number | null)[];
  /** Average over 180 days for each CSV type */
  avg180?: (number | null)[];
}

export interface KeepaProduct {
  asin: string;
  /** CSV-encoded price history: [timestamp, price, timestamp, price, ...] */
  csv: (number[] | null)[];
  /** Product title */
  title?: string;
  /** Sales rank history */
  salesRanks?: Record<string, number[]>;
  /** EAN codes associated with this product */
  eanList?: string[];
  /** UPC codes associated with this product */
  upcList?: string[];
  /** Stats object when stats parameter is set */
  stats?: KeepaStats;
}

export interface KeepaResponse {
  timestamp: number;
  tokensLeft: number;
  refillIn: number;
  refillRate: number;
  products?: KeepaProduct[];
  error?: { type: string; message: string };
}

export interface KeepaFinderResponse {
  timestamp: number;
  tokensLeft: number;
  refillIn: number;
  refillRate: number;
  asinList?: string[];
  totalResults?: number;
  error?: { type: string; message: string };
}

export interface KeepaImportResult {
  asin: string;
  snapshots_imported: number;
  date_range: { from: string; to: string } | null;
  error?: string;
}

/**
 * Keepa CSV indices for different price types.
 * See: https://keepa.com/#!discuss/t/product-object/116
 */
export const KEEPA_CSV_INDEX = {
  AMAZON: 0,        // Amazon price
  NEW: 1,           // Marketplace new price (lowest new offer)
  USED: 2,          // Marketplace used price
  SALES_RANK: 3,    // Sales rank
  COUNT_NEW: 11,    // New offer count
  BUY_BOX: 18,      // Buy box price (shipping included)
} as const;

/**
 * Keepa stores timestamps as minutes since epoch (2011-01-01).
 * This offset converts to standard Unix timestamps.
 */
const KEEPA_EPOCH_MINUTES = 21564000; // Minutes from Unix epoch to 2011-01-01

/**
 * Convert Keepa timestamp (minutes since 2011-01-01) to ISO date string.
 */
export function keepaTimestampToDate(keepaMinutes: number): string {
  const unixMs = (keepaMinutes + KEEPA_EPOCH_MINUTES) * 60 * 1000;
  return new Date(unixMs).toISOString().split('T')[0];
}

/**
 * Convert Keepa price (in pence/cents) to GBP.
 * Keepa stores prices as integers in the smallest currency unit.
 * A value of -1 means "out of stock" / no data.
 */
export function keepaPriceToGBP(keepaPrice: number): number | null {
  if (keepaPrice < 0) return null;
  return keepaPrice / 100;
}

/**
 * Parse Keepa CSV data into daily snapshots.
 * CSV is encoded as: [timestamp1, value1, timestamp2, value2, ...]
 */
export function parseKeepaCSV(
  csv: number[] | null
): { date: string; value: number }[] {
  if (!csv || csv.length < 2) return [];

  const points: { date: string; value: number }[] = [];
  for (let i = 0; i < csv.length - 1; i += 2) {
    const timestamp = csv[i];
    const value = csv[i + 1];
    if (value >= 0) {
      points.push({
        date: keepaTimestampToDate(timestamp),
        value,
      });
    }
  }
  return points;
}

export class KeepaClient {
  private apiKey: string;
  private baseUrl = 'https://api.keepa.com';
  private tokensPerMinute: number;
  private lastRequestTime = 0;
  private tokensLeft = 0;

  /**
   * @param apiKey - Keepa API key (defaults to KEEPA_API_KEY env var)
   * @param tokensPerMinute - Token refill rate for rate limiting.
   *   Defaults to KEEPA_TOKENS_PER_MINUTE env var or 20 (EUR 49 plan).
   *   Set to 60 for EUR 129 plan.
   */
  constructor(apiKey?: string, tokensPerMinute?: number) {
    this.apiKey = apiKey || process.env.KEEPA_API_KEY || '';
    this.tokensPerMinute = tokensPerMinute
      ?? parseInt(process.env.KEEPA_TOKENS_PER_MINUTE ?? '20', 10);
  }

  /**
   * Check if the client has a valid API key configured.
   */
  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  /**
   * Fetch product data for a batch of ASINs from Amazon UK (domain 2).
   * Max 10 ASINs per request.
   */
  async fetchProducts(asins: string[]): Promise<KeepaProduct[]> {
    if (!this.isConfigured()) {
      throw new Error('Keepa API key not configured. Set KEEPA_API_KEY environment variable.');
    }

    // Filter out invalid ASINs (must be 10 alphanumeric characters)
    const validAsins = asins.filter(a => /^[A-Z0-9]{10}$/.test(a));
    if (validAsins.length === 0) {
      console.warn(`[Keepa] No valid ASINs in batch: ${asins.join(', ')}`);
      return [];
    }
    if (validAsins.length < asins.length) {
      const invalid = asins.filter(a => !validAsins.includes(a));
      console.warn(`[Keepa] Filtered ${invalid.length} invalid ASINs: ${invalid.join(', ')}`);
    }

    if (validAsins.length > 10) {
      throw new Error('Maximum 10 ASINs per Keepa request');
    }

    // Rate limiting: wait if needed
    await this.waitForRateLimit();

    const params = new URLSearchParams({
      key: this.apiKey,
      domain: '2', // Amazon UK
      asin: validAsins.join(','),
      stats: '90', // Include 90-day stats (for was_price_90d)
      buybox: '1', // Include buy box history
      history: '1', // Include full price history
    });

    const response = await this.fetchWithRetry(`${this.baseUrl}/product?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`Keepa API error: ${response.status} ${response.statusText}`);
    }

    const data: KeepaResponse = await response.json();

    this.tokensLeft = data.tokensLeft;
    this.lastRequestTime = Date.now();

    // Keepa may return partial results alongside an error (e.g. invalid ASINs in batch).
    // Only throw if there are zero products returned.
    if (data.error && (!data.products || data.products.length === 0)) {
      throw new Error(`Keepa API error: ${data.error.message}`);
    }
    if (data.error) {
      console.warn(`[Keepa] Partial error (${data.products?.length ?? 0} products returned): ${data.error.message}`);
    }

    return data.products ?? [];
  }

  /**
   * Extract daily price snapshots from a Keepa product.
   * Returns snapshots with buy box price, sales rank, and offer count.
   */
  extractSnapshots(
    product: KeepaProduct
  ): {
    date: string;
    buy_box_price: number | null;
    amazon_price: number | null;
    sales_rank: number | null;
    new_offer_count: number | null;
  }[] {
    const buyBoxPrices = parseKeepaCSV(product.csv?.[KEEPA_CSV_INDEX.BUY_BOX] ?? null);
    const amazonPrices = parseKeepaCSV(product.csv?.[KEEPA_CSV_INDEX.AMAZON] ?? null);
    const salesRanks = parseKeepaCSV(product.csv?.[KEEPA_CSV_INDEX.SALES_RANK] ?? null);
    const newOfferCounts = parseKeepaCSV(product.csv?.[KEEPA_CSV_INDEX.COUNT_NEW] ?? null);

    // Build a map of all dates
    const dateMap = new Map<
      string,
      {
        buy_box_price: number | null;
        amazon_price: number | null;
        sales_rank: number | null;
        new_offer_count: number | null;
      }
    >();

    // Populate with buy box prices (primary)
    for (const point of buyBoxPrices) {
      dateMap.set(point.date, {
        buy_box_price: keepaPriceToGBP(point.value),
        amazon_price: null,
        sales_rank: null,
        new_offer_count: null,
      });
    }

    // Fill in Amazon prices
    for (const point of amazonPrices) {
      const existing = dateMap.get(point.date);
      if (existing) {
        existing.amazon_price = keepaPriceToGBP(point.value);
      } else {
        dateMap.set(point.date, {
          buy_box_price: null,
          amazon_price: keepaPriceToGBP(point.value),
          sales_rank: null,
          new_offer_count: null,
        });
      }
    }

    // Fill in sales ranks
    for (const point of salesRanks) {
      const existing = dateMap.get(point.date);
      if (existing) {
        existing.sales_rank = point.value;
      }
    }

    // Fill in offer counts
    for (const point of newOfferCounts) {
      const existing = dateMap.get(point.date);
      if (existing) {
        existing.new_offer_count = point.value;
      }
    }

    // Sort by date and return
    return Array.from(dateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({ date, ...data }));
  }

  /**
   * Extract current pricing data from a Keepa product for the daily pricing sync.
   * Uses stats.current (preferred) with CSV fallback for non-buy-box fields.
   *
   * Note: BUY_BOX CSV uses triples [timestamp, price, shipping] not pairs,
   * so we must use stats.current for buy box price to avoid reading shipping as price.
   */
  extractCurrentPricing(product: KeepaProduct): {
    buyBoxPrice: number | null;
    salesRank: number | null;
    was90dAvg: number | null;
    offerCount: number | null;
    lowestNewPrice: number | null;
  } {
    const current = product.stats?.current ?? [];

    const getStatsCurrent = (csvIndex: number): number | null => {
      const value = current[csvIndex] ?? null;
      return value !== null && value >= 0 ? value : null;
    };

    const getLatestValue = (csvIndex: number): number | null => {
      const csv = product.csv?.[csvIndex];
      if (!csv || csv.length < 2) return null;
      // Standard CSV: pairs of [timestamp, value]
      const value = csv[csv.length - 1];
      return value >= 0 ? value : null;
    };

    // Use stats.current for BUY_BOX (avoids triple-format CSV issue) and NEW price
    // Fall back to CSV for sales rank and offer count (standard pair format)
    const buyBoxRaw = getStatsCurrent(KEEPA_CSV_INDEX.BUY_BOX) ?? getLatestValue(KEEPA_CSV_INDEX.BUY_BOX);
    const lowestNewRaw = getStatsCurrent(KEEPA_CSV_INDEX.NEW) ?? getLatestValue(KEEPA_CSV_INDEX.NEW);
    const salesRankRaw = getStatsCurrent(KEEPA_CSV_INDEX.SALES_RANK) ?? getLatestValue(KEEPA_CSV_INDEX.SALES_RANK);
    const offerCountRaw = getStatsCurrent(KEEPA_CSV_INDEX.COUNT_NEW) ?? getLatestValue(KEEPA_CSV_INDEX.COUNT_NEW);

    // 90-day average buy box from stats
    const was90dRaw = product.stats?.avg90?.[KEEPA_CSV_INDEX.BUY_BOX] ?? null;

    return {
      buyBoxPrice: buyBoxRaw !== null ? keepaPriceToGBP(buyBoxRaw) : null,
      salesRank: salesRankRaw,
      was90dAvg: was90dRaw !== null && was90dRaw >= 0 ? keepaPriceToGBP(was90dRaw) : null,
      offerCount: offerCountRaw,
      lowestNewPrice: lowestNewRaw !== null ? keepaPriceToGBP(lowestNewRaw) : null,
    };
  }

  /**
   * Batch lookup products by EAN/UPC codes from Amazon UK (domain 2).
   * Up to 100 comma-separated codes per request. 1 token per matched product.
   * Returns products without price history (history=0, stats=0).
   */
  async searchByCode(codes: string[]): Promise<KeepaProduct[]> {
    if (!this.isConfigured()) {
      throw new Error('Keepa API key not configured. Set KEEPA_API_KEY environment variable.');
    }

    if (codes.length > 100) {
      throw new Error('Maximum 100 codes per Keepa searchByCode request');
    }

    await this.waitForRateLimit();

    const params = new URLSearchParams({
      key: this.apiKey,
      domain: '2', // Amazon UK
      code: codes.join(','),
      history: '0',
      stats: '0',
    });

    const response = await this.fetchWithRetry(`${this.baseUrl}/product?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`Keepa API error: ${response.status} ${response.statusText}`);
    }

    const data: KeepaResponse = await response.json();

    if (data.error) {
      throw new Error(`Keepa API error: ${data.error.message}`);
    }

    this.tokensLeft = data.tokensLeft;
    this.lastRequestTime = Date.now();

    return data.products ?? [];
  }

  /**
   * Lightweight ASIN lookup: fetch product metadata (title, EAN) without price history.
   * Up to 100 ASINs per request, 1 token per product.
   */
  async fetchProductsLight(asins: string[]): Promise<KeepaProduct[]> {
    if (!this.isConfigured()) {
      throw new Error('Keepa API key not configured. Set KEEPA_API_KEY environment variable.');
    }

    if (asins.length > 100) {
      throw new Error('Maximum 100 ASINs per Keepa fetchProductsLight request');
    }

    await this.waitForRateLimit();

    const params = new URLSearchParams({
      key: this.apiKey,
      domain: '2', // Amazon UK
      asin: asins.join(','),
      history: '0',
      stats: '0',
    });

    const response = await this.fetchWithRetry(`${this.baseUrl}/product?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`Keepa API error: ${response.status} ${response.statusText}`);
    }

    const data: KeepaResponse = await response.json();

    if (data.error) {
      throw new Error(`Keepa API error: ${data.error.message}`);
    }

    this.tokensLeft = data.tokensLeft;
    this.lastRequestTime = Date.now();

    return data.products ?? [];
  }

  /**
   * Fetch LEGO product ASINs from Amazon UK using Product Finder.
   * 50 ASINs per page, 11 tokens per page.
   */
  async productFinder(page: number): Promise<{ asinList: string[]; totalResults: number }> {
    if (!this.isConfigured()) {
      throw new Error('Keepa API key not configured. Set KEEPA_API_KEY environment variable.');
    }

    await this.waitForRateLimit(11); // 11 tokens per Finder page

    const selection = JSON.stringify({
      brand: 'LEGO',
      productType: 0,
      page,
      perPage: 50,
    });

    const params = new URLSearchParams({
      key: this.apiKey,
      domain: '2', // Amazon UK
      selection,
    });

    const response = await this.fetchWithRetry(`${this.baseUrl}/query?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`Keepa API error: ${response.status} ${response.statusText}`);
    }

    const data: KeepaFinderResponse = await response.json();

    if (data.error) {
      throw new Error(`Keepa API error: ${data.error.message}`);
    }

    this.tokensLeft = data.tokensLeft;
    this.lastRequestTime = Date.now();

    return {
      asinList: data.asinList ?? [],
      totalResults: data.totalResults ?? 0,
    };
  }

  /** Current tokens remaining (updated after each request) */
  get remainingTokens(): number {
    return this.tokensLeft;
  }

  /**
   * Fetch with automatic 429 retry. Waits for token refill and retries up to maxRetries times.
   */
  private async fetchWithRetry(
    url: string,
    maxRetries = 3
  ): Promise<Response> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await fetch(url);

      if (response.status === 429) {
        if (attempt === maxRetries) {
          throw new Error(`Keepa API error: 429 Too Many Requests (after ${maxRetries} retries)`);
        }
        // Parse response to get refillIn
        try {
          const data = await response.json();
          const refillIn = data.refillIn ?? 60_000;
          const waitMs = Math.max(refillIn, 10_000) + 2_000;
          console.log(
            `[Keepa] 429 rate limited (attempt ${attempt + 1}/${maxRetries}), waiting ${Math.round(waitMs / 1000)}s for refill`
          );
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          // Also reset rate limit state
          this.tokensLeft = 0;
          await this.waitForRateLimit(1);
        } catch {
          // If we can't parse the response, wait a fixed 60s
          console.log(`[Keepa] 429 rate limited, waiting 60s`);
          await new Promise((resolve) => setTimeout(resolve, 60_000));
        }
        continue;
      }

      return response;
    }

    throw new Error('Unreachable');
  }

  /**
   * Token-aware rate limiter. Waits for token refill if balance is low,
   * and ensures a minimum gap between requests.
   *
   * @param tokensNeeded - Estimated tokens this request will consume (default: 3)
   */
  async waitForRateLimit(tokensNeeded = 3): Promise<void> {
    const minGapMs = 2_000; // 2s minimum gap between requests

    // Wait for minimum gap
    const elapsed = Date.now() - this.lastRequestTime;
    if (elapsed < minGapMs) {
      await new Promise((resolve) => setTimeout(resolve, minGapMs - elapsed));
    }

    // If we know our token balance is low, wait for refill
    // tokensLeft is updated after each request from Keepa's response
    if (this.tokensLeft > 0 && this.tokensLeft < tokensNeeded) {
      // At 60 tokens/min refill, wait proportionally
      const tokensShort = tokensNeeded - this.tokensLeft;
      const waitMs = Math.ceil((tokensShort / this.tokensPerMinute) * 60_000) + 2_000;
      console.log(
        `[Keepa] Waiting ${Math.round(waitMs / 1000)}s for token refill (have ${this.tokensLeft}, need ${tokensNeeded})`
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}
