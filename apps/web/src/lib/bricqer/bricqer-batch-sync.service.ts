/**
 * Bricqer Batch Sync Service
 *
 * Syncs Bricqer batches to the bricklink_uploads table.
 * Batches represent inventory uploaded to BrickLink/BrickOwl stores.
 */

import { createClient } from '@/lib/supabase/server';
import { BricqerClient } from './client';
import { CredentialsRepository } from '@/lib/repositories';
import type { BricqerBatch, BricqerPurchase, BricqerCredentials } from './types';
import type {
  BatchSyncResult,
  BatchSyncMode,
  BatchSyncOptions,
  BatchConnectionStatus,
  Json,
} from './bricqer-batch-sync.types';
import { parseCurrencyValue } from './bricqer-batch-sync.types';

// ============================================================================
// Constants
// ============================================================================

const BATCH_SIZE = 100; // Upsert batch size

// ============================================================================
// Types
// ============================================================================

interface UploadRow {
  user_id: string;
  bricqer_batch_id: number;
  bricqer_purchase_id: number | null;
  upload_date: string;
  total_quantity: number;
  selling_price: number;
  cost: number;
  lots: number;
  condition: string;
  reference: string | null;
  is_activated: boolean;
  remaining_quantity: number;
  remaining_price: number;
  raw_response: Json;
  synced_from_bricqer: boolean;
}

// ============================================================================
// BricqerBatchSyncService Class
// ============================================================================

export class BricqerBatchSyncService {
  // ============================================================================
  // Connection Status
  // ============================================================================

  /**
   * Get connection status and sync information
   */
  async getConnectionStatus(userId: string): Promise<BatchConnectionStatus> {
    const supabase = await createClient();
    const credentialsRepo = new CredentialsRepository(supabase);

    // Check if credentials exist
    const hasCredentials = await credentialsRepo.hasCredentials(userId, 'bricqer');

    if (!hasCredentials) {
      return { isConnected: false };
    }

    // Get upload count
    const { count: uploadCount } = await supabase
      .from('bricklink_uploads')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    // Get sync config
    const { data: syncConfig } = await supabase
      .from('bricklink_upload_sync_config')
      .select('*')
      .eq('user_id', userId)
      .single();

    // Get recent sync logs
    const { data: recentLogs } = await supabase
      .from('bricklink_upload_sync_log')
      .select('*')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(5);

    // Get last successful sync
    const { data: lastSync } = await supabase
      .from('bricklink_upload_sync_log')
      .select('completed_at')
      .eq('user_id', userId)
      .eq('status', 'COMPLETED')
      .order('completed_at', { ascending: false })
      .limit(1)
      .single();

    return {
      isConnected: true,
      uploadCount: uploadCount ?? 0,
      lastSyncAt: lastSync?.completed_at ?? undefined,
      syncConfig: syncConfig
        ? {
            autoSyncEnabled: syncConfig.auto_sync_enabled,
            autoSyncIntervalHours: syncConfig.auto_sync_interval_hours,
            nextAutoSyncAt: syncConfig.next_auto_sync_at ?? undefined,
            syncActivatedOnly: syncConfig.sync_activated_only,
          }
        : undefined,
      recentLogs: recentLogs?.map((log) => ({
        id: log.id,
        syncMode: log.sync_mode as BatchSyncMode,
        status: log.status as 'RUNNING' | 'COMPLETED' | 'FAILED',
        startedAt: log.started_at,
        completedAt: log.completed_at ?? undefined,
        batchesProcessed: log.batches_processed ?? undefined,
        batchesCreated: log.batches_created ?? undefined,
        batchesUpdated: log.batches_updated ?? undefined,
        error: log.error_message ?? undefined,
      })),
    };
  }

  // ============================================================================
  // Batch Sync
  // ============================================================================

