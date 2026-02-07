/**
 * Keepa Import Service
 *
 * Orchestrates importing historical Amazon UK price data from Keepa
 * into the price_snapshots table. Processes ASINs in batches of 10,
 * respecting Keepa rate limits.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  KeepaClient,
  type KeepaProduct,
  type KeepaImportResult,
} from './keepa-client';

export interface KeepaImportOptions {
  /** Specific ASINs to import */
  asins?: string[];
  /** If true, fetch ASINs for all retired sets */
  retiredSets?: boolean;
  /** Dry run - don't write to database */
  dryRun?: boolean;
}

export interface KeepaImportSummary {
  total_asins: number;
  total_snapshots_imported: number;
  successful: number;
  failed: number;
  skipped_no_data: number;
  results: KeepaImportResult[];
  duration_ms: number;
}

export class KeepaImportService {
  private supabase: SupabaseClient;
  private keepa: KeepaClient;

  constructor(supabase: SupabaseClient, keepaApiKey?: string) {
    this.supabase = supabase;
    this.keepa = new KeepaClient(keepaApiKey);
  }

  /**
   * Import historical price data from Keepa for the given ASINs or retired sets.
   */
  async importPriceData(options: KeepaImportOptions): Promise<KeepaImportSummary> {
    const startTime = Date.now();
    const results: KeepaImportResult[] = [];

    // Resolve ASINs to import
    const asins = await this.resolveAsins(options);

    if (asins.length === 0) {
      return {
        total_asins: 0,
        total_snapshots_imported: 0,
        successful: 0,
        failed: 0,
        skipped_no_data: 0,
        results: [],
        duration_ms: Date.now() - startTime,
      };
    }

    // Build ASIN -> set_num mapping for storing snapshots
    const asinToSetNum = await this.buildAsinSetNumMap(asins);

    // Process in batches of 10 (Keepa max per request)
    const batchSize = 10;
    for (let i = 0; i < asins.length; i += batchSize) {
      const batch = asins.slice(i, i + batchSize);
      const batchResults = await this.processBatch(batch, asinToSetNum, options.dryRun ?? false);
      results.push(...batchResults);
    }

    const successful = results.filter((r) => !r.error).length;
    const failed = results.filter((r) => r.error).length;
    const skippedNoData = results.filter((r) => r.snapshots_imported === 0 && !r.error).length;

    return {
      total_asins: asins.length,
      total_snapshots_imported: results.reduce((sum, r) => sum + r.snapshots_imported, 0),
      successful,
      failed,
      skipped_no_data: skippedNoData,
      results,
      duration_ms: Date.now() - startTime,
    };
  }

  /**
   * Resolve which ASINs to import based on options.
   */
  private async resolveAsins(options: KeepaImportOptions): Promise<string[]> {
    if (options.asins && options.asins.length > 0) {
      return options.asins;
    }

    if (options.retiredSets) {
      return this.fetchRetiredSetAsins();
    }

    // Default: fetch all sets with ASINs
    return this.fetchAllSetAsins();
  }

  /**
   * Fetch ASINs for retired sets from brickset_sets.
   */
  private async fetchRetiredSetAsins(): Promise<string[]> {
    const asins: string[] = [];
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('brickset_sets')
        .select('amazon_asin')
        .eq('retirement_status' as string, 'retired')
        .eq('has_amazon_listing' as string, true)
        .not('amazon_asin' as string, 'is', null)
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        console.error('[KeepaImport] Error fetching retired set ASINs:', error.message);
        break;
      }

      if (!data || data.length === 0) {
        hasMore = false;
        break;
      }

      for (const row of data) {
        const asin = (row as unknown as Record<string, unknown>).amazon_asin as string;
        if (asin) asins.push(asin);
      }

