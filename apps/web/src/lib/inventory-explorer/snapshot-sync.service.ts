/**
 * Inventory Explorer — Snapshot Sync Service
 *
 * Pulls all items from Bricqer API and upserts into bricqer_inventory_snapshot.
 * Supports resumable page-by-page processing for Vercel timeouts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { BricqerClient } from '../bricqer/client';
import type { BricqerCredentials, BricqerInventoryItem } from '../bricqer/types';
import { CredentialsRepository } from '../repositories/credentials.repository';

/** Map Bricqer legoType to explorer item_type (Other → Part per spec) */
function mapItemType(legoType: string): 'Part' | 'Set' | 'Minifig' {
  const map: Record<string, 'Part' | 'Set' | 'Minifig'> = {
    P: 'Part',
    S: 'Set',
    M: 'Minifig',
  };
  return map[legoType?.toUpperCase()] || 'Part'; // Gear, Book, Instruction, etc. → Part
}

/** Parse a numeric value from string or number */
function parseNumeric(value: string | number | undefined | null): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

/** Convert a raw Bricqer item to a snapshot row */
function toSnapshotRow(item: BricqerInventoryItem, userId: string) {
  const def = item.definition;
  if (!def) return null;

  const condition = item.condition || def.condition || 'N';
  const quantity = item.quantity ?? item.remainingQuantity ?? 1;
  const price = item.price ? parseNumeric(item.price) : (def.price ?? 0);

  return {
    user_id: userId,
    bricqer_item_id: item.id,
    item_number: def.legoId || String(item.definitionId),
    item_name: def.description || 'Unknown Item',
    item_type: mapItemType(def.legoType),
    color_id: item.colorId || def.color?.id || null,
    color_name: item.colorName || def.color?.name || null,
    color_rgb: def.color?.rgb || null,
    condition: condition === 'N' ? 'New' : 'Used',
    quantity,
    bricqer_price: price,
    image_url: def.picture || def.legoPicture || null,
    storage_location: item.storageLabel || null,
    batch_id: item.batchId || null,
    synced_at: new Date().toISOString(),
  };
}

export interface SyncProgress {
  page: number;
  totalPages: number;
  itemsFetched: number;
  totalItems: number;
  status: 'running' | 'completed' | 'failed';
}

export interface SyncResult {
  itemsSynced: number;
  itemsRemoved: number;
  totalItems: number;
  totalLots: number;
  complete: boolean;
  error?: string;
}

/** Max pages per invocation to stay within Vercel timeout */
const MAX_PAGES_PER_INVOCATION = 300;

/** Batch size for upsert operations */
const UPSERT_BATCH_SIZE = 500;

export class SnapshotSyncService {
  constructor(
    private supabase: SupabaseClient<Database>,
    private userId: string
  ) {}

