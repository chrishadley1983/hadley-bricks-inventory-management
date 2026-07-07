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
import { queueAmazonRepriceByAsin } from '@/lib/amazon/reprice-queue';

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

      // Queue the price change so it follows the standard two-phase sync
      // (feed submit → price verify → quantity) instead of a direct push.
      // An Amazon price is per-SKU, so this reprices and queues EVERY in-play
      // unit of the ASIN — queueing just this unit would make the sync's
      // quantity step clamp the live stock to 1 (see reprice-queue.ts).
      const result = await queueAmazonRepriceByAsin(
        supabase,
        userId,
        item.amazon_asin,
        newPrice
      );

      if (!result.success) {
        const detail = result.error || result.errors.join('; ') || 'Failed to queue reprice';
        return { success: false, pushed: false, error: detail };
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