      hasMore = data.length === pageSize;
      page++;
    }

    return [...new Set(asins)]; // Deduplicate
  }

  /**
   * Fetch all ASINs from brickset_sets that have Amazon listings.
   */
  private async fetchAllSetAsins(): Promise<string[]> {
    const asins: string[] = [];
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('brickset_sets')
        .select('amazon_asin')
        .eq('has_amazon_listing' as string, true)
        .not('amazon_asin' as string, 'is', null)
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        console.error('[KeepaImport] Error fetching ASINs:', error.message);
        break;
      }

      if (!data || data.length === 0) {
        hasMore = false;
        break;
      }

      for (const row of data) {
        const asin = (row as unknown as Record<string, unknown>).amazon_asin as string;
        if (asin) asins.push(asin);
      }

      hasMore = data.length === pageSize;
      page++;
    }

    return [...new Set(asins)];
  }

  /**
   * Build a mapping of ASIN -> set_num for database storage.
   */
  private async buildAsinSetNumMap(asins: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const pageSize = 1000;

    // Process in chunks to avoid query limits
    for (let i = 0; i < asins.length; i += pageSize) {
      const chunk = asins.slice(i, i + pageSize);
      const { data, error } = await this.supabase
        .from('brickset_sets')
        .select('set_number, amazon_asin')
        .in('amazon_asin' as string, chunk);

      if (error) {
        console.error('[KeepaImport] Error building ASIN map:', error.message);
        continue;
      }

      for (const row of (data ?? [])) {
        const record = row as unknown as Record<string, unknown>;
        const asin = record.amazon_asin as string;
        const setNum = record.set_number as string;
        if (asin && setNum) {
          map.set(asin, setNum);
        }
      }
    }

    return map;
  }

  /**
   * Process a batch of ASINs through Keepa API and store results.
   */
  private async processBatch(
    asins: string[],
    asinToSetNum: Map<string, string>,
    dryRun: boolean
  ): Promise<KeepaImportResult[]> {
    const results: KeepaImportResult[] = [];

    try {
      console.log(`[KeepaImport] Fetching batch of ${asins.length} ASINs...`);
      const products = await this.keepa.fetchProducts(asins);

      for (const product of products) {
        const result = await this.processProduct(product, asinToSetNum, dryRun);
        results.push(result);
      }

      // Handle ASINs not returned by Keepa
      const returnedAsins = new Set(products.map((p) => p.asin));
      for (const asin of asins) {
        if (!returnedAsins.has(asin)) {
          results.push({
            asin,
            snapshots_imported: 0,
            date_range: null,
            error: 'Not found in Keepa response',
          });
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[KeepaImport] Batch error:', errorMsg);

      // Mark all ASINs in batch as failed
      for (const asin of asins) {
        results.push({
          asin,
          snapshots_imported: 0,
          date_range: null,
          error: errorMsg,
        });
      }
    }

    return results;
  }

  /**
   * Process a single Keepa product: extract snapshots and store in price_snapshots.
   */
  private async processProduct(
    product: KeepaProduct,
    asinToSetNum: Map<string, string>,
    dryRun: boolean
  ): Promise<KeepaImportResult> {
    const setNum = asinToSetNum.get(product.asin);
    if (!setNum) {
      return {
        asin: product.asin,
        snapshots_imported: 0,
        date_range: null,
        error: `No set_num mapping found for ASIN ${product.asin}`,
      };
    }

    const snapshots = this.keepa.extractSnapshots(product);

    if (snapshots.length === 0) {
      return {
        asin: product.asin,
        snapshots_imported: 0,
        date_range: null,
      };
    }

    if (dryRun) {
      return {
        asin: product.asin,
        snapshots_imported: snapshots.length,
        date_range: {
          from: snapshots[0].date,
          to: snapshots[snapshots.length - 1].date,
        },
      };
    }

    // Upsert snapshots into price_snapshots table
    const rows = snapshots.map((s) => ({
      set_num: setNum,
      date: s.date,
      source: 'keepa_amazon_buybox' as const,
      price_gbp: s.buy_box_price ?? s.amazon_price,
      sales_rank: s.sales_rank,
      seller_count: s.new_offer_count,
      raw_data: {
        buy_box_price: s.buy_box_price,
        amazon_price: s.amazon_price,
        sales_rank: s.sales_rank,
        new_offer_count: s.new_offer_count,
        keepa_asin: product.asin,
      },
    }));

    // Upsert in chunks of 500
    let imported = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await this.supabase
        .from('price_snapshots')
        .upsert(chunk as unknown as Record<string, unknown>[], {
          onConflict: 'set_num,date,source',
        });

      if (error) {
        console.error(`[KeepaImport] Upsert error for ${product.asin}:`, error.message);
        return {
          asin: product.asin,
          snapshots_imported: imported,
          date_range: imported > 0
            ? { from: snapshots[0].date, to: snapshots[imported - 1].date }
            : null,
          error: error.message,
        };
      }

      imported += chunk.length;
    }

    console.log(
      `[KeepaImport] ${product.asin} (${setNum}): ${imported} snapshots from ${snapshots[0].date} to ${snapshots[snapshots.length - 1].date}`
    );

    return {
      asin: product.asin,
      snapshots_imported: imported,
      date_range: {
        from: snapshots[0].date,
        to: snapshots[snapshots.length - 1].date,
      },
    };
  }
}
