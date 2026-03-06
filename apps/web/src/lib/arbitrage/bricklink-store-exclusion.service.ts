/**
 * BrickLink Store Exclusion Service
 *
 * Manages the user's list of excluded BrickLink stores.
 * Excluded stores are filtered out of deal finder results.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';

export interface ExcludedBrickLinkStore {
  id: string;
  storeName: string;
  reason: string | null;
  excludedAt: string;
}

const PAGE_SIZE = 1000;

export class BrickLinkStoreExclusionService {
  constructor(private supabase: SupabaseClient<Database>) {}

  /**
   * Get all excluded stores for a user.
   */
  async getExcludedStores(userId: string): Promise<ExcludedBrickLinkStore[]> {
    const stores: ExcludedBrickLinkStore[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('excluded_bricklink_stores')
        .select('id, store_name, reason, excluded_at')
        .eq('user_id', userId)
        .order('excluded_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (error) {
        console.error('[BrickLinkStoreExclusionService.getExcludedStores] Error:', error);
        throw new Error(`Failed to fetch excluded stores: ${error.message}`);
      }

      for (const row of data ?? []) {
        stores.push({
          id: row.id,
          storeName: row.store_name,
          reason: row.reason,
          excludedAt: row.excluded_at,
        });
      }

      hasMore = (data?.length ?? 0) === PAGE_SIZE;
      page++;
    }

    return stores;
  }

  /**
   * Get a Set of excluded store names for fast lookup during filtering.
   */
  async getExcludedStoreNames(userId: string): Promise<Set<string>> {
    const stores = await this.getExcludedStores(userId);
    return new Set(stores.map((s) => s.storeName));
  }

  /**
   * Exclude a store from deal finder results.
   */
  async excludeStore(userId: string, storeName: string, reason?: string): Promise<void> {
    const { error } = await this.supabase.from('excluded_bricklink_stores').upsert(
      {
        user_id: userId,
        store_name: storeName,
        reason: reason ?? null,
      },
      { onConflict: 'user_id,store_name' }
    );

    if (error) {
      console.error('[BrickLinkStoreExclusionService.excludeStore] Error:', error);
      throw new Error(`Failed to exclude store: ${error.message}`);
    }
  }

  /**
   * Restore (un-exclude) a store.
   */
  async restoreStore(userId: string, storeName: string): Promise<void> {
    const { error } = await this.supabase
      .from('excluded_bricklink_stores')
      .delete()
      .eq('user_id', userId)
      .eq('store_name', storeName);

    if (error) {
      console.error('[BrickLinkStoreExclusionService.restoreStore] Error:', error);
      throw new Error(`Failed to restore store: ${error.message}`);
    }
  }
}
