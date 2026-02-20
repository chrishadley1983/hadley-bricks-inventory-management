import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { BricqerClient } from '../bricqer/client';
import { normalizeInventoryItem } from '../bricqer/adapter';
import type { BricqerCredentials } from '../bricqer/types';
import { CredentialsRepository } from '../repositories/credentials.repository';
import { MinifigConfigService } from './config.service';
import { MinifigJobTracker } from './job-tracker';
import type { SyncProgressCallback } from '@/types/minifig-sync-stream';

interface PullOptions {
  onProgress?: SyncProgressCallback;
  /** Maximum time in ms before the pull should return (even if incomplete). Default: no limit. */
  maxDurationMs?: number;
}

interface PullResult {
  jobId: string;
  itemsProcessed: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsErrored: number;
  errors: Array<{ item?: string; error: string }>;
  /** True if all pages were processed; false if interrupted and needs another invocation */
  complete: boolean;
}

/** Maximum pages to process in a single function invocation (stay within Vercel timeout) */
const MAX_PAGES_PER_INVOCATION = 500;

export class InventoryPullService {
  private configService: MinifigConfigService;
  private jobTracker: MinifigJobTracker;

  constructor(
    private supabase: SupabaseClient<Database>,
    private userId: string,
  ) {
    this.configService = new MinifigConfigService(supabase);
    this.jobTracker = new MinifigJobTracker(supabase, userId);
  }

