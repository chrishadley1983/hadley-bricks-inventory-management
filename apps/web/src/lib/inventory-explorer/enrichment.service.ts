/**
 * Inventory Explorer — BrickLink Price Enrichment Service
 *
 * Warms the unified price cache (`bricklink_price_guide_cache`) for snapshot items
 * via `ensurePriceGuide` — 4 API calls per tuple capturing a COMPLETE row (both
 * conditions, sold+stock, median/hist). The backlog is computed against the same
 * cache via `readPriceGuide`, so tuples already covered by PG lanes, store scans
 * or assessments are never re-fetched.
 *
 * Rate-limited to stay within BrickLink's 5000 req/day limit.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { BrickLinkClient } from '../bricklink/client';
import type { BrickLinkCredentials } from '../bricklink/types';
import { CredentialsRepository } from '../repositories/credentials.repository';
import { ensurePriceGuide } from '../bricklink/price-guide/capture';
import { readPriceGuide, pgKey, type ItemRef, type PgType } from '../bricklink/price-guide/read';
import { loadColourMap } from '../bricklink/colour-map';

/** Map explorer item_type to price-guide item type */
function toPgType(itemType: string): PgType {
  switch (itemType) {
    case 'Set':
      return 'S';
    case 'Minifig':
      return 'M';
    default:
      return 'P';
  }
}

export interface EnrichmentProgress {
  processed: number;
  total: number;
  cached: number;
  fetched: number;
  errors: number;
  status: 'running' | 'completed' | 'failed';
}

export interface EnrichmentResult {
  totalProcessed: number;
  alreadyCached: number;
  newlyFetched: number;
  errors: number;
}

/** Delay between tuples (ms) — each tuple is 4 parallel BL API calls */
const REQUEST_DELAY = 500;

/** Delay between batches (ms) */
const BATCH_DELAY = 2000;

/** Batch size between progress events / batch delays */
const BATCH_SIZE = 10;

/**
 * Max tuples to enrich per manual invocation. Each tuple costs 4 BL API calls
 * (all quadrants) but covers BOTH conditions, so 100 tuples ≈ the old 200
 * single-condition items at the same ~400-call budget.
 */
const MAX_ITEMS_PER_RUN = 100;

/** Max tuples for daily cron refresh per invocation (fits within 5-min Vercel timeout) */
export const MAX_ITEMS_DAILY_REFRESH = 100;

/** UK cache rows older than this are re-fetched */
const FRESH_TTL_DAYS = 90;

export class EnrichmentService {
  constructor(
    private supabase: SupabaseClient<Database>,
    private userId: string,
    /** Caller tag recorded on BL API calls. Defaults to 'cron-inventory-enrich' for backwards compat. */
    private caller: string = 'cron-inventory-enrich'
  ) {}

  /**
   * Enrich snapshot items with BrickLink price data.
   * Prioritises tuples by value (most expensive first).
   * Skips tuples already fresh in the unified cache.
   */
  async enrich(options?: {
    maxItems?: number;
    onProgress?: (progress: EnrichmentProgress) => void;
  }): Promise<EnrichmentResult> {
    const maxItems = options?.maxItems ?? MAX_ITEMS_PER_RUN;
    const onProgress = options?.onProgress;

    // 1. Get BrickLink credentials
    const credRepo = new CredentialsRepository(this.supabase);
    const creds = await credRepo.getCredentials<BrickLinkCredentials>(this.userId, 'bricklink');
    if (!creds) {
      throw new Error('BrickLink credentials not configured');
    }

    const client = new BrickLinkClient(creds, {
      supabase: this.supabase,
      caller: this.caller,
    });

    // 2. Get tuples from snapshot that need enrichment (no fresh UK row)
    const candidates = await this.getUnenrichedItems(maxItems);

    if (candidates.length === 0) {
      return { totalProcessed: 0, alreadyCached: 0, newlyFetched: 0, errors: 0 };
    }

    let fetched = 0;
    let errors = 0;
    const total = candidates.length;

    // 3. Process in batches
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);

