/**
 * Non-blocking Shopify archive helper.
 *
 * Called after an inventory item transitions to SOLD. Catches all errors so
 * the sale flow is never blocked. For grouped products (multiple inventory
 * items sharing one Shopify product), skips archive if other items in the
 * group are still active — the batchSync safety-net handles the final archive.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { ShopifySyncService } from './sync.service';
import { discordService } from '@/lib/notifications';

/**
 * Archive a Shopify product for the given inventory item, if one exists.
 * Safe to call for items with no Shopify mapping — returns silently.
 *
 * @param supabase  Authenticated Supabase client
 * @param userId    Owner of the inventory/shopify config
 * @param inventoryItemId  The inventory item that was just sold
 */
export async function archiveShopifyOnSold(
  supabase: SupabaseClient<Database>,
  userId: string,
  inventoryItemId: string
): Promise<void> {
  try {
    // Check if this item has a Shopify mapping at all
    const { data: mapping } = await supabase
      .from('shopify_products')
      .select('id, shopify_product_id, shopify_status')
      .eq('inventory_item_id', inventoryItemId)
      .single();

    if (!mapping || !mapping.shopify_product_id || mapping.shopify_status === 'archived') {
      return; // No mapping or already archived
    }

    // Check if this is a grouped product (multiple inventory items share the same Shopify product)
    const { data: siblings } = await supabase
      .from('shopify_products')
      .select('inventory_item_id')
      .eq('shopify_product_id', mapping.shopify_product_id)
      .neq('inventory_item_id', inventoryItemId);

    if (siblings && siblings.length > 0) {
      // Grouped product — check if any sibling is still LISTED
      const siblingIds = siblings.map((s) => s.inventory_item_id);
      const { data: activeItems } = await supabase
        .from('inventory_items')
        .select('id')
        .in('id', siblingIds)
        .eq('status', 'LISTED')
        .limit(1);

      if (activeItems && activeItems.length > 0) {
        // Other items still active on this product — skip archive, let batchSync handle it
        return;
      }
    }

    // Archive the Shopify product
    const syncService = new ShopifySyncService(supabase, userId);
    const result = await syncService.archiveProduct(inventoryItemId);

    if (result.success) {
      // Fetch item details for the notification
      const { data: item } = await supabase
        .from('inventory_items')
        .select('set_number, item_name, sold_platform')
        .eq('id', inventoryItemId)
        .single();

      const title = mapping.shopify_product_id
        ? `${item?.item_name ?? 'Unknown'} (${item?.set_number ?? '?'})`
        : 'Unknown product';
      const platform = item?.sold_platform ?? 'unknown';

      discordService.sendSyncStatus({
        title: '🏪 Shopify Product Archived',
        message: `**${title}** removed from Shopify after selling on ${platform}.`,
        success: true,
      }).catch(() => {}); // Non-blocking
    }
  } catch (error) {
    // Never throw — sale flow must always succeed
    console.error(
      `[archiveShopifyOnSold] Failed to archive Shopify product for inventory ${inventoryItemId}:`,
      error instanceof Error ? error.message : error
    );
  }
}