  async pull(options?: PullOptions): Promise<PullResult> {
    const onProgress = options?.onProgress;
    const startTime = Date.now();
    const maxDurationMs = options?.maxDurationMs;

    // 1. Check for an interrupted job to resume
    let jobId: string;
    let startPage = 1;
    let itemsProcessed = 0;
    let itemsCreated = 0;
    let itemsUpdated = 0;
    let itemsErrored = 0;
    const errors: Array<{ item?: string; error: string }> = [];

    const interrupted = await this.jobTracker.findInterruptedJob('INVENTORY_PULL');
    if (interrupted) {
      jobId = interrupted.id;
      startPage = interrupted.last_poll_cursor ? parseInt(interrupted.last_poll_cursor, 10) + 1 : 1;
      itemsProcessed = interrupted.items_processed ?? 0;
      itemsCreated = interrupted.items_created ?? 0;
      itemsUpdated = interrupted.items_updated ?? 0;
      itemsErrored = interrupted.items_errored ?? 0;
      await onProgress?.({
        type: 'stage',
        stage: 'resume',
        message: `Resuming from page ${startPage} (${itemsProcessed} items already processed)...`,
      });
    } else {
      jobId = await this.jobTracker.start('INVENTORY_PULL');
    }

    try {
      // 2. Load config
      await onProgress?.({ type: 'stage', stage: 'config', message: 'Loading configuration...' });
      const config = await this.configService.getConfig();

      // 3. Get Bricqer credentials and create client
      await onProgress?.({ type: 'stage', stage: 'credentials', message: 'Checking Bricqer credentials...' });
      const credentialsRepo = new CredentialsRepository(this.supabase);
      const credentials = await credentialsRepo.getCredentials<BricqerCredentials>(
        this.userId,
        'bricqer',
      );

      if (!credentials) {
        throw new Error('Bricqer credentials not configured');
      }

      const client = new BricqerClient(credentials);

      // 4. Load existing sync items for upsert matching
      await onProgress?.({ type: 'stage', stage: 'match', message: 'Loading existing sync items...' });
      const existingByBricqerId = await this.loadExistingItems();

      // 5. Page-by-page fetch, filter, and upsert
      await onProgress?.({
        type: 'stage',
        stage: 'sync',
        message: startPage > 1
          ? `Syncing inventory (resuming from page ${startPage})...`
          : 'Syncing inventory from Bricqer...',
      });

      let page = startPage;
      let hasMore = true;
      let totalCount = 0;
      let pagesThisInvocation = 0;

      while (hasMore && pagesThisInvocation < MAX_PAGES_PER_INVOCATION) {
        // Check time budget before fetching next page
        if (maxDurationMs && (Date.now() - startTime) >= maxDurationMs) {
          break;
        }

        const pageResult = await client.fetchInventoryPage(page);
        totalCount = pageResult.totalCount;
        hasMore = pageResult.hasMore;
        pagesThisInvocation++;

        // Filter this page for used minifigs meeting price threshold
        for (const rawItem of pageResult.items) {
          const normalized = normalizeInventoryItem(rawItem);
          if (
            !normalized ||
            normalized.condition !== 'Used' ||
            normalized.itemType !== 'Minifig' ||
            (normalized.price ?? 0) < config.min_bricqer_listing_price
          ) {
            continue;
          }

          itemsProcessed++;
          try {
            const result = await this.upsertMinifig(rawItem, normalized, existingByBricqerId);
            if (result === 'created') itemsCreated++;
            else if (result === 'updated') itemsUpdated++;
          } catch (err) {
            itemsErrored++;
            errors.push({
              item: normalized.itemNumber,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        // Checkpoint progress after each page
        await this.jobTracker.updateProgress(jobId, String(page), {
          itemsProcessed,
          itemsCreated,
          itemsUpdated,
          itemsErrored,
        });

        // Emit progress
        const totalPages = totalCount > 0 ? Math.ceil(totalCount / 100) : page;
        await onProgress?.({
          type: 'progress',
          current: page * 100,
          total: totalCount || page * 100,
          message: `Page ${page}/${totalPages} — ${itemsProcessed} minifigs found`,
        });

        page++;
      }

      const isComplete = !hasMore;

      if (isComplete) {
        // All pages processed — mark job complete
        await this.jobTracker.complete(jobId, {
          itemsProcessed,
          itemsCreated,
          itemsUpdated,
          itemsErrored,
        });
      }
      // If not complete, job stays RUNNING with cursor for next invocation

      return {
        jobId,
        itemsProcessed,
        itemsCreated,
        itemsUpdated,
        itemsErrored,
        errors,
        complete: isComplete,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push({ error: errorMsg });

      await this.jobTracker.fail(jobId, errors, {
        itemsProcessed,
        itemsCreated,
        itemsUpdated,
        itemsErrored,
      });

      throw err;
    }
  }

  private async loadExistingItems(): Promise<
    Map<string, { id: string; bricqer_price: number | null; updated_at: string | null }>
  > {
    const existingItems: Array<{
      id: string;
      bricqer_item_id: string;
      bricqer_price: number | null;
      updated_at: string | null;
    }> = [];
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;
    while (hasMore) {
      const { data } = await this.supabase
        .from('minifig_sync_items')
        .select('id, bricqer_item_id, bricqer_price, updated_at')
        .eq('user_id', this.userId)
        .range(page * pageSize, (page + 1) * pageSize - 1);
      existingItems.push(
        ...((data ?? []) as Array<{
          id: string;
          bricqer_item_id: string;
          bricqer_price: number | null;
          updated_at: string | null;
        }>),
      );
      hasMore = (data?.length ?? 0) === pageSize;
      page++;
    }
    return new Map(existingItems.map((item) => [item.bricqer_item_id, item]));
  }

  private async upsertMinifig(
    raw: Parameters<typeof normalizeInventoryItem>[0],
    normalized: NonNullable<ReturnType<typeof normalizeInventoryItem>>,
    existingByBricqerId: Map<
      string,
      { id: string; bricqer_price: number | null; updated_at: string | null }
    >,
  ): Promise<'created' | 'updated'> {
    const bricqerItemId = String(raw.id);
    const definition = raw.definition;
    const now = new Date().toISOString();

    const existing = existingByBricqerId.get(bricqerItemId);

    if (existing) {
      await this.supabase
        .from('minifig_sync_items')
        .update({
          name: normalized.itemName,
          bricklink_id: definition.legoId || null,
          bricqer_price: normalized.price,
          condition_notes: raw.remarks || null,
          bricqer_image_url: definition.picture || definition.legoPicture || null,
          updated_at: now,
          last_synced_at: now,
        })
        .eq('id', existing.id)
        .eq('user_id', this.userId);

      return 'updated';
    } else {
      await this.supabase.from('minifig_sync_items').insert({
        user_id: this.userId,
        bricqer_item_id: bricqerItemId,
        bricklink_id: definition.legoId || null,
        name: normalized.itemName,
        condition_notes: raw.remarks || null,
        bricqer_price: normalized.price,
        bricqer_image_url: definition.picture || definition.legoPicture || null,
        listing_status: 'NOT_LISTED',
        last_synced_at: now,
      });

      // Add to map so subsequent pages don't re-insert
      existingByBricqerId.set(bricqerItemId, {
        id: bricqerItemId,
        bricqer_price: normalized.price ?? null,
        updated_at: now,
      });

      return 'created';
    }
  }
}
