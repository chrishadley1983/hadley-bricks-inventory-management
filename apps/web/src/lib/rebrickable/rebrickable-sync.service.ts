/**
 * Rebrickable Sync Service
 *
 * Syncs set data from Rebrickable API into the brickset_sets table.
 * Merges data without overwriting Brickset-specific fields (ratings, pricing, images).
 * Uses batch upserts for performance (fits within Vercel 300s timeout).
 *
 * Rate limit strategy:
 * - 1.1s delay between API page fetches (Rebrickable allows ~1 req/sec)
 * - 429 retry with exponential backoff (handled by RebrickableApiClient)
 * - Batch upserts of 500 rows to Supabase (avoids N+1 update problem)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { RebrickableApiClient } from './rebrickable-api';
import type {
  RebrickableSet,
  RebrickableTheme,
  RebrickableSyncResult,
} from './types';

export class RebrickableSyncService {
  private client: RebrickableApiClient;
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient, apiKey: string) {
    this.supabase = supabase;
    this.client = new RebrickableApiClient(apiKey);
  }

  /**
   * Full sync: fetch all sets from Rebrickable and upsert into brickset_sets.
   * Uses upsert on set_number to batch-merge rows efficiently.
   * Only writes Rebrickable-sourced fields; Brickset-specific columns are preserved
   * because upsert's onConflict only updates the columns we provide.
   */
  async syncAllSets(): Promise<RebrickableSyncResult> {
    const startTime = Date.now();
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    let totalProcessed = 0;

    // 1. Build theme lookup map (theme_id -> { name, parent_name })
    console.log('[RebrickableSync] Fetching themes...');
    const themeMap = await this.buildThemeMap();
    console.log(`[RebrickableSync] Loaded ${themeMap.size} themes`);

    // 2. Get existing set numbers for insert/update counting
    console.log('[RebrickableSync] Loading existing set numbers...');
    const existingSetNumbers = await this.getExistingSetNumbers();
    console.log(`[RebrickableSync] Found ${existingSetNumbers.size} existing sets`);

    // 3. Fetch all sets page by page and upsert in batches
    console.log('[RebrickableSync] Starting set sync...');
    let totalAvailable = 0;

    // First request to get total count
    const firstPage = await this.client.getSets({
      page: 1,
      page_size: 1000,
      min_year: 2000,
      ordering: '-year',
    });
    totalAvailable = firstPage.count;
    console.log(`[RebrickableSync] Total sets available: ${totalAvailable}`);

    // Process first page
    const firstResult = await this.upsertBatch(
      firstPage.results,
      themeMap,
      existingSetNumbers
    );
    inserted += firstResult.inserted;
    updated += firstResult.updated;
    skipped += firstResult.skipped;
    errors += firstResult.errors;
    totalProcessed += firstPage.results.length;

    // Process remaining pages using retry-aware fetch
    let nextUrl = firstPage.next;
    while (nextUrl) {
      // Rate limit: ~1 req/sec
      await new Promise((resolve) => setTimeout(resolve, 1100));

      try {
        const pageData = await this.client.fetchWithRetry<{
          next: string | null;
          results: RebrickableSet[];
        }>(nextUrl);

        const batchResult = await this.upsertBatch(
          pageData.results,
          themeMap,
          existingSetNumbers
        );
        inserted += batchResult.inserted;
        updated += batchResult.updated;
        skipped += batchResult.skipped;
        errors += batchResult.errors;
        totalProcessed += pageData.results.length;

        console.log(
          `[RebrickableSync] Processed ${totalProcessed}/${totalAvailable} sets (${inserted} new, ${updated} updated)`
        );

        nextUrl = pageData.next;
      } catch (fetchError) {
        console.error(
          `[RebrickableSync] Failed to fetch page after retries:`,
          fetchError instanceof Error ? fetchError.message : fetchError
        );
        break;
      }
    }

    const duration = Date.now() - startTime;
    console.log(
      `[RebrickableSync] Complete: ${totalProcessed} processed, ${inserted} inserted, ${updated} updated, ${errors} errors in ${duration}ms`
    );

    return {
      inserted,
      updated,
      skipped,
      errors,
      total_processed: totalProcessed,
      total_available: totalAvailable,
      duration_ms: duration,
      theme_map_size: themeMap.size,
    };
  }

  /** Build a map of theme_id -> { name, parentName } from Rebrickable themes */
  private async buildThemeMap(): Promise<
    Map<number, { name: string; parentName: string | null }>
  > {
    const themes = await this.client.getThemes();
    const themeById = new Map<number, RebrickableTheme>();
    for (const theme of themes) {
      themeById.set(theme.id, theme);
    }

    const result = new Map<
      number,
      { name: string; parentName: string | null }
    >();
    for (const theme of themes) {
      const parent = theme.parent_id
        ? themeById.get(theme.parent_id)
        : null;
      result.set(theme.id, {
        name: theme.name,
        parentName: parent ? parent.name : null,
      });
    }
    return result;
  }

  /** Get all existing set numbers from brickset_sets */
  private async getExistingSetNumbers(): Promise<Set<string>> {
    const setNumbers = new Set<string>();
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('brickset_sets')
        .select('set_number')
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        console.error(
          '[RebrickableSync] Error fetching existing sets:',
          error.message
        );
        break;
      }

      for (const row of data ?? []) {
        setNumbers.add(row.set_number);
      }

      hasMore = (data?.length ?? 0) === pageSize;
      page++;
    }

    return setNumbers;
  }

  /**
   * Upsert a batch of Rebrickable sets into brickset_sets.
   *
   * Uses Supabase upsert with onConflict: 'set_number' so that:
   * - New rows are inserted with all provided columns
   * - Existing rows only get the specified columns updated (Brickset fields preserved)
   *
   * This replaces the previous N+1 individual UPDATE approach with batch operations.
   */
  private async upsertBatch(
    sets: RebrickableSet[],
    themeMap: Map<number, { name: string; parentName: string | null }>,
    existingSetNumbers: Set<string>
  ): Promise<{
    inserted: number;
    updated: number;
    skipped: number;
    errors: number;
  }> {
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    const now = new Date().toISOString();
    // Split into new rows (with image_url) and existing rows (without image_url)
    // This prevents upsert from overwriting Brickset images on existing rows
    const newRows: Record<string, unknown>[] = [];
    const existingRows: Record<string, unknown>[] = [];

    for (const set of sets) {
      const theme = themeMap.get(set.theme_id);
      const themeName = theme?.name ?? null;
      const parentThemeName = theme?.parentName ?? null;

      // Determine subtheme: if there's a parent theme, the set's theme IS the subtheme
      const resolvedTheme = parentThemeName ?? themeName;
      const resolvedSubtheme = parentThemeName ? themeName : null;

      const baseRow: Record<string, unknown> = {
        set_number: set.set_num,
        set_name: set.name,
        year_from: set.year,
        theme: resolvedTheme,
        subtheme: resolvedSubtheme,
        pieces: set.num_parts,
        rebrickable_set_num: set.set_num,
        rebrickable_last_synced_at: now,
      };

      if (existingSetNumbers.has(set.set_num)) {
        existingRows.push(baseRow);
      } else {
        newRows.push({ ...baseRow, image_url: set.set_img_url });
      }
    }

    // Upsert new rows (includes image_url) in chunks of 500
    for (let i = 0; i < newRows.length; i += 500) {
      const chunk = newRows.slice(i, i + 500);
      const { error: insertError } = await this.supabase
        .from('brickset_sets')
        .upsert(chunk, {
          onConflict: 'set_number',
          ignoreDuplicates: false,
        });

      if (insertError) {
        console.error(
          `[RebrickableSync] Insert upsert error (batch ${i}):`,
          insertError.message
        );
        errors += chunk.length;
      } else {
        inserted += chunk.length;
        for (const row of chunk) {
          existingSetNumbers.add(row.set_number as string);
        }
      }
    }

    // Upsert existing rows (no image_url — preserves Brickset images) in chunks of 500
    for (let i = 0; i < existingRows.length; i += 500) {
      const chunk = existingRows.slice(i, i + 500);
      const { error: updateError } = await this.supabase
        .from('brickset_sets')
        .upsert(chunk, {
          onConflict: 'set_number',
          ignoreDuplicates: false,
        });

      if (updateError) {
        console.error(
          `[RebrickableSync] Update upsert error (batch ${i}):`,
          updateError.message
        );
        errors += chunk.length;
      } else {
        updated += chunk.length;
      }
    }

    skipped = sets.length - inserted - updated - errors;
    return { inserted, updated, skipped, errors };
  }
}
