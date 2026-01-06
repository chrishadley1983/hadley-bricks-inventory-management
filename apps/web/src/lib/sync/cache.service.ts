/**
 * Read-Through Cache Service
 *
 * Implements caching layer for Google Sheets data with TTL-based invalidation.
 * Supabase serves as the cache while Google Sheets remains the source of truth.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { GoogleSheetsClient } from '@/lib/google/sheets-client';
import {
  transformRow,
  addConditionFromSheet,
  newKitInventoryMapping,
  usedKitInventoryMapping,
  purchasesMapping,
} from '@/lib/migration/sheet-mappings';

// Use generic type for Supabase client since cache_metadata table isn't in generated types yet
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GenericSupabaseClient = SupabaseClient<any>;

/** Cache entry metadata stored in Supabase */
interface CacheMetadata {
  id: string;
  table_name: string;
  last_sync: string;
  sync_status: 'success' | 'error' | 'pending';
  error_message?: string;
  record_count: number;
}

/** Sync status for UI display */
export interface SyncStatus {
  lastSync: Date | null;
  status: 'synced' | 'syncing' | 'stale' | 'error';
  errorMessage?: string;
  recordCount: number;
}

/** Cache configuration */
export interface CacheConfig {
  /** TTL in milliseconds (default: 5 minutes) */
  ttlMs: number;
  /** Whether to sync on cache miss (default: true) */
  syncOnMiss: boolean;
  /** Max records per sync batch (default: 1000) */
  batchSize: number;
}

const DEFAULT_CONFIG: CacheConfig = {
  ttlMs: 5 * 60 * 1000, // 5 minutes
  syncOnMiss: false, // Disabled - Supabase is now source of truth
  batchSize: 1000,
};

// In-memory sync locks to prevent concurrent syncs (per user per table)
const syncLocks = new Map<string, boolean>();

/**
 * Read-through cache service for Sheets-primary architecture
 */
export class CacheService {
  private config: CacheConfig;

