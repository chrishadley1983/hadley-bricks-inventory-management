import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { BricqerClient } from '../bricqer/client';
import { normalizeInventoryItem } from '../bricqer/adapter';
import type { BricqerCredentials } from '../bricqer/types';
import { CredentialsRepository } from '../repositories/credentials.repository';
import { MinifigConfigService } from './config.service';
import { MinifigJobTracker } from './job-tracker';
import type { MinifigSyncConfig } from './types';

interface PullResult {
  jobId: string;
  itemsProcessed: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsErrored: number;
  errors: Array<{ item?: string; error: string }>;
}

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

  async pull(): Promise<PullResult> {
    const jobId = await this.jobTracker.start('INVENTORY_PULL');
    const errors: Array<{ item?: string; error: string }> = [];
    let itemsProcessed = 0;
    let itemsCreated = 0;
    let itemsUpdated = 0;
    let itemsErrored = 0;

    try {
      // 1. Load config
      const config = await this.configService.getConfig();

      // 2. Get Bricqer credentials and create client
      const credentialsRepo = new CredentialsRepository(this.supabase);
      const credentials = await credentialsRepo.getCredentials<BricqerCredentials>(
        this.userId,
        'bricqer',
      );

      if (!credentials) {
        throw new Error('Bricqer credentials not configured');
      }

      const client = new BricqerClient(credentials);

      // 3. Fetch all used inventory items from Bricqer
      const rawItems = await client.getAllInventoryItems({ condition: 'U' });

      // 4. Post-filter for minifigures and price threshold
      const minifigs = rawItems
        .map((item) => {
          const normalized = normalizeInventoryItem(item);
          return { raw: item, normalized };
        })
        .filter(({ normalized }) => normalized.itemType === 'Minifig')
        .filter(
          ({ normalized }) =>
            (normalized.price ?? 0) >= config.min_bricqer_listing_price,
        );

      itemsProcessed = minifigs.length;

      // 5. Upsert each minifig into minifig_sync_items
      for (const { raw, normalized } of minifigs) {
        try {
          const result = await this.upsertMinifig(raw, normalized, config);
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

      // 6. Complete job
      await this.jobTracker.complete(jobId, {
        itemsProcessed,
        itemsCreated,
        itemsUpdated,
        itemsErrored,
      });

      return {
        jobId,
        itemsProcessed,
        itemsCreated,
        itemsUpdated,
        itemsErrored,
        errors,
      };
    } catch (err) {
      // Top-level failure (credentials, API outage, etc.)
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

  private async upsertMinifig(
    raw: Parameters<typeof normalizeInventoryItem>[0],
    normalized: ReturnType<typeof normalizeInventoryItem>,
    _config: MinifigSyncConfig,
  ): Promise<'created' | 'updated'> {
    const bricqerItemId = String(raw.id);
    const definition = raw.definition;

    // Check if already exists
    const { data: existing } = await this.supabase
      .from('minifig_sync_items')
      .select('id, bricqer_price, updated_at')
      .eq('bricqer_item_id', bricqerItemId)
      .single();

    const now = new Date().toISOString();

    if (existing) {
      // Update existing row
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
        .eq('id', existing.id);

      return 'updated';
    } else {
      // Insert new row
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

      return 'created';
    }
  }
}