  /**
   * Run a full or resumable sync of Bricqer inventory into the snapshot table.
   */
  async sync(options?: {
    onProgress?: (progress: SyncProgress) => void;
  }): Promise<SyncResult> {
    const onProgress = options?.onProgress;

    // 1. Get Bricqer credentials
    const credRepo = new CredentialsRepository(this.supabase);
    const creds = await credRepo.getCredentials<BricqerCredentials>(this.userId, 'bricqer');
    if (!creds) {
      throw new Error('Bricqer credentials not configured');
    }

    const client = new BricqerClient(creds);

    // 2. Check for in-progress sync (resume support)
    const { data: meta } = await this.supabase
      .from('bricqer_snapshot_meta')
      .select('*')
      .eq('user_id', this.userId)
      .single();

    let startPage = 1;
    if (meta?.sync_status === 'running' && meta.sync_cursor > 0) {
      startPage = meta.sync_cursor + 1;
    }

    // 3. Mark sync as running
    await this.supabase.from('bricqer_snapshot_meta').upsert({
      user_id: this.userId,
      sync_status: 'running',
      sync_cursor: startPage - 1,
      sync_error: null,
      updated_at: new Date().toISOString(),
    });

    const allBricqerIds: number[] = [];
    let itemsFetched = 0;
    let totalCount = 0;
    let page = startPage;
    let pagesProcessed = 0;

    try {
      // 4. Paginate through Bricqer API
      let hasMore = true;

      while (hasMore && pagesProcessed < MAX_PAGES_PER_INVOCATION) {
        const result = await client.fetchInventoryPage(page);
        totalCount = result.totalCount;
        const totalPages = Math.ceil(totalCount / 100);

        // Convert and batch upsert
        const rows = result.items
          .map((item) => toSnapshotRow(item, this.userId))
          .filter((r): r is NonNullable<typeof r> => r !== null);

        // Track all bricqer IDs for cleanup
        for (const item of result.items) {
          allBricqerIds.push(item.id);
        }

        // Upsert in batches
        for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
          const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
          const { error } = await this.supabase
            .from('bricqer_inventory_snapshot')
            .upsert(batch, { onConflict: 'user_id,bricqer_item_id' });

          if (error) {
            console.error(`[SnapshotSync] Upsert error on page ${page}:`, error.message);
          }
        }

        itemsFetched += result.items.length;
        pagesProcessed++;

        // Update cursor
        await this.supabase.from('bricqer_snapshot_meta').upsert({
          user_id: this.userId,
          sync_status: 'running',
          sync_cursor: page,
          total_items: totalCount,
          updated_at: new Date().toISOString(),
        });

        onProgress?.({
          page,
          totalPages,
          itemsFetched,
          totalItems: totalCount,
          status: 'running',
        });

        hasMore = result.hasMore;
        page++;
      }

      const complete = !hasMore;

      if (complete) {
        // 5. Delete stale items not in current Bricqer inventory
        // Only if we processed from page 1 (full sync, not a resume mid-way)
        let itemsRemoved = 0;
        if (startPage === 1 && allBricqerIds.length > 0) {
          itemsRemoved = await this.removeStaleItems(allBricqerIds);
        }

        // 6. Calculate total lots (distinct item_number + color + condition)
        const { count: lotCount } = await this.supabase
          .from('bricqer_inventory_snapshot')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', this.userId);

        // 7. Mark sync as complete
        await this.supabase.from('bricqer_snapshot_meta').upsert({
          user_id: this.userId,
          sync_status: 'idle',
          sync_cursor: 0,
          sync_error: null,
          total_items: totalCount,
          total_lots: lotCount || 0,
          last_full_sync: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        onProgress?.({
          page: page - 1,
          totalPages: Math.ceil(totalCount / 100),
          itemsFetched,
          totalItems: totalCount,
          status: 'completed',
        });

        return {
          itemsSynced: itemsFetched,
          itemsRemoved,
          totalItems: totalCount,
          totalLots: lotCount || 0,
          complete: true,
        };
      }

      // Partial sync — needs another invocation
      return {
        itemsSynced: itemsFetched,
        itemsRemoved: 0,
        totalItems: totalCount,
        totalLots: 0,
        complete: false,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[SnapshotSync] Sync failed:', errorMsg);

      await this.supabase.from('bricqer_snapshot_meta').upsert({
        user_id: this.userId,
        sync_status: 'failed',
        sync_error: errorMsg,
        updated_at: new Date().toISOString(),
      });

      return {
        itemsSynced: itemsFetched,
        itemsRemoved: 0,
        totalItems: totalCount,
        totalLots: 0,
        complete: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Remove snapshot items that are no longer in Bricqer.
   * Deletes in batches to avoid hitting Supabase limits.
   */
  private async removeStaleItems(currentBricqerIds: number[]): Promise<number> {
    // Get all existing bricqer_item_ids in snapshot
    const allExisting: number[] = [];
    let offset = 0;
    const pageSize = 1000;

    while (true) {
      const { data } = await this.supabase
        .from('bricqer_inventory_snapshot')
        .select('bricqer_item_id')
        .eq('user_id', this.userId)
        .range(offset, offset + pageSize - 1);

      if (!data || data.length === 0) break;
      allExisting.push(...data.map((r) => r.bricqer_item_id));
      if (data.length < pageSize) break;
      offset += pageSize;
    }

    // Find IDs to remove
    const currentSet = new Set(currentBricqerIds);
    const staleIds = allExisting.filter((id) => !currentSet.has(id));

    if (staleIds.length === 0) return 0;

    // Delete in batches
    const batchSize = 100;
    for (let i = 0; i < staleIds.length; i += batchSize) {
      const batch = staleIds.slice(i, i + batchSize);
      await this.supabase
        .from('bricqer_inventory_snapshot')
        .delete()
        .eq('user_id', this.userId)
        .in('bricqer_item_id', batch);
    }

    return staleIds.length;
  }
}
