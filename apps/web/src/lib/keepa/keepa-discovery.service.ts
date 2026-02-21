/**
 * Keepa ASIN Discovery Service
 *
 * Discovers Amazon ASINs for brickset_sets using two Keepa-based strategies:
 *
 * Phase 1: EAN Discovery - Batch lookup by EAN codes (1 token/match, 100 codes/request)
 * Phase 2: Product Finder - Dump all LEGO ASINs then match by title (11 tokens/page)
 *
 * Both phases are resumable and budget-aware to work within Vercel's 5-min timeout.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { KeepaClient, type KeepaProduct } from './keepa-client';
import { extractSetNumber, calculateTitleMatchConfidence } from '@/lib/utils/levenshtein';

/** Safety margin: stop 60s before Vercel's 300s limit */
const TIMEOUT_SAFETY_MS = 240_000;

export interface DiscoveryStats {
  processed: number;
  matched: number;
  not_matched: number;
  tokens_used: number;
  duration_ms: number;
  errors: string[];
}

export interface DiscoveryResult {
  success: boolean;
  phase: 'ean' | 'finder';
  stats: DiscoveryStats;
  resume: { offset?: number; finderPage?: number } | null;
}

export class KeepaDiscoveryService {
  private supabase: SupabaseClient;
  private keepa: KeepaClient;

  constructor(supabase: SupabaseClient, keepaApiKey?: string) {
    this.supabase = supabase;
    this.keepa = new KeepaClient(keepaApiKey);
  }