  constructor(
    private supabase: GenericSupabaseClient,
    private sheetsClient: GoogleSheetsClient,
    private userId: string,
    config: Partial<CacheConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if cache is stale for a given table
   */
  async isCacheStale(tableName: string): Promise<boolean> {
    const metadata = await this.getCacheMetadata(tableName);
    if (!metadata) return true;

    const lastSync = new Date(metadata.last_sync);
    const now = new Date();
    return now.getTime() - lastSync.getTime() > this.config.ttlMs;
  }

  /**
   * Get sync status for a table
   */
  async getSyncStatus(tableName: string): Promise<SyncStatus> {
    const metadata = await this.getCacheMetadata(tableName);

    if (!metadata) {
      return {
        lastSync: null,
        status: 'stale',
        recordCount: 0,
      };
    }

    const lastSync = new Date(metadata.last_sync);
    const isStale = new Date().getTime() - lastSync.getTime() > this.config.ttlMs;

    return {
      lastSync,
      status: metadata.sync_status === 'error' ? 'error' : isStale ? 'stale' : 'synced',
      errorMessage: metadata.error_message,
      recordCount: metadata.record_count,
    };
  }

  /**
   * Sync inventory data from Google Sheets to Supabase cache
   */
  async syncInventory(): Promise<{ success: boolean; count: number; error?: string }> {
    const lockKey = `${this.userId}:inventory_items`;

    // Check if sync is already in progress
    if (syncLocks.get(lockKey)) {
      console.log('[CacheService.syncInventory] Sync already in progress, skipping...');
      return { success: false, count: 0, error: 'Sync already in progress' };
    }

    // Acquire lock
    syncLocks.set(lockKey, true);
    console.log('[CacheService.syncInventory] Starting...');

    try {
      await this.setCacheStatus('inventory_items', 'pending');
    } catch (metaError) {
      console.error('[CacheService.syncInventory] Failed to set cache status:', metaError);
      // Continue anyway - cache_metadata table might not exist yet
    }

    try {
      // Fetch from both sheets
      console.log('[CacheService.syncInventory] Fetching from Google Sheets...');
      const [newKitData, usedKitData] = await Promise.all([
        this.sheetsClient.readSheet(newKitInventoryMapping.sheetName),
        this.sheetsClient.readSheet(usedKitInventoryMapping.sheetName),
      ]);
      console.log(`[CacheService.syncInventory] Fetched ${newKitData.length} new kit rows, ${usedKitData.length} used kit rows`);

      // Transform and merge
      const allItems: Record<string, unknown>[] = [];

      for (const row of newKitData) {
        const sku = row['ID'];
        if (!sku || sku.trim() === '') continue;

        try {
          let transformed = transformRow(row, newKitInventoryMapping);
          transformed = addConditionFromSheet(transformed, newKitInventoryMapping.sheetName);
          transformed.user_id = this.userId;
          transformed.sheets_synced_at = new Date().toISOString();
          allItems.push(transformed);
        } catch {
          // Skip rows with transform errors
        }
      }

      for (const row of usedKitData) {
        const sku = row['ID'];
        if (!sku || sku.trim() === '') continue;

        try {
          let transformed = transformRow(row, usedKitInventoryMapping);
          transformed = addConditionFromSheet(transformed, usedKitInventoryMapping.sheetName);
          transformed.user_id = this.userId;
          transformed.sheets_synced_at = new Date().toISOString();
          allItems.push(transformed);
        } catch {
          // Skip rows with transform errors
        }
      }

      // Sync strategy: Delete all user's inventory and re-insert from Sheets
      // (Sheets is source of truth, this is a full cache refresh)
      console.log(`[CacheService.syncInventory] Transformed ${allItems.length} items`);

      if (allItems.length > 0) {
        // Count existing records first
        const { count: existingCount } = await this.supabase
          .from('inventory_items')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', this.userId);

        console.log(`[CacheService.syncInventory] Found ${existingCount ?? 0} existing records to delete`);

        // Delete existing inventory for this user
        console.log('[CacheService.syncInventory] Deleting existing inventory...');
        const { error: deleteError } = await this.supabase
          .from('inventory_items')
          .delete()
          .eq('user_id', this.userId);

        if (deleteError) {
          console.error('[CacheService.syncInventory] Delete error:', deleteError);
          throw deleteError;
        }

        // Verify deletion completed
        const { count: remainingCount } = await this.supabase
          .from('inventory_items')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', this.userId);

        console.log(`[CacheService.syncInventory] After delete: ${remainingCount ?? 0} records remain`);

        if (remainingCount && remainingCount > 0) {
          console.error(`[CacheService.syncInventory] Delete incomplete: ${remainingCount} records remain`);
          throw new Error(`Delete incomplete: ${remainingCount} records still exist`);
        }

        // Process in batches
        console.log('[CacheService.syncInventory] Inserting in batches...');
        for (let i = 0; i < allItems.length; i += this.config.batchSize) {
          const batch = allItems.slice(i, i + this.config.batchSize);
          const { error } = await this.supabase.from('inventory_items').insert(batch);

          if (error) {
            console.error(`[CacheService.syncInventory] Insert error at batch ${i}:`, error);
            throw error;
          }
        }
        console.log('[CacheService.syncInventory] Insert complete');
      }

      try {
        await this.updateCacheMetadata('inventory_items', 'success', allItems.length);
      } catch (metaError) {
        console.error('[CacheService.syncInventory] Failed to update cache metadata:', metaError);
        // Don't fail the sync just because metadata update failed
      }
      return { success: true, count: allItems.length };
    } catch (error) {
      console.error('[CacheService.syncInventory] Error:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      try {
        await this.updateCacheMetadata('inventory_items', 'error', 0, message);
      } catch {
        // Ignore metadata update errors
      }
      return { success: false, count: 0, error: message };
    } finally {
      // Release lock
      syncLocks.delete(`${this.userId}:inventory_items`);
    }
  }

  /**
   * Sync purchases data from Google Sheets to Supabase cache
   */
  async syncPurchases(): Promise<{ success: boolean; count: number; error?: string }> {
    const lockKey = `${this.userId}:purchases`;

    // Check if sync is already in progress
    if (syncLocks.get(lockKey)) {
      console.log('[CacheService.syncPurchases] Sync already in progress, skipping...');
      return { success: false, count: 0, error: 'Sync already in progress' };
    }

    // Acquire lock
    syncLocks.set(lockKey, true);
    console.log('[CacheService.syncPurchases] Starting...');

    try {
      await this.setCacheStatus('purchases', 'pending');
    } catch (metaError) {
      console.error('[CacheService.syncPurchases] Failed to set cache status:', metaError);
      // Continue anyway - cache_metadata table might not exist yet
    }

    try {
      console.log('[CacheService.syncPurchases] Fetching from Google Sheets...');
      const sheetData = await this.sheetsClient.readSheet(purchasesMapping.sheetName);
      console.log(`[CacheService.syncPurchases] Fetched ${sheetData.length} rows`);
      const allItems: Record<string, unknown>[] = [];

      for (const row of sheetData) {
        const sheetsId = row['ID'];
        if (!sheetsId || sheetsId.trim() === '') continue;

        try {
          const transformed = transformRow(row, purchasesMapping);
          transformed.user_id = this.userId;
          transformed.sheets_synced_at = new Date().toISOString();
          allItems.push(transformed);
        } catch {
          // Skip rows with transform errors
        }
      }

      // Sync strategy: Delete all user's purchases and re-insert from Sheets
      // (Sheets is source of truth, this is a full cache refresh)
      console.log(`[CacheService.syncPurchases] Transformed ${allItems.length} items`);

      if (allItems.length > 0) {
        // Delete existing purchases for this user
        console.log('[CacheService.syncPurchases] Deleting existing purchases...');
        const { error: deleteError } = await this.supabase
          .from('purchases')
          .delete()
          .eq('user_id', this.userId);

        if (deleteError) {
          console.error('[CacheService.syncPurchases] Delete error:', deleteError);
          throw deleteError;
        }

        // Process in batches
        console.log('[CacheService.syncPurchases] Inserting in batches...');
        for (let i = 0; i < allItems.length; i += this.config.batchSize) {
          const batch = allItems.slice(i, i + this.config.batchSize);
          const { error } = await this.supabase.from('purchases').insert(batch);

          if (error) {
            console.error(`[CacheService.syncPurchases] Insert error at batch ${i}:`, error);
            throw error;
          }
        }
        console.log('[CacheService.syncPurchases] Insert complete');
      }

      try {
        await this.updateCacheMetadata('purchases', 'success', allItems.length);
      } catch (metaError) {
        console.error('[CacheService.syncPurchases] Failed to update cache metadata:', metaError);
        // Don't fail the sync just because metadata update failed
      }
      return { success: true, count: allItems.length };
    } catch (error) {
      console.error('[CacheService.syncPurchases] Error:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      try {
        await this.updateCacheMetadata('purchases', 'error', 0, message);
      } catch {
        // Ignore metadata update errors
      }
      return { success: false, count: 0, error: message };
    } finally {
      // Release lock
      syncLocks.delete(`${this.userId}:purchases`);
    }
  }

  /**
   * Invalidate cache for a specific record (after writes)
   */
  async invalidateRecord(tableName: string, _recordId?: string): Promise<void> {
    // Mark the cache as stale by updating last_sync to a very old date
    await this.supabase.from('cache_metadata').upsert(
      {
        id: `${this.userId}:${tableName}`,
        table_name: tableName,
        user_id: this.userId,
        last_sync: new Date(0).toISOString(),
        sync_status: 'pending',
        record_count: 0,
      },
      { onConflict: 'id' }
    );
  }

  /**
   * Get cached data or sync from Sheets if stale
   */
  async getWithSync<T>(
    tableName: 'inventory_items' | 'purchases',
    fetchFromCache: () => Promise<T>
  ): Promise<T> {
    const isStale = await this.isCacheStale(tableName);

    if (isStale && this.config.syncOnMiss) {
      // Sync in background if stale
      if (tableName === 'inventory_items') {
        this.syncInventory().catch(console.error);
      } else {
        this.syncPurchases().catch(console.error);
      }
    }

    return fetchFromCache();
  }

  // Private helper methods

  private async getCacheMetadata(tableName: string): Promise<CacheMetadata | null> {
    const { data } = await this.supabase
      .from('cache_metadata')
      .select('*')
      .eq('id', `${this.userId}:${tableName}`)
      .single();

    return data as CacheMetadata | null;
  }

  private async setCacheStatus(tableName: string, status: 'pending' | 'success' | 'error') {
    await this.supabase.from('cache_metadata').upsert(
      {
        id: `${this.userId}:${tableName}`,
        table_name: tableName,
        user_id: this.userId,
        sync_status: status,
        last_sync: new Date().toISOString(),
        record_count: 0,
      },
      { onConflict: 'id' }
    );
  }

  private async updateCacheMetadata(
    tableName: string,
    status: 'success' | 'error',
    recordCount: number,
    errorMessage?: string
  ) {
    await this.supabase.from('cache_metadata').upsert(
      {
        id: `${this.userId}:${tableName}`,
        table_name: tableName,
        user_id: this.userId,
        last_sync: new Date().toISOString(),
        sync_status: status,
        error_message: errorMessage,
        record_count: recordCount,
      },
      { onConflict: 'id' }
    );
  }
}

// Singleton instance management
let cacheServiceInstance: CacheService | null = null;

/**
 * Get or create the cache service singleton
 */
export function getCacheService(
  supabase: GenericSupabaseClient,
  sheetsClient: GoogleSheetsClient,
  userId: string,
  config?: Partial<CacheConfig>
): CacheService {
  if (
    !cacheServiceInstance ||
    // Reset if user changed
    (cacheServiceInstance as unknown as { userId: string }).userId !== userId
  ) {
    cacheServiceInstance = new CacheService(supabase, sheetsClient, userId, config);
  }
  return cacheServiceInstance;
}

/**
 * Reset the cache service (for testing)
 */
export function resetCacheService(): void {
  cacheServiceInstance = null;
}
