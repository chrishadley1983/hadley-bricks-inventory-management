/**
 * Listing Actions Service (F42-F46)
 *
 * Handles publish, reject, and edit actions for staged listings.
 * Enforces quality checks before publishing (F45).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { EbayApiAdapter } from '@/lib/ebay/ebay-api.adapter';
import { ebayAuthService } from '@/lib/ebay/ebay-auth.service';
import type { MinifigSyncItem } from './types';

interface QualityCheckResult {
  passed: boolean;
  reasons: string[];
}

export class ListingActionsService {
  constructor(
    private supabase: SupabaseClient<Database>,
    private userId: string,
  ) {}

  /**
   * Publish a staged listing to eBay (F42).
   * Enforces quality check before publishing (F45).
   */
  async publish(itemId: string, sharedAdapter?: EbayApiAdapter): Promise<{ listingId: string; listingUrl: string }> {
    const item = await this.getItem(itemId);

    if (item.listing_status !== 'STAGED') {
      throw new Error(`Cannot publish: item is ${item.listing_status}, not STAGED`);
    }

    // Quality check (F45)
    const qualityCheck = this.checkQuality(item);
    if (!qualityCheck.passed) {
      throw new Error(`Quality check failed: ${qualityCheck.reasons.join('; ')}`);
    }

    if (!item.ebay_offer_id) {
      throw new Error('Cannot publish: no eBay offer ID');
    }

    const adapter = sharedAdapter ?? await this.getEbayAdapter();

    // Publish the offer (F42) — this is the ONLY place publish is called (I2)
    const publishResult = await adapter.publishOffer(item.ebay_offer_id);

    const listingId = publishResult.listingId;
    const listingUrl = `https://www.ebay.co.uk/itm/${listingId}`;

    // Update sync item (F42)
    await this.supabase
      .from('minifig_sync_items')
      .update({
        listing_status: 'PUBLISHED',
        ebay_listing_id: listingId,
        ebay_listing_url: listingUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', itemId)
      .eq('user_id', this.userId);

    return { listingId, listingUrl };
  }

  /**
   * Bulk publish all staged listings that pass quality (F44).
   */
  async bulkPublish(): Promise<{
    published: number;
    skipped: number;
    errors: Array<{ itemId: string; error: string }>;
  }> {
    const { data: stagedItems } = await this.supabase
      .from('minifig_sync_items')
      .select('*')
      .eq('user_id', this.userId)
      .eq('listing_status', 'STAGED');

    let published = 0;
    let skipped = 0;
    const errors: Array<{ itemId: string; error: string }> = [];

    // Share a single eBay adapter across all publish calls (M3)
    const adapter = await this.getEbayAdapter();

    for (const item of (stagedItems ?? []) as MinifigSyncItem[]) {
      const qualityCheck = this.checkQuality(item);
      if (!qualityCheck.passed) {
        skipped++;
        continue;
      }

      try {
        await this.publish(item.id, adapter);
        published++;
      } catch (err) {
        errors.push({
          itemId: item.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { published, skipped, errors };
  }

  /**
   * Reject/dismiss a staged listing (F43).
   * Deletes eBay inventory item and offer, resets to NOT_LISTED.
   */
  async reject(itemId: string): Promise<void> {
    const item = await this.getItem(itemId);

    if (item.listing_status !== 'STAGED') {
      throw new Error(`Cannot reject: item is ${item.listing_status}, not STAGED`);
    }

    const adapter = await this.getEbayAdapter();

    // Delete eBay offer and inventory item (F43)
    if (item.ebay_offer_id) {
      try {
        await adapter.withdrawOffer(item.ebay_offer_id);
      } catch {
        // Offer might not exist yet — continue
      }
    }

    if (item.ebay_sku) {
      try {
        await adapter.deleteInventoryItem(item.ebay_sku);
      } catch {
        // Item might not exist — continue
      }
    }

    // Reset to NOT_LISTED (F43)
    await this.supabase
      .from('minifig_sync_items')
      .update({
        listing_status: 'NOT_LISTED',
        ebay_sku: null,
        ebay_offer_id: null,
        ebay_listing_id: null,
        ebay_listing_url: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', itemId)
      .eq('user_id', this.userId);
  }

  /**
   * Update editable fields on a sync item and sync to eBay (F46).
   */
  async updateItem(
    itemId: string,
    updates: { title?: string; description?: string; price?: number },
  ): Promise<void> {
    const item = await this.getItem(itemId);

    const dbUpdates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (updates.title !== undefined) {
      dbUpdates.name = updates.title;
      dbUpdates.ebay_title = updates.title;
    }
    if (updates.description !== undefined) {
      dbUpdates.ebay_description = updates.description;
    }
    if (updates.price !== undefined) {
      dbUpdates.recommended_price = updates.price;
    }

    // Update DB
    await this.supabase
      .from('minifig_sync_items')
      .update(dbUpdates as Database['public']['Tables']['minifig_sync_items']['Update'])
      .eq('id', itemId)
      .eq('user_id', this.userId);

    // If item has an eBay offer, update it too (F46)
    if (item.ebay_offer_id && item.ebay_sku) {
      const adapter = await this.getEbayAdapter();

      // Update inventory item if title changed
      if (updates.title || updates.description) {
        try {
          const currentItem = await adapter.getInventoryItem(item.ebay_sku);
          if (updates.title) {
            currentItem.product.title = updates.title;
          }
          if (updates.description) {
            currentItem.product.description = updates.description;
          }
          await adapter.createOrReplaceInventoryItem(item.ebay_sku, currentItem);
        } catch {
          // Best effort — don't fail the whole operation
        }
      }

      // Update offer if price changed
      if (updates.price !== undefined) {
        try {
          await adapter.updateOffer(item.ebay_offer_id, {
            pricingSummary: {
              price: {
                value: updates.price.toFixed(2),
                currency: 'GBP',
              },
            },
          });
        } catch {
          // Best effort
        }
      }
    }
  }

  /**
   * Quality check before publishing (F45).
   */
  checkQuality(item: MinifigSyncItem): QualityCheckResult {
    const reasons: string[] = [];
    const images = item.images as Array<unknown> | null;

    if (!images || images.length < 2) {
      reasons.push('At least 2 images required');
    }

    if (!item.recommended_price || Number(item.recommended_price) <= 0) {
      reasons.push('Price must be greater than £0');
    }

    if (!item.name || item.name.length < 3) {
      reasons.push('Title is required');
    }

    if (!item.ebay_sku) {
      reasons.push('eBay SKU is required');
    }

    if (!item.ebay_offer_id) {
      reasons.push('eBay offer ID is required');
    }

    return { passed: reasons.length === 0, reasons };
  }

  private async getItem(itemId: string): Promise<MinifigSyncItem> {
    const { data, error } = await this.supabase
      .from('minifig_sync_items')
      .select('*')
      .eq('id', itemId)
      .eq('user_id', this.userId)
      .single();

    if (error || !data) {
      throw new Error('Item not found');
    }

    return data as MinifigSyncItem;
  }

  private async getEbayAdapter(): Promise<EbayApiAdapter> {
    const accessToken = await ebayAuthService.getAccessToken(this.userId);
    if (!accessToken) {
      throw new Error('eBay credentials not configured or token expired');
    }

    return new EbayApiAdapter({
      accessToken,
      marketplaceId: 'EBAY_GB',
      userId: this.userId,
    });
  }
}