  /**
   * Phase 1: Discover ASINs by EAN batch lookup.
   *
   * Fetches brickset_sets with EANs that have no 'found' match in seeded_asins,
   * then batch-queries Keepa to find matching ASINs.
   *
   * @param offset - Resume cursor (number of sets already processed)
   * @param limit - Max sets to process (0 = all within timeout)
   * @param dryRun - Preview without writing
   */
  async discoverByEan(offset = 0, limit = 0, dryRun = false): Promise<DiscoveryResult> {
    const startTime = Date.now();
    const stats: DiscoveryStats = {
      processed: 0,
      matched: 0,
      not_matched: 0,
      tokens_used: 0,
      duration_ms: 0,
      errors: [],
    };

    // 1. Get brickset_set IDs that already have a 'found' match in seeded_asins
    const foundSetIds = await this.getFoundSetIds();

    // 2. Fetch brickset_sets with EAN that haven't been matched yet
    const unmatchedSets = await this.getUnmatchedSetsWithEan(foundSetIds, offset, limit);

    if (unmatchedSets.length === 0) {
      stats.duration_ms = Date.now() - startTime;
      return { success: true, phase: 'ean', stats, resume: null };
    }

    console.log(
      `[KeepaDiscovery:EAN] Processing ${unmatchedSets.length} sets with EANs (offset=${offset})`
    );

    // 3. Process in batches of 100 EANs
    const batchSize = 100;
    let currentOffset = offset;

    for (let i = 0; i < unmatchedSets.length; i += batchSize) {
      // Timeout check
      if (Date.now() - startTime > TIMEOUT_SAFETY_MS) {
        console.log(`[KeepaDiscovery:EAN] Timeout safety reached at offset ${currentOffset}`);
        stats.duration_ms = Date.now() - startTime;
        return { success: true, phase: 'ean', stats, resume: { offset: currentOffset } };
      }

      const batch = unmatchedSets.slice(i, i + batchSize);
      const eanCodes = batch.map((s) => s.ean);

      try {
        const products = await this.keepa.searchByCode(eanCodes);
        stats.tokens_used += products.length; // 1 token per matched product

        // Build EAN → product map for matching
        const eanToProduct = new Map<string, KeepaProduct>();
        for (const product of products) {
          if (product.eanList) {
            for (const ean of product.eanList) {
              eanToProduct.set(ean, product);
            }
          }
        }

        // Match against our batch
        const upsertRows: Record<string, unknown>[] = [];

        for (const set of batch) {
          stats.processed++;
          const product = eanToProduct.get(set.ean);

          if (product) {
            stats.matched++;
            upsertRows.push({
              brickset_set_id: set.id,
              asin: product.asin,
              discovery_status: 'found',
              match_method: 'ean',
              match_confidence: 100,
              amazon_title: product.title ?? null,
              last_discovery_attempt_at: new Date().toISOString(),
              discovery_attempts: 1,
            });
          } else {
            stats.not_matched++;
            // Update attempt tracking for unmatched sets (only if they exist in seeded_asins)
            upsertRows.push({
              brickset_set_id: set.id,
              discovery_status: set.has_seeded_row ? set.current_status : 'not_found',
              last_discovery_attempt_at: new Date().toISOString(),
              discovery_attempts: (set.current_attempts ?? 0) + 1,
            });
          }
        }

        if (!dryRun && upsertRows.length > 0) {
          const upsertErrors = await this.upsertSeededAsins(upsertRows);
          stats.errors.push(...upsertErrors);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[KeepaDiscovery:EAN] Batch error at offset ${currentOffset}:`, msg);
        // Continue to next batch rather than failing entirely
      }

      currentOffset = offset + i + batchSize;
    }

    // If we had a limit and processed exactly that many, there are likely more
    const hasMore = limit > 0 && unmatchedSets.length >= limit;
    stats.duration_ms = Date.now() - startTime;
    return {
      success: true,
      phase: 'ean',
      stats,
      resume: hasMore ? { offset: currentOffset } : null,
    };
  }

  /**
   * Phase 2: Discover ASINs using Keepa Product Finder.
   *
   * Pages through all LEGO ASINs on Amazon UK, filters out known ASINs,
   * then matches remaining ones against unmatched brickset_sets by title.
   *
   * @param startPage - Resume cursor (page number)
   * @param maxPages - Max pages to process (0 = all within timeout)
   * @param dryRun - Preview without writing
   */
  async discoverByFinder(startPage = 0, maxPages = 0, dryRun = false): Promise<DiscoveryResult> {
    const startTime = Date.now();
    const stats: DiscoveryStats = {
      processed: 0,
      matched: 0,
      not_matched: 0,
      tokens_used: 0,
      duration_ms: 0,
      errors: [],
    };

    // 1. Get all ASINs already in seeded_asins for deduplication
    const knownAsins = await this.getKnownAsins();

    // 2. Load unmatched brickset_sets for title matching
    const unmatchedSets = await this.getUnmatchedSetsForTitleMatch();

    if (unmatchedSets.length === 0) {
      console.log('[KeepaDiscovery:Finder] No unmatched sets remaining');
      stats.duration_ms = Date.now() - startTime;
      return { success: true, phase: 'finder', stats, resume: null };
    }

    // Build set_number → set map for fast lookup
    const setNumberMap = new Map<string, { id: string; name: string; set_number: string }>();
    for (const set of unmatchedSets) {
      const cleanNum = set.set_number.replace(/-\d+$/, '');
      setNumberMap.set(cleanNum, set);
    }

    console.log(
      `[KeepaDiscovery:Finder] ${unmatchedSets.length} unmatched sets, ${knownAsins.size} known ASINs`
    );

    // 3. Page through Product Finder
    let page = startPage;
    let pagesProcessed = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Timeout check
      if (Date.now() - startTime > TIMEOUT_SAFETY_MS) {
        console.log(`[KeepaDiscovery:Finder] Timeout safety reached at page ${page}`);
        stats.duration_ms = Date.now() - startTime;
        return { success: true, phase: 'finder', stats, resume: { finderPage: page } };
      }

      // Max pages check
      if (maxPages > 0 && pagesProcessed >= maxPages) {
        stats.duration_ms = Date.now() - startTime;
        return { success: true, phase: 'finder', stats, resume: { finderPage: page } };
      }

      try {
        const finderResult = await this.keepa.productFinder(page);
        stats.tokens_used += 11; // 11 tokens per Finder page

        if (finderResult.asinList.length === 0) {
          console.log(`[KeepaDiscovery:Finder] No more ASINs at page ${page}, done`);
          break;
        }

        // Filter out already-known ASINs
        const newAsins = finderResult.asinList.filter((a) => !knownAsins.has(a));

        if (newAsins.length > 0) {
          // Batch lookup new ASINs to get title + EAN info
          const lookupBatches = this.chunkArray(newAsins, 100);

          for (const lookupBatch of lookupBatches) {
            if (Date.now() - startTime > TIMEOUT_SAFETY_MS) {
              stats.duration_ms = Date.now() - startTime;
              return { success: true, phase: 'finder', stats, resume: { finderPage: page } };
            }

            try {
              const products = await this.keepa.fetchProductsLight(lookupBatch);
              stats.tokens_used += lookupBatch.length; // 1 token per ASIN lookup

              for (const product of products) {
                stats.processed++;
                knownAsins.add(product.asin); // Track to avoid re-processing

                // Try EAN match first
                const eanMatch = this.matchByEan(product, unmatchedSets);
                if (eanMatch) {
                  stats.matched++;
                  if (!dryRun) {
                    const errs = await this.upsertSeededAsins([
                      {
                        brickset_set_id: eanMatch.id,
                        asin: product.asin,
                        discovery_status: 'found',
                        match_method: 'ean',
                        match_confidence: 100,
                        amazon_title: product.title ?? null,
                        last_discovery_attempt_at: new Date().toISOString(),
                        discovery_attempts: 1,
                      },
                    ]);
                    stats.errors.push(...errs);
                  }
                  continue;
                }

                // Try title match
                if (product.title) {
                  const titleMatch = this.matchByTitle(product.title, setNumberMap);
                  if (titleMatch) {
                    stats.matched++;
                    if (!dryRun) {
                      const errs = await this.upsertSeededAsins([
                        {
                          brickset_set_id: titleMatch.set.id,
                          asin: product.asin,
                          discovery_status: 'found',
                          match_method: titleMatch.confidence >= 85 ? 'title_exact' : 'title_fuzzy',
                          match_confidence: titleMatch.confidence,
                          amazon_title: product.title,
                          last_discovery_attempt_at: new Date().toISOString(),
                          discovery_attempts: 1,
                        },
                      ]);
                      stats.errors.push(...errs);
                    }
                    continue;
                  }
                }

                stats.not_matched++;
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`[KeepaDiscovery:Finder] Lookup batch error:`, msg);
            }
          }
        }

        pagesProcessed++;
        page++;

        // Log progress every 10 pages
        if (pagesProcessed % 10 === 0) {
          console.log(
            `[KeepaDiscovery:Finder] Page ${page}, processed=${stats.processed}, matched=${stats.matched}, tokens=${stats.tokens_used}`
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[KeepaDiscovery:Finder] Finder page ${page} error:`, msg);
        page++;
        pagesProcessed++;
      }
    }

    stats.duration_ms = Date.now() - startTime;
    return { success: true, phase: 'finder', stats, resume: null };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Get all brickset_set IDs that already have a 'found' seeded_asins row. */
  private async getFoundSetIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('seeded_asins')
        .select('brickset_set_id')
        .eq('discovery_status', 'found')
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        console.error('[KeepaDiscovery] Error fetching found set IDs:', error.message);
        break;
      }

