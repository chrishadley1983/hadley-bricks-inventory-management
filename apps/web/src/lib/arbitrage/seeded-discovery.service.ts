/**
 * Seeded ASIN Discovery Service
 *
 * Discovers Amazon ASINs for Brickset sets using multi-strategy matching:
 * 1. EAN lookup (100% confidence)
 * 2. UPC lookup (95% confidence)
 * 3. Title exact match: "LEGO {set_number}" (85% confidence)
 * 4. Title fuzzy match: set name with Levenshtein (60-80% confidence)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@hadley-bricks/database';
import { AmazonCatalogClient, type CatalogSearchItem } from '../amazon/amazon-catalog.client';
import type { AmazonCredentials } from '../amazon/types';
import {
  calculateTitleMatchConfidence,
  extractSetNumber,
  isLegoProduct,
} from '../utils/levenshtein';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Rate limit delay between API calls (500ms = 2 req/sec) */
const DISCOVERY_RATE_LIMIT_MS = 500;

/** Number of sets to process before pausing */
const DISCOVERY_BATCH_SIZE = 100;

/** Pause between batches (5 seconds) */
const DISCOVERY_BATCH_PAUSE_MS = 5000;

// ============================================================================
// TYPES
// ============================================================================

/** Discovery status for a single set */
export type DiscoveryStatus = 'pending' | 'found' | 'not_found' | 'multiple' | 'excluded';

/** Match method used for discovery */
export type MatchMethod = 'ean' | 'upc' | 'title_exact' | 'title_fuzzy';

/** Brickset set with seeded_asins data */
export interface BricksetSetWithSeeded {
  id: string;
  seededAsinId: string;
  set_number: string;
  set_name: string;
  ean: string | null;
  upc: string | null;
  image_url: string | null;
}

/** Result of a single discovery attempt */
export interface DiscoveryAttemptResult {
  seededAsinId: string;
  status: DiscoveryStatus;
  asin: string | null;
  matchMethod: MatchMethod | null;
  matchConfidence: number | null;
  amazonTitle: string | null;
  amazonImageUrl: string | null;
  amazonBrand: string | null;
  alternativeAsins: AlternativeAsin[] | null;
  error: string | null;
}

/** Alternative ASIN for multiple matches */
export interface AlternativeAsin {
  asin: string;
  title: string;
  confidence: number;
}

/** Overall discovery job result */
export interface DiscoveryResult {
  processed: number;
  found: number;
  notFound: number;
  multiple: number;
  errors: number;
  durationMs: number;
}

/** Progress callback signature */
export type DiscoveryProgressCallback = (
  processed: number,
  total: number,
  found: number,
  currentSet?: string
) => void;

/** Discovery job state for resumability */
export interface DiscoveryJobState {
  status: 'idle' | 'running' | 'paused' | 'completed';
  totalSets: number;
  processedSets: number;
  foundAsins: number;
  lastProcessedId: string | null;
  startedAt: string;
  lastActivityAt: string;
}

// ============================================================================
// SERVICE CLASS
// ============================================================================

/**
 * Seeded ASIN Discovery Service
 *
 * Discovers Amazon ASINs for Brickset sets using multi-strategy matching.
 */
export class SeededAsinDiscoveryService {
  private catalogClient: AmazonCatalogClient;

  constructor(
    private supabase: SupabaseClient<Database>,
    credentials: AmazonCredentials
  ) {
    this.catalogClient = new AmazonCatalogClient(credentials);
  }

  // ==========================================================================
  // PUBLIC METHODS
  // ==========================================================================

  /**
   * Initialize seeded_asins table from brickset_sets
   *
   * Calls the database function to create seeded_asins records for all
   * brickset_sets that don't have one yet.
   *
   * @returns Count of created and skipped records
   */
  async initializeSeededAsins(): Promise<{ created: number; skipped: number }> {
    console.log('[SeededDiscovery] Initializing seeded_asins from brickset_sets...');

    // Call the database function which has SECURITY DEFINER to bypass RLS
    const { data, error } = await this.supabase.rpc('initialize_seeded_asins');

    if (error) {
      console.error('[SeededDiscovery] RPC error:', error);
      throw new Error(`Failed to initialize seeded_asins: ${error.message}`);
    }

    // The function returns an array with a single row containing created_count and skipped_count
    const result = Array.isArray(data) ? data[0] : data;
    const created = result?.created_count ?? 0;
    const skipped = result?.skipped_count ?? 0;

    console.log(`[SeededDiscovery] Initialized: ${created} created, ${skipped} already existed`);

    return {
      created,
      skipped,
    };
  }

