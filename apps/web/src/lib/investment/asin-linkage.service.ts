/**
 * ASIN Linkage Service
 *
 * Populates brickset_sets.amazon_asin and has_amazon_listing
 * from the existing seeded_asins table.
 *
 * Only links ASINs with discovery_status = 'found' and match_confidence >= 60.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface AsinLinkageResult {
  total_linked: number;
  already_linked: number;
  newly_linked: number;
  skipped_low_confidence: number;
  errors: number;
  duration_ms: number;
}

export class AsinLinkageService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Link ASINs from seeded_asins to brickset_sets.
   * Only considers matches with confidence >= 60%.
   */
  async linkAll(): Promise<AsinLinkageResult> {
    const startTime = Date.now();
    let totalLinked = 0;
    const alreadyLinked = 0;
    let newlyLinked = 0;
    let skippedLowConfidence = 0;
    let errors = 0;

    const pageSize = 1000;
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      // Fetch seeded_asins joined with brickset_sets to get the set's current amazon_asin
      const { data, error } = await this.supabase
        .from('seeded_asins')
        .select(
          `
          id,
          asin,
          match_confidence,
          discovery_status,
          brickset_set_id
        `
        )
        .eq('discovery_status', 'found')
        .not('asin', 'is', null)
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        console.error('[AsinLinkage] Error fetching seeded_asins:', error.message);
        break;
      }

      if (!data || data.length === 0) {
        hasMore = false;
        break;
      }

      const updates: { id: string; amazon_asin: string; has_amazon_listing: boolean }[] = [];

      for (const row of data) {
        if ((row.match_confidence ?? 0) < 60) {
          skippedLowConfidence++;
          continue;
        }

        updates.push({
          id: row.brickset_set_id,
          amazon_asin: row.asin,
          has_amazon_listing: true,
        });
      }

      // Batch upsert to brickset_sets
      if (updates.length > 0) {
        for (let i = 0; i < updates.length; i += 500) {
          const chunk = updates.slice(i, i + 500);
          const { error: upsertError } = await this.supabase.from('brickset_sets').upsert(
            chunk.map((u) => ({
              id: u.id,
              amazon_asin: u.amazon_asin,
              has_amazon_listing: u.has_amazon_listing,
            })),
            { onConflict: 'id' }
          );

          if (upsertError) {
            console.error('[AsinLinkage] Upsert error:', upsertError.message);
            errors += chunk.length;
          } else {
            newlyLinked += chunk.length;
          }
        }
      }

      totalLinked += updates.length;
      hasMore = data.length === pageSize;
      page++;
    }

    const duration = Date.now() - startTime;
    console.log(
      `[AsinLinkage] Complete: ${totalLinked} total, ${newlyLinked} newly linked, ${skippedLowConfidence} skipped (low confidence) in ${duration}ms`
    );

    return {
      total_linked: totalLinked,
      already_linked: alreadyLinked,
      newly_linked: newlyLinked,
      skipped_low_confidence: skippedLowConfidence,
      errors,
      duration_ms: duration,
    };
  }
}