      for (const row of data ?? []) {
        ids.add((row as unknown as Record<string, unknown>).brickset_set_id as string);
      }

      hasMore = (data?.length ?? 0) === pageSize;
      page++;
    }

    return ids;
  }

  /** Get brickset_sets with EAN that aren't in the found set. */
  private async getUnmatchedSetsWithEan(
    foundSetIds: Set<string>,
    offset: number,
    limit: number
  ): Promise<
    {
      id: string;
      ean: string;
      set_number: string;
      set_name: string;
      has_seeded_row: boolean;
      current_status: string;
      current_attempts: number;
    }[]
  > {
    const results: {
      id: string;
      ean: string;
      set_number: string;
      set_name: string;
      has_seeded_row: boolean;
      current_status: string;
      current_attempts: number;
    }[] = [];
    const pageSize = 1000;
    let dbPage = 0;
    let hasMore = true;
    let skipped = 0;

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('brickset_sets')
        .select('id, ean, set_number, set_name')
        .not('ean', 'is', null)
        .order('set_number', { ascending: true })
        .range(dbPage * pageSize, (dbPage + 1) * pageSize - 1);

      if (error) {
        console.error('[KeepaDiscovery] Error fetching sets with EAN:', error.message);
        break;
      }

      if (!data || data.length === 0) {
        hasMore = false;
        break;
      }

      for (const row of data) {
        const record = row as unknown as Record<string, unknown>;
        const id = record.id as string;
        const ean = record.ean as string;

        // Skip sets already found
        if (foundSetIds.has(id)) continue;

        // Skip empty EANs
        if (!ean || ean.trim() === '') continue;

        // Handle offset
        if (skipped < offset) {
          skipped++;
          continue;
        }

        results.push({
          id,
          ean: ean.trim(),
          set_number: record.set_number as string,
          set_name: record.set_name as string,
          has_seeded_row: false, // Will be enriched below
          current_status: 'pending',
          current_attempts: 0,
        });

        if (limit > 0 && results.length >= limit) {
          return results;
        }
      }

      hasMore = data.length === pageSize;
      dbPage++;
    }

    // Enrich with existing seeded_asins data
    if (results.length > 0) {
      const setIds = results.map((r) => r.id);
      const existingMap = await this.getExistingSeededAsins(setIds);

      for (const result of results) {
        const existing = existingMap.get(result.id);
        if (existing) {
          result.has_seeded_row = true;
          result.current_status = existing.status;
          result.current_attempts = existing.attempts;
        }
      }
    }

    return results;
  }

  /** Get existing seeded_asins rows for a list of brickset_set IDs. */
  private async getExistingSeededAsins(
    setIds: string[]
  ): Promise<Map<string, { status: string; attempts: number }>> {
    const map = new Map<string, { status: string; attempts: number }>();

    for (let i = 0; i < setIds.length; i += 1000) {
      const chunk = setIds.slice(i, i + 1000);
      const { data, error } = await this.supabase
        .from('seeded_asins')
        .select('brickset_set_id, discovery_status, discovery_attempts')
        .in('brickset_set_id', chunk);

      if (error) {
        console.error('[KeepaDiscovery] Error fetching existing seeded_asins:', error.message);
        continue;
      }

      for (const row of data ?? []) {
        const record = row as unknown as Record<string, unknown>;
        map.set(record.brickset_set_id as string, {
          status: record.discovery_status as string,
          attempts: (record.discovery_attempts as number) ?? 0,
        });
      }
    }

    return map;
  }

  /** Get all ASINs currently in seeded_asins (for deduplication). */
  private async getKnownAsins(): Promise<Set<string>> {
    const asins = new Set<string>();
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('seeded_asins')
        .select('asin')
        .not('asin', 'is', null)
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        console.error('[KeepaDiscovery] Error fetching known ASINs:', error.message);
        break;
      }

      for (const row of data ?? []) {
        const asin = (row as unknown as Record<string, unknown>).asin as string;
        if (asin) asins.add(asin);
      }

      hasMore = (data?.length ?? 0) === pageSize;
      page++;
    }

    return asins;
  }

  /** Get unmatched brickset_sets for title matching (no 'found' seeded_asins row). */
  private async getUnmatchedSetsForTitleMatch(): Promise<
    { id: string; set_number: string; name: string; ean?: string }[]
  > {
    const foundSetIds = await this.getFoundSetIds();
    const results: { id: string; set_number: string; name: string; ean?: string }[] = [];
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('brickset_sets')
        .select('id, set_number, set_name, ean')
        .gte('year_from', 2010)
        .order('set_number', { ascending: true })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        console.error('[KeepaDiscovery] Error fetching unmatched sets:', error.message);
        break;
      }

      if (!data || data.length === 0) {
        hasMore = false;
        break;
      }

      for (const row of data) {
        const record = row as unknown as Record<string, unknown>;
        const id = record.id as string;

        if (foundSetIds.has(id)) continue;

        results.push({
          id,
          set_number: record.set_number as string,
          name: record.set_name as string,
          ean: (record.ean as string) ?? undefined,
        });
      }

      hasMore = data.length === pageSize;
      page++;
    }

    return results;
  }

  /** Try to match a Keepa product to an unmatched set by EAN. */
  private matchByEan(
    product: KeepaProduct,
    unmatchedSets: { id: string; set_number: string; name: string; ean?: string }[]
  ): { id: string; set_number: string } | null {
    if (!product.eanList || product.eanList.length === 0) return null;

    const productEans = new Set(product.eanList);
    for (const set of unmatchedSets) {
      if (set.ean && productEans.has(set.ean)) {
        return { id: set.id, set_number: set.set_number };
      }
    }

    return null;
  }

  /** Try to match a product title to an unmatched set by set number + title similarity. */
  private matchByTitle(
    amazonTitle: string,
    setNumberMap: Map<string, { id: string; name: string; set_number: string }>
  ): { set: { id: string; name: string; set_number: string }; confidence: number } | null {
    // Extract set number from Amazon title
    const extractedNum = extractSetNumber(amazonTitle);
    if (!extractedNum) return null;

    const matchedSet = setNumberMap.get(extractedNum);
    if (!matchedSet) return null;

    // Calculate title match confidence
    const confidence = calculateTitleMatchConfidence(
      amazonTitle,
      matchedSet.name,
      matchedSet.set_number
    );

    // Only accept matches with confidence >= 65
    if (confidence < 65) return null;

    return { set: matchedSet, confidence };
  }

  /** Upsert rows into seeded_asins. Uses brickset_set_id as the conflict key. */
  private async upsertSeededAsins(rows: Record<string, unknown>[]): Promise<string[]> {
    const errors: string[] = [];
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await this.supabase
        .from('seeded_asins')
        .upsert(chunk, { onConflict: 'brickset_set_id' });

      if (error) {
        const msg = `Upsert error (chunk ${i}): ${error.message} [code: ${error.code}]`;
        console.error(`[KeepaDiscovery] ${msg}`);
        errors.push(msg);
      }
    }
    return errors;
  }

  /** Split an array into chunks. */
  private chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}
