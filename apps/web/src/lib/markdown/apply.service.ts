/**
 * Markdown Apply Service
 *
 * Applies an approved markdown proposal:
 * - eBay: pushes the new price LIVE via ReviseFixedPriceItem, then aligns the DB.
 * - Amazon: queues the price change in amazon_sync_queue so it follows the
 *   standard two-phase sync process (feed submit → price verify → quantity),
 *   with its verification grace and failure emails — no direct SP-API push.
 *
 * See docs/features/unified-markdown/design.md §10.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { EbayTradingClient } from '@/lib/platform-stock/ebay/ebay-trading.client';
import { EbayAuthService } from '@/lib/ebay/ebay-auth.service';
import { AmazonSyncService } from '@/lib/amazon/amazon-sync.service';
import { UK_MARKETPLACE_ID } from '@/lib/amazon/amazon-sync.types';

export interface ApplyProposalInput {
  id: string;
  inventory_item_id: string;
  platform: string;
  proposed_action: string;
  proposed_price: number | null;
}

export interface ApplyResult {
  success: boolean;
  /** Price is live on the platform (eBay revise succeeded). */
  pushed: boolean;
  /** Price change queued in amazon_sync_queue awaiting the two-phase sync. */
  queued?: boolean;
  error?: string;
}

/**
 * Apply a single proposal. Returns whether the live platform push succeeded.
 * Caller is responsible for updating proposal status based on the result.
 */
export async function applyProposalLive(
  supabase: SupabaseClient<Database>,
  userId: string,
  proposal: ApplyProposalInput
): Promise<ApplyResult> {
  // Auctions are recommendations only — no live push.
  if (proposal.proposed_action !== 'MARKDOWN' || proposal.proposed_price == null) {
    return { success: true, pushed: false };
  }

  // Look up platform identifiers for the inventory item.
  const { data: item, error: itemErr } = await supabase
    .from('inventory_items')
    .select('id, sku, ebay_listing_id, amazon_asin, listing_platform')
    .eq('id', proposal.inventory_item_id)
    .single();

  if (itemErr || !item) {
    return { success: false, pushed: false, error: 'Inventory item not found' };
  }

  const newPrice = Number(proposal.proposed_price);
  const platform = proposal.platform.toLowerCase();

  try {
    if (platform === 'ebay') {
      if (!item.ebay_listing_id) {
        return { success: false, pushed: false, error: 'No eBay listing id on item' };
      }
      const auth = new EbayAuthService(undefined, supabase as never);
      const accessToken = await auth.getAccessToken(userId);
      if (!accessToken) {
        return { success: false, pushed: false, error: 'eBay not connected' };
      }
      const client = new EbayTradingClient({ accessToken, siteId: 3 });
      const result = await client.reviseFixedPriceItem({
        itemId: item.ebay_listing_id,
        startPrice: newPrice,
        currency: 'GBP',
      });
      if (!result.success) {
        return { success: false, pushed: false, error: result.errorMessage || 'eBay revise failed' };
      }
    } else if (platform === 'amazon') {
      if (!item.amazon_asin) {
        return { success: false, pushed: false, error: 'No ASIN on item' };
      }
      // Resolve an active SKU for this ASIN.
      const { data: listing } = await supabase
        .from('platform_listings')
        .select('platform_sku')
        .eq('user_id', userId)
        .eq('platform', 'amazon')
        .eq('platform_item_id', item.amazon_asin)
        .not('platform_sku', 'is', null)
        .limit(1)
        .maybeSingle();

      if (!listing?.platform_sku) {
        return { success: false, pushed: false, error: 'No Amazon SKU found for ASIN' };
      }

      // Queue the price change so it follows the standard two-phase sync
      // (feed submit → price verify → quantity) instead of a direct push.
      const syncService = new AmazonSyncService(supabase, userId);
      const productType = await syncService.getProductTypeForAsin(
        item.amazon_asin,
        UK_MARKETPLACE_ID
      );

      // Align the local price first — the sync feed pushes local_price and the
      // conflict checks compare against inventory_items.listing_value.
      await supabase
        .from('inventory_items')
        .update({ listing_value: newPrice, updated_at: new Date().toISOString() })
        .eq('id', proposal.inventory_item_id);

      const { error: insertError } = await supabase.from('amazon_sync_queue').insert({
        user_id: userId,
        inventory_item_id: proposal.inventory_item_id,
        sku: item.sku || item.amazon_asin,
        asin: item.amazon_asin,
        local_price: newPrice,
        local_quantity: 1,
        amazon_sku: listing.platform_sku,
        amazon_price: null,
        amazon_quantity: null,
        product_type: productType,
        is_new_sku: false,
      });

      if (insertError) {
        if (insertError.code === '23505') {
          // Already queued — update the price on the existing queue row.
          const { error: updateQueueError } = await supabase
            .from('amazon_sync_queue')
            .update({ local_price: newPrice })
            .eq('inventory_item_id', proposal.inventory_item_id)
            .eq('user_id', userId);
          if (updateQueueError) {
            return { success: false, pushed: false, error: updateQueueError.message };
          }
        } else {
          return { success: false, pushed: false, error: insertError.message };
        }
      }

      return { success: true, pushed: false, queued: true };
    } else {
      return { success: false, pushed: false, error: `Unsupported platform: ${platform}` };
    }

    // Push succeeded — align the inventory record.
    await supabase
      .from('inventory_items')
      .update({ listing_value: newPrice, updated_at: new Date().toISOString() })
      .eq('id', proposal.inventory_item_id);

    return { success: true, pushed: true };
  } catch (err) {
    return {
      success: false,
      pushed: false,
      error: err instanceof Error ? err.message : 'Unknown push error',
    };
  }
}
