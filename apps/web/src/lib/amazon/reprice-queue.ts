/**
 * Amazon ASIN reprice → sync-queue helper.
 *
 * An Amazon price is per-SKU, so repricing one unit reprices the ASIN. This
 * helper therefore queues EVERY in-play unit (LISTED/BACKLOG) of the ASIN:
 * the two-phase sync aggregates queue rows by ASIN and pushes
 * totalQuantity = amazon_quantity (null → 0) + row count, so queueing only a
 * subset of units would clamp the live Amazon stock to that subset. With all
 * units queued the pushed quantity equals our full unit count.
 *
 * Shared by the buy-box-gap reprice route and markdown proposal approvals.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { AmazonSyncService } from './amazon-sync.service';
import { UK_MARKETPLACE_ID } from './amazon-sync.types';

const IN_PLAY_STATUSES = ['LISTED', 'BACKLOG', 'listed', 'backlog'];

export interface RepriceQueueResult {
  success: boolean;
  itemsUpdated: number;
  queued: number;
  /** Per-item queue errors (partial failures). */
  errors: string[];
  /** Fatal error — nothing was queued. */
  error?: string;
}

export async function queueAmazonRepriceByAsin(
  supabase: SupabaseClient<Database>,
  userId: string,
  asin: string,
  newPrice: number
): Promise<RepriceQueueResult> {
  const fail = (error: string): RepriceQueueResult => ({
    success: false,
    itemsUpdated: 0,
    queued: 0,
    errors: [],
    error,
  });

  // 1. Every in-play unit of this ASIN.
  const { data: inventoryItems, error: fetchError } = await supabase
    .from('inventory_items')
    .select('id, listing_value, status, sku, amazon_asin')
    .eq('amazon_asin', asin)
    .eq('user_id', userId)
    .in('status', IN_PLAY_STATUSES);

  if (fetchError) {
    return fail(`Failed to find inventory items: ${fetchError.message}`);
  }
  if (!inventoryItems || inventoryItems.length === 0) {
    return fail(`No inventory items found for ASIN ${asin}`);
  }

  // 2. Align local prices — all units share the ASIN price.
  const { error: updateError } = await supabase
    .from('inventory_items')
    .update({ listing_value: newPrice })
    .eq('amazon_asin', asin)
    .eq('user_id', userId)
    .in('status', IN_PLAY_STATUSES);

  if (updateError) {
    return fail(`Failed to update listing price: ${updateError.message}`);
  }

  // 3. Amazon SKU shared across the ASIN's units (newest listing row wins).
  const { data: listing } = await supabase
    .from('platform_listings')
    .select('platform_sku, platform_item_id')
    .eq('user_id', userId)
    .eq('platform', 'amazon')
    .eq('platform_item_id', asin)
    .not('platform_sku', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const amazonSku = listing?.platform_sku ?? null;

  // 4. Real product type for the ASIN.
  const service = new AmazonSyncService(supabase, userId);
  const productType = await service.getProductTypeForAsin(asin, UK_MARKETPLACE_ID);

  // 5. Keep the buy-box-gap report's price fresh (no-op if the ASIN isn't tracked).
  await supabase
    .from('tracked_asins')
    .update({ price: newPrice })
    .eq('asin', asin)
    .eq('user_id', userId);

  // 6. Queue every unit.
  let queued = 0;
  const errors: string[] = [];

  for (const item of inventoryItems) {
    try {
      const status = item.status?.toUpperCase();
      if (status === 'BACKLOG') {
        // Standard add-to-queue (it expects BACKLOG status and fetches live
        // Amazon price/quantity itself).
        const result = await service.addToQueue(item.id, true);
        if (result.success) {
          queued++;
        } else if (result.error && !result.error.includes('already in the sync queue')) {
          errors.push(`${item.id}: ${result.error}`);
        } else {
          queued++; // already in queue counts as success
        }
      } else {
        if (!amazonSku) {
          errors.push(`${item.id}: No Amazon SKU found in platform_listings`);
          continue;
        }

        const { error: insertError } = await supabase.from('amazon_sync_queue').insert({
          user_id: userId,
          inventory_item_id: item.id,
          sku: item.sku || asin,
          asin,
          local_price: newPrice,
          local_quantity: 1,
          amazon_sku: amazonSku,
          amazon_price: null,
          amazon_quantity: null,
          product_type: productType,
          is_new_sku: false,
        });

        if (insertError) {
          if (insertError.code === '23505') {
            // Already in queue — update the price instead.
            const { error: updateQueueError } = await supabase
              .from('amazon_sync_queue')
              .update({ local_price: newPrice })
              .eq('inventory_item_id', item.id)
              .eq('user_id', userId);
            if (updateQueueError) {
              errors.push(`${item.id}: ${updateQueueError.message}`);
            } else {
              queued++;
            }
          } else {
            errors.push(`${item.id}: ${insertError.message}`);
          }
        } else {
          queued++;
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${item.id}: ${msg}`);
    }
  }

  return {
    success: queued > 0 && errors.length === 0,
    itemsUpdated: inventoryItems.length,
    queued,
    errors,
  };
}