      for (const item of batch) {
        try {
          await ensurePriceGuide(
            client,
            this.supabase,
            { itemType: item.itemType, itemNo: item.itemNumber, colourId: item.blColourId },
            { ttlDays: FRESH_TTL_DAYS }
          );
          fetched++;
        } catch (err) {
          errors++;
          const msg = err instanceof Error ? err.message : String(err);
          // Stop on rate limit
          if (msg.includes('rate limit') || msg.includes('429')) {
            console.log('[Enrichment] Rate limited, stopping');
            onProgress?.({
              processed: i + batch.indexOf(item) + 1,
              total,
              cached: 0,
              fetched,
              errors,
              status: 'completed',
            });
            return { totalProcessed: fetched + errors, alreadyCached: 0, newlyFetched: fetched, errors };
          }
          console.error(`[Enrichment] Error for ${item.itemNumber}: ${msg}`);
        }

        // Rate limit delay
        await sleep(REQUEST_DELAY);
      }

      onProgress?.({
        processed: Math.min(i + BATCH_SIZE, total),
        total,
        cached: 0,
        fetched,
        errors,
        status: 'running',
      });

      // Batch delay
      if (i + BATCH_SIZE < candidates.length) {
        await sleep(BATCH_DELAY);
      }
    }

    onProgress?.({
      processed: total,
      total,
      cached: 0,
      fetched,
      errors,
      status: 'completed',
    });

    return { totalProcessed: total, alreadyCached: 0, newlyFetched: fetched, errors };
  }

  /**
   * Get snapshot tuples with no fresh UK row in the unified cache.
   * Returns consolidated unique (item_number, BL_colour_id, item_type) tuples —
   * a single capture covers both conditions, so condition is NOT part of the key.
   *
   * Snapshot colour ids are Bricqer-scheme; they are normalised to BL ids via the
   * canonical colour map (by name first, id fallback). Unmappable rows are dropped
   * so we never key the unified cache by a Bricqer id.
   */
  private async getUnenrichedItems(
    limit: number
  ): Promise<Array<{ itemNumber: string; blColourId: number; itemType: PgType; totalValue: number }>> {
    const cmap = await loadColourMap(this.supabase);

    // Get all snapshot rows (paginated past the 1000-row cap)
    const allItems: Array<{
      item_number: string;
      color_id: number | null;
      color_name: string | null;
      item_type: string;
      bricqer_price: number;
      quantity: number;
    }> = [];

    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const { data } = await this.supabase
        .from('bricqer_inventory_snapshot')
        .select('item_number, color_id, color_name, item_type, bricqer_price, quantity')
        .eq('user_id', this.userId)
        .not('color_id', 'is', null)
        .range(offset, offset + pageSize - 1);

      if (!data || data.length === 0) break;
      allItems.push(...data);
      if (data.length < pageSize) break;
      offset += pageSize;
    }

    // Consolidate by (item_number, BL_colour_id, item_type) and sum value
    const map = new Map<string, { itemNumber: string; blColourId: number; itemType: PgType; totalValue: number }>();
    let unmappable = 0;

    for (const item of allItems) {
      const itemType = toPgType(item.item_type);
      let blColourId = 0;
      if (itemType === 'P') {
        const resolved = cmap.normalise({
          colourId: item.color_id ?? undefined,
          colourName: item.color_name,
          scheme: 'bricqer',
        });
        if (!resolved.mapped) {
          unmappable++;
          continue;
        }
        blColourId = resolved.blId;
      }
      const key = pgKey(itemType, item.item_number, blColourId);
      const existing = map.get(key);
      if (existing) {
        existing.totalValue += item.bricqer_price * item.quantity;
      } else {
        map.set(key, {
          itemNumber: item.item_number,
          blColourId,
          itemType,
          totalValue: item.bricqer_price * item.quantity,
        });
      }
    }
    if (unmappable > 0) {
      console.warn(`[Enrichment] dropped ${unmappable} snapshot rows whose colour didn't map to a BL colour`);
    }

    // Filter to tuples without a fresh UK row in the unified cache
    const candidates = Array.from(map.values());
    const refs: ItemRef[] = candidates.map((c) => ({
      itemType: c.itemType,
      itemNo: c.itemNumber,
      colourId: c.blColourId,
      scheme: 'bl' as const,
    }));
    const views = await readPriceGuide(this.supabase, refs, {
      ttlDays: FRESH_TTL_DAYS,
      allowWorldFallback: false,
    });

    const unenriched = candidates.filter((c) => {
      const view = views.get(pgKey(c.itemType, c.itemNumber, c.blColourId));
      return !view || view.coverage !== 'uk';
    });

    // Sort by value descending and take top N
    unenriched.sort((a, b) => b.totalValue - a.totalValue);
    return unenriched.slice(0, limit);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