  /**
   * Sync batches from Bricqer API
   */
  async syncBatches(userId: string, options?: BatchSyncOptions): Promise<BatchSyncResult> {
    console.log('[BricqerBatchSyncService] Starting batch sync for user:', userId, 'options:', options);
    const startedAt = new Date();
    const supabase = await createClient();
    const syncMode: BatchSyncMode = options?.fullSync ? 'FULL' : 'INCREMENTAL';
    const activatedOnly = options?.activatedOnly ?? true;
    console.log('[BricqerBatchSyncService] Sync mode:', syncMode, 'activatedOnly:', activatedOnly);

    // Check for running sync
    const { data: runningSync } = await supabase
      .from('bricklink_upload_sync_log')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'RUNNING')
      .single();

    if (runningSync) {
      console.log('[BricqerBatchSyncService] A sync is already running, skipping');
      return {
        success: false,
        syncMode,
        batchesProcessed: 0,
        batchesCreated: 0,
        batchesUpdated: 0,
        batchesSkipped: 0,
        error: 'A sync is already running',
        startedAt,
        completedAt: new Date(),
      };
    }

    // Create sync log entry
    console.log('[BricqerBatchSyncService] Creating sync log entry');
    const { data: syncLog, error: syncLogError } = await supabase
      .from('bricklink_upload_sync_log')
      .insert({
        user_id: userId,
        sync_mode: syncMode,
        status: 'RUNNING',
        started_at: startedAt.toISOString(),
      })
      .select()
      .single();

    if (syncLogError || !syncLog) {
      console.error('[BricqerBatchSyncService] Failed to create sync log:', syncLogError);
      return {
        success: false,
        syncMode,
        batchesProcessed: 0,
        batchesCreated: 0,
        batchesUpdated: 0,
        batchesSkipped: 0,
        error: 'Failed to create sync log',
        startedAt,
        completedAt: new Date(),
      };
    }

    console.log('[BricqerBatchSyncService] Sync log created:', syncLog.id);

