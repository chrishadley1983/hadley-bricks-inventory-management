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

export interface KeepaProduct {
  asin: string;
  /** CSV-encoded price history: [timestamp, price, timestamp, price, ...] */
  csv: (number[] | null)[];
  /** Product title */
  title?: string;
  /** Sales rank history */
  salesRanks?: Record<string, number[]>;
}

export interface KeepaResponse {
  timestamp: number;
  tokensLeft: number;
  refillIn: number;
  refillRate: number;
  products?: KeepaProduct[];
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
  NEW: 1,           // Marketplace new price
  USED: 2,          // Marketplace used price
  SALES_RANK: 3,    // Sales rank
  BUY_BOX: 18,      // Buy box price
  COUNT_NEW: 11,    // New offer count
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
  private tokensPerMinute = 20;
  private lastRequestTime = 0;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.KEEPA_API_KEY || '';
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

    if (asins.length > 10) {
      throw new Error('Maximum 10 ASINs per Keepa request');
    }

    // Rate limiting: wait if needed
    await this.waitForRateLimit();

    const params = new URLSearchParams({
      key: this.apiKey,
      domain: '2', // Amazon UK
      asin: asins.join(','),
      stats: '365', // Include 365-day stats
      buybox: '1', // Include buy box history
      history: '1', // Include full price history
    });

    const response = await fetch(`${this.baseUrl}/product?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`Keepa API error: ${response.status} ${response.statusText}`);
    }

    const data: KeepaResponse = await response.json();

    if (data.error) {
      throw new Error(`Keepa API error: ${data.error.message}`);
    }

    this.lastRequestTime = Date.now();

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
   * Simple rate limiter: ensures minimum gap between requests.
   * Keepa allows 20 tokens/min, each request costs ~3 tokens,
   * so ~6 requests/min or one every 10 seconds.
   */
  private async waitForRateLimit(): Promise<void> {
    const minGapMs = 10_000; // 10 seconds between requests
    const elapsed = Date.now() - this.lastRequestTime;
    if (elapsed < minGapMs) {
      const waitMs = minGapMs - elapsed;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}
