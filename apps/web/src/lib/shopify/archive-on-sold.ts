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
      .neq('inventory_item_id', inventoryItemId)
      .eq('shopify_status', 'active');

    if (siblings && siblings.length > 0) {
      // Grouped product — check if any sibling is still LISTED
      const siblingIds = siblings.map((s) => s.inventory_item_id);
      const { data: activeItems } = await supabase
        .from('inventory_items')
        .select('id')
        .in('id', siblingIds)
        .eq('status', 'LISTED');

      if (activeItems && activeItems.length > 0) {
        // Other items still active — mark this mapping as archived and decrement inventory
        await supabase
          .from('shopify_products')
          .update({
            shopify_status: 'archived',
            sync_status: 'synced',
            last_synced_at: new Date().toISOString(),
          })
          .eq('inventory_item_id', inventoryItemId);

        // Decrement Shopify inventory quantity
        try {
          const { data: config } = await supabase
            .from('shopify_config')
            .select('location_id')
            .eq('user_id', userId)
            .single();

          if (config?.location_id && mapping.shopify_product_id) {
            // Get the inventory_item_id from the mapping to get the variant's inventory item
            const { data: fullMapping } = await supabase
              .from('shopify_products')
              .select('shopify_inventory_item_id')
              .eq('inventory_item_id', inventoryItemId)
              .single();

            if (fullMapping?.shopify_inventory_item_id) {
              const { ShopifyClient } = await import('./client');
              const { data: fullConfig } = await supabase
                .from('shopify_config')
                .select('*')
                .eq('user_id', userId)
                .single();

              if (fullConfig) {
                const client = new ShopifyClient(fullConfig as never);
                await client.setInventoryLevel(
                  fullMapping.shopify_inventory_item_id,
                  config.location_id,
                  activeItems.length
                );
              }
            }
          }
        } catch (invErr) {
          console.warn(
            `[archiveShopifyOnSold] Failed to decrement inventory for grouped product:`,
            invErr instanceof Error ? invErr.message : invErr
          );
        }

        const { data: item } = await supabase
          .from('inventory_items')
          .select('set_number, item_name, sold_platform')
          .eq('id', inventoryItemId)
          .single();

        discordService
          .sendSyncStatus({
            title: '🏪 Shopify Group Quantity Reduced',
            message: `**${item?.item_name ?? 'Unknown'} (${item?.set_number ?? '?'})** sold on ${item?.sold_platform ?? 'unknown'}. Shopify quantity reduced to ${activeItems.length}.`,
            success: true,
          })
          .catch(() => {});

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

      discordService
        .sendSyncStatus({
          title: '🏪 Shopify Product Archived',
          message: `**${title}** removed from Shopify after selling on ${platform}.`,
          success: true,
        })
        .catch(() => {}); // Non-blocking
    }
  } catch (error) {
    // Never throw — sale flow must always succeed
    console.error(
      `[archiveShopifyOnSold] Failed to archive Shopify product for inventory ${inventoryItemId}:`,
      error instanceof Error ? error.message : error
    );
  }
}
