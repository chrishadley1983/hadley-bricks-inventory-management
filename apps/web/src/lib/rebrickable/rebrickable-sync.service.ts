/**
 * Rebrickable Sync Service
 *
 * Syncs set data from Rebrickable API into the brickset_sets table.
 * Merges data without overwriting Brickset-specific fields (ratings, pricing, images).
 * Handles pagination and batch upserts within Supabase's 1,000-row limit.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { RebrickableApiClient } from './rebrickable-api';
import type {
  RebrickableSet,
  RebrickableTheme,
  RebrickableSyncResult,
} from './types';

/** Fields that Rebrickable populates - we only update these on existing rows */
const REBRICKABLE_FIELDS = [
  'set_name',
  'year_from',
  'theme',
  'subtheme',
  'pieces',
  'minifigs',
  'rebrickable_set_num',
  'rebrickable_last_synced_at',
] as const;

export class RebrickableSyncService {
  private client: RebrickableApiClient;
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient, apiKey: string) {
    this.supabase = supabase;
    this.client = new RebrickableApiClient(apiKey);
  }

  /**
   * Full sync: fetch all sets from Rebrickable and upsert into brickset_sets.
   * Only updates Rebrickable-sourced fields, preserving Brickset-specific data.
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
    console.log(
      `[RebrickableSync] Loaded ${themeMap.size} themes`
    );

    // 2. Get existing set numbers for merge detection
    console.log('[RebrickableSync] Loading existing set numbers...');
    const existingSetNumbers = await this.getExistingSetNumbers();
    console.log(
      `[RebrickableSync] Found ${existingSetNumbers.size} existing sets`
    );

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
    console.log(
      `[RebrickableSync] Total sets available: ${totalAvailable}`
    );

    // Process first page
    const firstResult = await this.processBatch(
      firstPage.results,
      themeMap,
      existingSetNumbers
    );
    inserted += firstResult.inserted;
    updated += firstResult.updated;
    skipped += firstResult.skipped;
    errors += firstResult.errors;
    totalProcessed += firstPage.results.length;

    // Process remaining pages
    let nextUrl = firstPage.next;
    while (nextUrl) {
      // Rate limit: ~1 req/sec
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const response = await fetch(nextUrl, {
        headers: {
          Authorization: `key ${this.client['apiKey']}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        console.error(
          `[RebrickableSync] Failed to fetch page: ${response.status}`
        );
        break;
      }

      const pageData = (await response.json()) as {
        next: string | null;
        results: RebrickableSet[];
      };

      const batchResult = await this.processBatch(
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

  /** Process a batch of Rebrickable sets, upserting into brickset_sets */
  private async processBatch(
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

    // Normalize set numbers: Rebrickable uses "75192-1", brickset_sets uses "75192-1"
    const toInsert: Record<string, unknown>[] = [];
    const toUpdate: { setNumber: string; data: Record<string, unknown> }[] = [];

    for (const set of sets) {
      const theme = themeMap.get(set.theme_id);
      const themeName = theme?.name ?? null;
      const parentThemeName = theme?.parentName ?? null;

      // Determine subtheme: if there's a parent theme, the set's theme IS the subtheme
      const resolvedTheme = parentThemeName ?? themeName;
      const resolvedSubtheme = parentThemeName ? themeName : null;

      const now = new Date().toISOString();

      if (existingSetNumbers.has(set.set_num)) {
        // Update: only Rebrickable-specific fields
        toUpdate.push({
          setNumber: set.set_num,
          data: {
            set_name: set.name,
            year_from: set.year,
            theme: resolvedTheme,
            subtheme: resolvedSubtheme,
            pieces: set.num_parts,
            rebrickable_set_num: set.set_num,
            rebrickable_last_synced_at: now,
          },
        });
      } else {
        // Insert: new set with Rebrickable data
        toInsert.push({
          set_number: set.set_num,
          set_name: set.name,
          year_from: set.year,
          theme: resolvedTheme,
          subtheme: resolvedSubtheme,
          pieces: set.num_parts,
          image_url: set.set_img_url,
          rebrickable_set_num: set.set_num,
          rebrickable_last_synced_at: now,
        });
      }
    }

    // Batch insert new sets (in chunks of 500 to stay within limits)
    for (let i = 0; i < toInsert.length; i += 500) {
      const chunk = toInsert.slice(i, i + 500);
      const { error } = await this.supabase
        .from('brickset_sets')
        .insert(chunk);

      if (error) {
        console.error(
          `[RebrickableSync] Insert error (batch ${i}):`,
          error.message
        );
        errors += chunk.length;
      } else {
        inserted += chunk.length;
        // Track newly inserted sets so we don't try to update them
        for (const row of chunk) {
          existingSetNumbers.add(row.set_number as string);
        }
      }
    }

    // Batch update existing sets (individual updates to avoid overwriting)
    for (let i = 0; i < toUpdate.length; i += 500) {
      const chunk = toUpdate.slice(i, i + 500);

      for (const item of chunk) {
        const { error } = await this.supabase
          .from('brickset_sets')
          .update(item.data)
          .eq('set_number', item.setNumber);

        if (error) {
          console.error(
            `[RebrickableSync] Update error for ${item.setNumber}:`,
            error.message
          );
          errors++;
        } else {
          updated++;
        }
      }
    }

    skipped = sets.length - inserted - updated - errors;
    return { inserted, updated, skipped, errors };
  }
}
