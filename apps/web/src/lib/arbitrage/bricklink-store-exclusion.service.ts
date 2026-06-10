/**
 * BrickLink Store Exclusion Service
 *
 * Manages the user's list of excluded BrickLink stores.
 * Excluded stores are filtered out of deal finder results.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { fetchAllRecords } from '@/lib/supabase/pagination';

export interface ExcludedBrickLinkStore {
  id: string;
  storeName: string;
  reason: string | null;
  excludedAt: string;
}

export class BrickLinkStoreExclusionService {
  constructor(private supabase: SupabaseClient<Database>) {}

  /**
   * Get all excluded stores for a user.
   */
  async getExcludedStores(userId: string): Promise<ExcludedBrickLinkStore[]> {
    const data = await fetchAllRecords(this.supabase, 'excluded_bricklink_stores', {
      select: 'id, store_name, reason, excluded_at',
      eq: { user_id: userId },
      orderBy: { column: 'excluded_at', ascending: false },
    });

    return data.map((row) => ({
      id: row.id,
      storeName: row.store_name,
      reason: row.reason,
      excludedAt: row.excluded_at,
    }));
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