    try {
      // Get Bricqer client
      console.log('[BricqerBatchSyncService] Getting Bricqer client...');
      const credentialsRepo = new CredentialsRepository(supabase);
      const credentials = await credentialsRepo.getCredentials<BricqerCredentials>(userId, 'bricqer');

      if (!credentials) {
        throw new Error('Bricqer credentials not configured');
      }

      const client = new BricqerClient(credentials);
      console.log('[BricqerBatchSyncService] Bricqer client ready');

      // Fetch batches and purchases from Bricqer
      console.log('[BricqerBatchSyncService] Fetching batches and purchases from Bricqer API...');
      const [batches, purchases] = await Promise.all([
        client.getBatches(),
        client.getPurchases(),
      ]);
      console.log('[BricqerBatchSyncService] Fetched batches:', batches.length, 'purchases:', purchases.length);

      // Create purchase lookup map for cost data
      const purchaseMap = new Map<number, BricqerPurchase>();
      for (const purchase of purchases) {
        purchaseMap.set(purchase.id, purchase);
      }

      // Filter batches
      let batchesToProcess = batches;
      if (activatedOnly) {
        batchesToProcess = batches.filter((batch) => batch.activated);
        console.log('[BricqerBatchSyncService] Filtered to activated batches:', batchesToProcess.length);
      }

      // Transform and upsert batches
      console.log('[BricqerBatchSyncService] Upserting batches to database...');
      const { created, updated, skipped } = await this.upsertBatches(
        userId,
        batchesToProcess,
        purchaseMap
      );
      console.log('[BricqerBatchSyncService] Upsert complete. Created:', created, 'Updated:', updated, 'Skipped:', skipped);

      // Update sync config
      await supabase.from('bricklink_upload_sync_config').upsert(
        {
          user_id: userId,
          sync_activated_only: activatedOnly,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

      const completedAt = new Date();

      // Update sync log
      await supabase
        .from('bricklink_upload_sync_log')
        .update({
          status: 'COMPLETED',
          completed_at: completedAt.toISOString(),
          batches_processed: batchesToProcess.length,
          batches_created: created,
          batches_updated: updated,
          batches_skipped: skipped,
        })
        .eq('id', syncLog.id);

      return {
        success: true,
        syncMode,
        batchesProcessed: batchesToProcess.length,
        batchesCreated: created,
        batchesUpdated: updated,
        batchesSkipped: skipped,
        startedAt,
        completedAt,
      };
    } catch (error) {
      const completedAt = new Date();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[BricqerBatchSyncService] Sync error:', errorMessage);

      // Update sync log with error
      await supabase
        .from('bricklink_upload_sync_log')
        .update({
          status: 'FAILED',
          completed_at: completedAt.toISOString(),
          error_message: errorMessage,
        })
        .eq('id', syncLog.id);

      return {
        success: false,
        syncMode,
        batchesProcessed: 0,
        batchesCreated: 0,
        batchesUpdated: 0,
        batchesSkipped: 0,
        error: errorMessage,
        startedAt,
        completedAt,
      };
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Transform a Bricqer batch to a database row
   */
  private transformBatchToRow(
    userId: string,
    batch: BricqerBatch,
    purchaseMap: Map<number, BricqerPurchase>
  ): UploadRow {
    // Get cost from linked purchase if available
    // Note: Bricqer doesn't expose purchase price directly on batch,
    // so we estimate from the purchase data when available
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _linkedPurchase = purchaseMap.get(batch.purchase);

    // For now, cost is set to 0 as Bricqer purchase API doesn't include price info
    // This can be populated later from manual entry or additional API calls
    const cost = 0;

    // Use activationDate if available, otherwise fall back to created date
    const uploadDate = batch.activationDate || batch.created;

    return {
      user_id: userId,
      bricqer_batch_id: batch.id,
      bricqer_purchase_id: batch.purchase,
      upload_date: uploadDate.split('T')[0], // Convert to DATE format
      total_quantity: batch.totalQuantity,
      selling_price: parseCurrencyValue(batch.totalPrice),
      cost,
      lots: batch.lots,
      condition: batch.condition,
      reference: batch.reference ?? null,
      is_activated: batch.activated,
      remaining_quantity: batch.remainingQuantity,
      remaining_price: parseCurrencyValue(batch.remainingPrice),
      raw_response: batch as unknown as Json,
      synced_from_bricqer: true,
    };
  }

  /**
   * Upsert batches to database
   */
  private async upsertBatches(
    userId: string,
    batches: BricqerBatch[],
    purchaseMap: Map<number, BricqerPurchase>
  ): Promise<{ created: number; updated: number; skipped: number }> {
    const supabase = await createClient();

    // Transform all batches to rows
    const rows = batches.map((batch) => this.transformBatchToRow(userId, batch, purchaseMap));

    if (rows.length === 0) {
      return { created: 0, updated: 0, skipped: 0 };
    }

    // Get existing batch IDs to determine created vs updated
    const batchIds = rows.map((r) => r.bricqer_batch_id);
    const { data: existingBatches } = await supabase
      .from('bricklink_uploads')
      .select('bricqer_batch_id')
      .eq('user_id', userId)
      .in('bricqer_batch_id', batchIds);

    const existingIds = new Set(existingBatches?.map((b) => b.bricqer_batch_id) ?? []);

    // Upsert in batches
    let created = 0;
    let updated = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('bricklink_uploads')
        .upsert(batch, { onConflict: 'user_id,bricqer_batch_id' });

      if (error) {
        console.error('[BricqerBatchSyncService] Upsert error:', error);
        throw new Error(`Failed to upsert batches: ${error.message}`);
      }

      // Count created vs updated
      for (const row of batch) {
        if (existingIds.has(row.bricqer_batch_id)) {
          updated++;
        } else {
          created++;
        }
      }
    }

    return { created, updated, skipped: 0 };
  }
}

// ============================================================================
// Export singleton-like factory
// ============================================================================

export function createBricqerBatchSyncService(): BricqerBatchSyncService {
  return new BricqerBatchSyncService();
}