  /**
   * Get discovery status summary
   *
   * @returns Summary of discovery progress
   */
  async getDiscoverySummary(): Promise<{
    pending: number;
    found: number;
    notFound: number;
    multiple: number;
    excluded: number;
    total: number;
    foundPercent: number;
    avgConfidence: number | null;
    lastDiscoveryAt: string | null;
  }> {
    // Calculate summary from seeded_asins table directly
    const { data: allRecords, error } = await this.supabase
      .from('seeded_asins')
      .select('discovery_status, match_confidence, last_discovery_attempt_at');

    if (error) {
      console.error('[SeededDiscovery] Failed to get summary:', error);
      throw new Error(`Failed to get discovery summary: ${error.message}`);
    }

    const records = allRecords ?? [];
    const total = records.length;

    // Count by status
    const statusCounts = records.reduce(
      (acc, row) => {
        acc[row.discovery_status] = (acc[row.discovery_status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    // Calculate average confidence for found items
    const foundItems = records.filter(
      (r) => r.discovery_status === 'found' && r.match_confidence != null
    );
    const avgConfidence =
      foundItems.length > 0
        ? Math.round(
            (foundItems.reduce((sum, r) => sum + (r.match_confidence ?? 0), 0) /
              foundItems.length) *
              100
          ) / 100
        : null;

    // Find most recent discovery attempt
    const lastDiscoveryAt = records.reduce((latest: string | null, r) => {
      if (!r.last_discovery_attempt_at) return latest;
      if (!latest) return r.last_discovery_attempt_at;
      return r.last_discovery_attempt_at > latest ? r.last_discovery_attempt_at : latest;
    }, null);

    const foundCount = statusCounts.found ?? 0;

    return {
      pending: statusCounts.pending ?? 0,
      found: foundCount,
      notFound: statusCounts.not_found ?? 0,
      multiple: statusCounts.multiple ?? 0,
      excluded: statusCounts.excluded ?? 0,
      total,
      foundPercent: total > 0 ? Math.round((foundCount / total) * 100) : 0,
      avgConfidence,
      lastDiscoveryAt,
    };
  }

  /**
   * Run discovery for pending sets
   *
   * @param limit - Maximum sets to process (default 1000)
   * @param resumeFrom - Optional seeded_asin ID to resume from
   * @param onProgress - Optional progress callback
   * @returns Discovery result summary
   */
  async runDiscovery(
    limit: number = 1000,
    resumeFrom?: string,
    onProgress?: DiscoveryProgressCallback
  ): Promise<DiscoveryResult> {
    const startTime = Date.now();

    console.log(
      `[SeededDiscovery] Starting discovery run (limit: ${limit}, resume: ${resumeFrom ?? 'none'})`
    );

    // Get pending sets
    const pendingSets = await this.getPendingSets(limit, resumeFrom);

    if (pendingSets.length === 0) {
      console.log('[SeededDiscovery] No pending sets to process');
      return {
        processed: 0,
        found: 0,
        notFound: 0,
        multiple: 0,
        errors: 0,
        durationMs: Date.now() - startTime,
      };
    }

    let processed = 0;
    let found = 0;
    let notFound = 0;
    let multiple = 0;
    let errors = 0;

    for (const set of pendingSets) {
      try {
        const result = await this.discoverAsinForSet(set);

        if (result.status === 'found') found++;
        else if (result.status === 'not_found') notFound++;
        else if (result.status === 'multiple') multiple++;
      } catch (err) {
        errors++;
        await this.recordDiscoveryError(
          set.seededAsinId,
          err instanceof Error ? err.message : String(err)
        );
      }

      processed++;
      onProgress?.(processed, pendingSets.length, found, set.set_number);

      // Rate limiting
      await this.delay(DISCOVERY_RATE_LIMIT_MS);

      // Batch pause
      if (processed % DISCOVERY_BATCH_SIZE === 0 && processed < pendingSets.length) {
        console.log(`[SeededDiscovery] Processed ${processed}/${pendingSets.length}, pausing...`);
        await this.delay(DISCOVERY_BATCH_PAUSE_MS);
      }
    }

    const result = {
      processed,
      found,
      notFound,
      multiple,
      errors,
      durationMs: Date.now() - startTime,
    };

    console.log(`[SeededDiscovery] Discovery complete: ${JSON.stringify(result)}`);

    return result;
  }

  /**
   * Retry discovery for not_found sets
   *
   * @param limit - Maximum sets to process
   * @param onProgress - Optional progress callback
   * @returns Discovery result summary
   */
  async retryNotFound(
    limit: number = 1000,
    onProgress?: DiscoveryProgressCallback
  ): Promise<DiscoveryResult> {
    const startTime = Date.now();

    console.log(`[SeededDiscovery] Retrying not_found sets (limit: ${limit})`);

    // Get not_found sets
    const notFoundSets = await this.getNotFoundSets(limit);

    if (notFoundSets.length === 0) {
      console.log('[SeededDiscovery] No not_found sets to retry');
      return {
        processed: 0,
        found: 0,
        notFound: 0,
        multiple: 0,
        errors: 0,
        durationMs: Date.now() - startTime,
      };
    }

    // Reset status to pending before retrying
    await this.resetToPending(notFoundSets.map((s) => s.seededAsinId));

    return this.runDiscovery(limit, undefined, onProgress);
  }

  // ==========================================================================
  // PRIVATE METHODS - DISCOVERY LOGIC
  // ==========================================================================

  /**
   * Discover ASIN for a single Brickset set
   *
   * Uses cascading match strategies:
   * 1. EAN lookup (100% confidence)
   * 2. UPC lookup (95% confidence)
   * 3. Title exact match (85% confidence)
   * 4. Title fuzzy match (60-80% confidence)
   */
  private async discoverAsinForSet(set: BricksetSetWithSeeded): Promise<DiscoveryAttemptResult> {
    console.log(`[SeededDiscovery] Discovering ASIN for set: ${set.set_number}`);

    // Helper to check if barcode is valid (not scientific notation from corrupted import)
    const isValidBarcode = (code: string | null): code is string => {
      if (!code) return false;
      // Skip scientific notation (e.g., "5.70E+12") - these are corrupted values
      if (code.includes('E+') || code.includes('e+')) return false;
      // EAN should be 13 digits, UPC should be 12 digits
      return /^\d{12,13}$/.test(code);
    };

    // Strategy 1: EAN lookup (100% confidence)
    if (isValidBarcode(set.ean)) {
      const result = await this.tryIdentifierLookup(set.ean, 'EAN', 100);
      if (result.found) {
        return this.saveDiscoveryResult(set.seededAsinId, {
          status: result.asins.length > 1 ? 'multiple' : 'found',
          asin: result.asins[0]?.asin ?? null,
          matchMethod: 'ean',
          matchConfidence: 100,
          amazonTitle: result.asins[0]?.title ?? null,
          amazonImageUrl: result.asins[0]?.imageUrl ?? null,
          amazonBrand: result.asins[0]?.brand ?? null,
          alternativeAsins:
            result.asins.length > 1
              ? result.asins.map((a) => ({
                  asin: a.asin,
                  title: a.title ?? '',
                  confidence: 100,
                }))
              : null,
        });
      }
    }

    // Strategy 2: UPC lookup (95% confidence)
    if (isValidBarcode(set.upc)) {
      const result = await this.tryIdentifierLookup(set.upc, 'UPC', 95);
      if (result.found) {
        return this.saveDiscoveryResult(set.seededAsinId, {
          status: result.asins.length > 1 ? 'multiple' : 'found',
          asin: result.asins[0]?.asin ?? null,
          matchMethod: 'upc',
          matchConfidence: 95,
          amazonTitle: result.asins[0]?.title ?? null,
          amazonImageUrl: result.asins[0]?.imageUrl ?? null,
          amazonBrand: result.asins[0]?.brand ?? null,
          alternativeAsins:
            result.asins.length > 1
              ? result.asins.map((a) => ({
                  asin: a.asin,
                  title: a.title ?? '',
                  confidence: 95,
                }))
              : null,
        });
      }
    }

    // Strategy 3: Title exact match with set number (85% confidence)
    const setNumber = set.set_number.replace(/-\d+$/, ''); // Remove variant suffix
    const exactResult = await this.tryTitleSearch(`LEGO ${setNumber}`, set.set_name, setNumber);
    if (exactResult.found && exactResult.confidence >= 85) {
      return this.saveDiscoveryResult(set.seededAsinId, {
        status: exactResult.asins.length > 1 ? 'multiple' : 'found',
        asin: exactResult.asins[0]?.asin ?? null,
        matchMethod: 'title_exact',
        matchConfidence: exactResult.confidence,
        amazonTitle: exactResult.asins[0]?.title ?? null,
        amazonImageUrl: exactResult.asins[0]?.imageUrl ?? null,
        amazonBrand: exactResult.asins[0]?.brand ?? null,
        alternativeAsins:
          exactResult.asins.length > 1
            ? exactResult.asins.map((a) => ({
                asin: a.asin,
                title: a.title ?? '',
                confidence: exactResult.confidence,
              }))
            : null,
      });
    }

    // Strategy 4: Fuzzy title match (60-80% confidence)
    const fuzzyResult = await this.tryTitleSearch(set.set_name, set.set_name, setNumber);
    if (fuzzyResult.found && fuzzyResult.confidence >= 60) {
      // If multiple results, mark for review
      if (fuzzyResult.asins.length > 1) {
        return this.saveDiscoveryResult(set.seededAsinId, {
          status: 'multiple',
          asin: fuzzyResult.asins[0]?.asin ?? null,
          matchMethod: 'title_fuzzy',
          matchConfidence: fuzzyResult.confidence,
          amazonTitle: fuzzyResult.asins[0]?.title ?? null,
          amazonImageUrl: fuzzyResult.asins[0]?.imageUrl ?? null,
          amazonBrand: fuzzyResult.asins[0]?.brand ?? null,
          alternativeAsins: fuzzyResult.asins.map((a) => ({
            asin: a.asin,
            title: a.title ?? '',
            confidence: fuzzyResult.confidence,
          })),
        });
      }

      return this.saveDiscoveryResult(set.seededAsinId, {
        status: 'found',
        asin: fuzzyResult.asins[0]?.asin ?? null,
        matchMethod: 'title_fuzzy',
        matchConfidence: fuzzyResult.confidence,
        amazonTitle: fuzzyResult.asins[0]?.title ?? null,
        amazonImageUrl: fuzzyResult.asins[0]?.imageUrl ?? null,
        amazonBrand: fuzzyResult.asins[0]?.brand ?? null,
        alternativeAsins: null,
      });
    }

    // No match found
    return this.saveDiscoveryResult(set.seededAsinId, {
      status: 'not_found',
      asin: null,
      matchMethod: null,
      matchConfidence: null,
      amazonTitle: null,
      amazonImageUrl: null,
      amazonBrand: null,
      alternativeAsins: null,
    });
  }

  /**
   * Try to find ASIN by identifier (EAN/UPC)
   */
  private async tryIdentifierLookup(
    identifier: string,
    type: 'EAN' | 'UPC',
    _confidence: number
  ): Promise<{
    found: boolean;
    asins: CatalogSearchItem[];
  }> {
    try {
      const result = await this.catalogClient.searchCatalogByIdentifier(identifier, type);

      // Filter to likely LEGO products
      const legoItems = result.items.filter((item) => !item.title || isLegoProduct(item.title));

      return {
        found: legoItems.length > 0,
        asins: legoItems,
      };
    } catch (error) {
      console.warn(`[SeededDiscovery] ${type} lookup failed for ${identifier}:`, error);
      return { found: false, asins: [] };
    }
  }

  /**
   * Try to find ASIN by title search
   */
  private async tryTitleSearch(
    keywords: string,
    expectedName: string,
    setNumber: string
  ): Promise<{
    found: boolean;
    asins: CatalogSearchItem[];
    confidence: number;
  }> {
    try {
      const result = await this.catalogClient.searchCatalogByKeywords(keywords);

      if (result.items.length === 0) {
        return { found: false, asins: [], confidence: 0 };
      }

      // Filter and score results
      const scoredItems = result.items
        .filter((item) => item.title && isLegoProduct(item.title))
        .map((item) => ({
          ...item,
          confidence: calculateTitleMatchConfidence(item.title ?? '', expectedName, setNumber),
        }))
        .filter((item) => item.confidence >= 60)
        .sort((a, b) => b.confidence - a.confidence);

      if (scoredItems.length === 0) {
        return { found: false, asins: [], confidence: 0 };
      }

      // Check for set number match (boost confidence)
      const setNumberMatch = scoredItems.find((item) => {
        const extractedNumber = extractSetNumber(item.title ?? '');
        return extractedNumber === setNumber;
      });

      const bestMatch = setNumberMatch ?? scoredItems[0];

      return {
        found: true,
        asins: setNumberMatch ? [setNumberMatch] : scoredItems.slice(0, 3),
        confidence: bestMatch.confidence,
      };
    } catch (error) {
      console.warn(`[SeededDiscovery] Title search failed for "${keywords}":`, error);
      return { found: false, asins: [], confidence: 0 };
    }
  }

  // ==========================================================================
  // PRIVATE METHODS - DATABASE
  // ==========================================================================

  /**
   * Get pending sets for discovery
   * Uses pagination to handle Supabase's 1000 row default limit
   */
  private async getPendingSets(
    limit: number,
    resumeFrom?: string
  ): Promise<BricksetSetWithSeeded[]> {
    const results: BricksetSetWithSeeded[] = [];
    const pageSize = 1000; // Supabase max per request
    let offset = 0;

    while (results.length < limit) {
      const currentLimit = Math.min(pageSize, limit - results.length);

      let query = this.supabase
        .from('seeded_asins')
        .select(
          `
          id,
          brickset_set_id,
          brickset_sets!inner(
            id,
            set_number,
            set_name,
            ean,
            upc,
            image_url
          )
        `
        )
        .eq('discovery_status', 'pending')
        .order('id')
        .range(offset, offset + currentLimit - 1);

      if (resumeFrom) {
        query = query.gt('id', resumeFrom);
      }

      const { data, error } = await query;

      if (error) {
        console.error('[SeededDiscovery] Failed to get pending sets:', error);
        throw new Error(`Failed to get pending sets: ${error.message}`);
      }

      if (!data || data.length === 0) {
        break; // No more results
      }

      const mapped = data.map((row) => {
        const bs = row.brickset_sets as unknown as {
          id: string;
          set_number: string;
          set_name: string;
          ean: string | null;
          upc: string | null;
          image_url: string | null;
        };
        return {
          id: bs.id,
          seededAsinId: row.id,
          set_number: bs.set_number,
          set_name: bs.set_name,
          ean: bs.ean,
          upc: bs.upc,
          image_url: bs.image_url,
        };
      });

      results.push(...mapped);
      offset += data.length;

      // If we got fewer than requested, we've reached the end
      if (data.length < currentLimit) {
        break;
      }
    }

    console.log(`[SeededDiscovery] Fetched ${results.length} pending sets (requested: ${limit})`);
    return results;
  }

  /**
   * Get not_found sets for retry
   */
  private async getNotFoundSets(limit: number): Promise<BricksetSetWithSeeded[]> {
    const { data, error } = await this.supabase
      .from('seeded_asins')
      .select(
        `
        id,
        brickset_set_id,
        brickset_sets!inner(
          id,
          set_number,
          set_name,
          ean,
          upc,
          image_url
        )
      `
      )
      .eq('discovery_status', 'not_found')
      .order('last_discovery_attempt_at', { ascending: true, nullsFirst: true })
      .limit(limit);

    if (error) {
      console.error('[SeededDiscovery] Failed to get not_found sets:', error);
      throw new Error(`Failed to get not_found sets: ${error.message}`);
    }

    return (data ?? []).map((row) => {
      const bs = row.brickset_sets as unknown as {
        id: string;
        set_number: string;
        set_name: string;
        ean: string | null;
        upc: string | null;
        image_url: string | null;
      };
      return {
        id: bs.id,
        seededAsinId: row.id,
        set_number: bs.set_number,
        set_name: bs.set_name,
        ean: bs.ean,
        upc: bs.upc,
        image_url: bs.image_url,
      };
    });
  }

  /**
   * Reset sets to pending status
   */
  private async resetToPending(seededAsinIds: string[]): Promise<void> {
    const { error } = await this.supabase
      .from('seeded_asins')
      .update({
        discovery_status: 'pending',
        discovery_attempts: 0,
        discovery_error: null,
      })
      .in('id', seededAsinIds);

    if (error) {
      console.error('[SeededDiscovery] Failed to reset to pending:', error);
      throw new Error(`Failed to reset to pending: ${error.message}`);
    }
  }

  /**
   * Save discovery result to database
   */
  private async saveDiscoveryResult(
    seededAsinId: string,
    result: Omit<DiscoveryAttemptResult, 'seededAsinId' | 'error'>
  ): Promise<DiscoveryAttemptResult> {
    const { data: existingData } = await this.supabase
      .from('seeded_asins')
      .select('discovery_attempts')
      .eq('id', seededAsinId)
      .single();

    const currentAttempts = (existingData?.discovery_attempts ?? 0) + 1;

    const { error } = await this.supabase
      .from('seeded_asins')
      .update({
        discovery_status: result.status,
        asin: result.asin,
        match_method: result.matchMethod,
        match_confidence: result.matchConfidence,
        amazon_title: result.amazonTitle,
        amazon_image_url: result.amazonImageUrl,
        amazon_brand: result.amazonBrand,
        alternative_asins: result.alternativeAsins as unknown as Json,
        last_discovery_attempt_at: new Date().toISOString(),
        discovery_attempts: currentAttempts,
        discovery_error: null,
      })
      .eq('id', seededAsinId);

    if (error) {
      // Handle duplicate ASIN constraint violation
      if (error.code === '23505' && error.message.includes('idx_seeded_asins_asin_unique')) {
        console.log(
          `[SeededDiscovery] ASIN ${result.asin} already assigned to another set, marking as duplicate`
        );

        // Save without the ASIN in the main field, store in alternative_asins instead
        const alternativeAsins = result.alternativeAsins ?? [];
        if (result.asin && !alternativeAsins.some((a) => a.asin === result.asin)) {
          alternativeAsins.unshift({
            asin: result.asin,
            title: result.amazonTitle ?? '',
            confidence: result.matchConfidence ?? 0,
          });
        }

        const { error: retryError } = await this.supabase
          .from('seeded_asins')
          .update({
            discovery_status: 'multiple', // Mark as multiple since ASIN is shared
            asin: null, // Don't set the ASIN since it's already used
            match_method: result.matchMethod,
            match_confidence: result.matchConfidence,
            amazon_title: result.amazonTitle,
            amazon_image_url: result.amazonImageUrl,
            amazon_brand: result.amazonBrand,
            alternative_asins: alternativeAsins as unknown as Json,
            last_discovery_attempt_at: new Date().toISOString(),
            discovery_attempts: currentAttempts,
            discovery_error: `ASIN ${result.asin} already assigned to another set`,
          })
          .eq('id', seededAsinId);

        if (retryError) {
          console.error('[SeededDiscovery] Failed to save duplicate ASIN result:', retryError);
        }

        return {
          seededAsinId,
          ...result,
          status: 'multiple',
          asin: null,
          error: null,
        };
      }

      console.error('[SeededDiscovery] Failed to save result:', error);
      // Don't throw - log and continue
    }

    return {
      seededAsinId,
      ...result,
      error: null,
    };
  }

  /**
   * Record discovery error
   */
  private async recordDiscoveryError(seededAsinId: string, errorMessage: string): Promise<void> {
    const { error } = await this.supabase
      .from('seeded_asins')
      .update({
        last_discovery_attempt_at: new Date().toISOString(),
        discovery_error: errorMessage,
      })
      .eq('id', seededAsinId);

    if (error) {
      console.error('[SeededDiscovery] Failed to record error:', error);
    }
  }

  // ==========================================================================
  // PRIVATE METHODS - UTILITIES
  // ==========================================================================

  /**
   * Delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Factory function to create a Seeded ASIN Discovery service
 */
export function createSeededDiscoveryService(
  supabase: SupabaseClient<Database>,
  credentials: AmazonCredentials
): SeededAsinDiscoveryService {
  return new SeededAsinDiscoveryService(supabase, credentials);
}
