/**
 * Cross-Platform Order Polling Service (F48-F53, E11)
 *
 * Polls eBay and Bricqer for new sales of minifig sync items.
 * Creates removal queue entries for cross-platform delisting.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { EbayApiAdapter } from '@/lib/ebay/ebay-api.adapter';
import { ebayAuthService } from '@/lib/ebay/ebay-auth.service';
import { BricqerClient } from '@/lib/bricqer/client';
import type { BricqerCredentials } from '@/lib/bricqer/types';
import { CredentialsRepository } from '@/lib/repositories/credentials.repository';
import { discordService, DiscordColors } from '@/lib/notifications/discord.service';
import { MinifigJobTracker } from './job-tracker';
import { isMinifigSku, parseSku, MINIFIG_SKU_PREFIX } from './types';
import type { MinifigJobType } from './types';

interface PollResult {
  jobId: string;
  ordersChecked: number;
  salesDetected: number;
  removalEntriesCreated: number;
  errors: Array<{ error: string }>;
}

export class OrderPollService {
  private jobTracker: MinifigJobTracker;

  constructor(
    private supabase: SupabaseClient<Database>,
    private userId: string,
  ) {
    this.jobTracker = new MinifigJobTracker(supabase, userId);
  }

  /**
   * Poll eBay orders for sales with HB-MF- SKUs (F48).
   * Creates removal queue entries for Bricqer removal (F49).
   * Updates sync item status to SOLD_EBAY_PENDING_REMOVAL (F50).
   */
  async pollEbayOrders(): Promise<PollResult> {
    const jobType: MinifigJobType = 'EBAY_ORDER_POLL';
    const jobId = await this.jobTracker.start(jobType);
    const errors: Array<{ error: string }> = [];
    let ordersChecked = 0;
    let salesDetected = 0;
    let removalEntriesCreated = 0;

    try {
      // Get last poll cursor (E11)
      const lastCursor = await this.jobTracker.getLatestCursor(jobType);

      // Get eBay access token
      const accessToken = await ebayAuthService.getAccessToken(this.userId);
      if (!accessToken) {
        throw new Error('eBay credentials not configured or token expired');
      }

      const adapter = new EbayApiAdapter({
        accessToken,
        marketplaceId: 'EBAY_GB',
        userId: this.userId,
      });

      // Build date filter from last cursor
      const dateFilter = lastCursor
        ? EbayApiAdapter.buildOrderDateFilter(lastCursor)
        : EbayApiAdapter.buildOrderDateFilter(
            new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          );

      // Fetch orders
      const orders = await adapter.getAllOrders({
        filter: dateFilter,
        limit: 50,
      });

      ordersChecked = orders.length;
      let latestDate = lastCursor || '';

      for (const order of orders) {
        // Track latest order date for cursor update
        const orderDate = order.creationDate || order.lastModifiedDate || '';
        if (orderDate > latestDate) {
          latestDate = orderDate;
        }

        // Check line items for HB-MF- SKUs (F48)
        const lineItems = order.lineItems || [];
        for (const item of lineItems) {
          const sku = item.sku || '';
          if (!isMinifigSku(sku)) continue;

          const bricqerItemId = parseSku(sku);
          if (!bricqerItemId) continue;

          salesDetected++;

          try {
            // Find the sync item
            const { data: syncItem } = await this.supabase
              .from('minifig_sync_items')
              .select('id, listing_status')
              .eq('bricqer_item_id', bricqerItemId)
              .eq('user_id', this.userId)
              .single();

            if (!syncItem) continue;

            // Skip if already handled
            if (
              syncItem.listing_status === 'SOLD_EBAY_PENDING_REMOVAL' ||
              syncItem.listing_status === 'SOLD_EBAY'
            ) {
              continue;
            }

            // Create removal queue entry (F49)
            const salePrice =
              item.total?.value || item.lineItemCost?.value || '0';
            const orderId = order.orderId || '';
            const orderUrl = `https://www.ebay.co.uk/sh/ord/details?orderid=${encodeURIComponent(orderId)}`;

            await this.supabase.from('minifig_removal_queue').insert({
              user_id: this.userId,
              minifig_sync_id: syncItem.id,
              sold_on: 'EBAY',
              remove_from: 'BRICQER',
              sale_price: parseFloat(salePrice),
              sale_date: order.creationDate || new Date().toISOString(),
              order_id: orderId,
              order_url: orderUrl,
              status: 'PENDING',
            });

            removalEntriesCreated++;

            // Discord notification (F60)
            const syncItemName = await this.getSyncItemName(syncItem.id);
            discordService.send('alerts', {
              title: '🔔 Minifig Sold on eBay',
              description: `**${syncItemName}** sold for £${parseFloat(salePrice).toFixed(2)} on eBay.\nRemoval from Bricqer queued for review.`,
              color: DiscordColors.GREEN,
              fields: [
                { name: 'Platform', value: 'eBay', inline: true },
                { name: 'Sale Price', value: `£${parseFloat(salePrice).toFixed(2)}`, inline: true },
                { name: 'Action', value: '[Review Removal](/minifigs/removals)', inline: false },
              ],
            }).catch(() => { /* non-blocking */ });

            // Update sync item status (F50)
            await this.supabase
              .from('minifig_sync_items')
              .update({
                listing_status: 'SOLD_EBAY_PENDING_REMOVAL',
                updated_at: new Date().toISOString(),
              })
              .eq('id', syncItem.id);
          } catch (err) {
            errors.push({
              error: `eBay order ${order.orderId}, SKU ${sku}: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        }
      }

      // Persist cursor (E11)
      if (latestDate) {
        await this.jobTracker.updateCursor(jobId, latestDate);
      }

      await this.jobTracker.complete(jobId, {
        itemsProcessed: ordersChecked,
        itemsCreated: removalEntriesCreated,
        itemsUpdated: salesDetected,
        itemsErrored: errors.length,
      });

      return { jobId, ordersChecked, salesDetected, removalEntriesCreated, errors };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push({ error: errorMsg });
      await this.jobTracker.fail(jobId, errors, {
        itemsProcessed: ordersChecked,
        itemsCreated: removalEntriesCreated,
        itemsUpdated: salesDetected,
        itemsErrored: errors.length,
      });
      throw err;
    }
  }

  /**
   * Poll Bricqer orders for sales matching published eBay items (F51).
   * Creates removal queue entries for eBay removal (F52).
   * Updates sync item status to SOLD_BRICQER_PENDING_REMOVAL (F53).
   */
  async pollBricqerOrders(): Promise<PollResult> {
    const jobType: MinifigJobType = 'BRICQER_ORDER_POLL';
    const jobId = await this.jobTracker.start(jobType);
    const errors: Array<{ error: string }> = [];
    let ordersChecked = 0;
    let salesDetected = 0;
    let removalEntriesCreated = 0;

    try {
      // Get last poll cursor (E11)
      const lastCursor = await this.jobTracker.getLatestCursor(jobType);

      // Get Bricqer credentials
      const credentialsRepo = new CredentialsRepository(this.supabase);
      const credentials =
        await credentialsRepo.getCredentials<BricqerCredentials>(
          this.userId,
          'bricqer',
        );

      if (!credentials) {
        throw new Error('Bricqer credentials not configured');
      }

      const client = new BricqerClient(credentials);

      // Fetch recent orders
      const orders = await client.getOrders({
        created_after: lastCursor || undefined,
        status: 'READY',
      });

      ordersChecked = orders.length;
      let latestDate = lastCursor || '';

      // Get all published sync items for matching
      const { data: publishedItems } = await this.supabase
        .from('minifig_sync_items')
        .select('id, bricqer_item_id, bricklink_id, listing_status, ebay_offer_id')
        .eq('user_id', this.userId)
        .eq('listing_status', 'PUBLISHED');

      for (const order of orders) {
        const orderDate = order.created || order.created_at || '';
        if (orderDate > latestDate) {
          latestDate = orderDate;
        }

        // Fetch order details to get items
        let orderItems;
        try {
          orderItems = await client.getOrderItems(order.id);
        } catch {
          continue; // Skip if we can't get items
        }

        for (const orderItem of orderItems) {
          // Match by BrickLink ID against published sync items
          const bricklinkId = orderItem.bricklink_id;
          if (!bricklinkId) continue;

          // Find matching sync item
          const matchingItem = (publishedItems ?? []).find(
            (si) => si.bricklink_id === bricklinkId,
          );
          if (!matchingItem) continue;

          salesDetected++;

          try {
            // Create removal queue entry (F52)
            const price =
              typeof orderItem.price === 'string'
                ? parseFloat(orderItem.price)
                : orderItem.price;

            await this.supabase.from('minifig_removal_queue').insert({
              user_id: this.userId,
              minifig_sync_id: matchingItem.id,
              sold_on: 'BRICQER',
              remove_from: 'EBAY',
              sale_price: price || 0,
              sale_date: order.created || order.created_at || new Date().toISOString(),
              order_id: String(order.id),
              status: 'PENDING',
            });

            removalEntriesCreated++;

            // Discord notification (F60)
            const syncItemName = await this.getSyncItemName(matchingItem.id);
            discordService.send('alerts', {
              title: '🔔 Minifig Sold on Bricqer',
              description: `**${syncItemName}** sold for £${(price || 0).toFixed(2)} on Bricqer.\nRemoval from eBay queued for review.`,
              color: DiscordColors.GREEN,
              fields: [
                { name: 'Platform', value: 'Bricqer', inline: true },
                { name: 'Sale Price', value: `£${(price || 0).toFixed(2)}`, inline: true },
                { name: 'Action', value: '[Review Removal](/minifigs/removals)', inline: false },
              ],
            }).catch(() => { /* non-blocking */ });

            // Update sync item status (F53)
            await this.supabase
              .from('minifig_sync_items')
              .update({
                listing_status: 'SOLD_BRICQER_PENDING_REMOVAL',
                updated_at: new Date().toISOString(),
              })
              .eq('id', matchingItem.id);
          } catch (err) {
            errors.push({
              error: `Bricqer order ${order.id}, item ${bricklinkId}: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        }
      }

      // Persist cursor (E11)
      if (latestDate) {
        await this.jobTracker.updateCursor(jobId, latestDate);
      }

      await this.jobTracker.complete(jobId, {
        itemsProcessed: ordersChecked,
        itemsCreated: removalEntriesCreated,
        itemsUpdated: salesDetected,
        itemsErrored: errors.length,
      });

      return { jobId, ordersChecked, salesDetected, removalEntriesCreated, errors };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push({ error: errorMsg });
      await this.jobTracker.fail(jobId, errors, {
        itemsProcessed: ordersChecked,
        itemsCreated: removalEntriesCreated,
        itemsUpdated: salesDetected,
        itemsErrored: errors.length,
      });
      throw err;
    }
  }

  private async getSyncItemName(syncItemId: string): Promise<string> {
    const { data } = await this.supabase
      .from('minifig_sync_items')
      .select('name, bricklink_id')
      .eq('id', syncItemId)
      .single();
    return data?.name || data?.bricklink_id || 'Unknown Minifig';
  }
}
