/**
 * Listing Staging Service (F36-F39, E6, I1, I2)
 *
 * Creates eBay inventory items and unpublished offers for qualifying minifigs.
 * NEVER publishes offers — publish only occurs through the review queue (I2).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { EbayApiAdapter } from '@/lib/ebay/ebay-api.adapter';
import { ebayAuthService } from '@/lib/ebay/ebay-auth.service';
import { EbayBusinessPoliciesService } from '@/lib/ebay/ebay-business-policies.service';
import type { EbayInventoryItem, EbayOfferRequest } from '@/lib/ebay/types';
import { MinifigConfigService } from './config.service';
import { MinifigJobTracker } from './job-tracker';
import { ImageSourcer } from './image-sourcer';
import { generateDescription } from './description-generator';
import { buildSku } from './types';
import type { MinifigSyncItem } from './types';

const EBAY_MINIFIG_CATEGORY_ID = '19003'; // eBay category for LEGO Minifigures

interface StagingResult {
  jobId: string;
  itemsProcessed: number;
  itemsStaged: number;
  itemsSkipped: number;
  itemsErrored: number;
  errors: Array<{ item?: string; error: string }>;
}

export class ListingStagingService {
  private configService: MinifigConfigService;
  private jobTracker: MinifigJobTracker;

  constructor(
    private supabase: SupabaseClient<Database>,
    private userId: string,
  ) {
    this.configService = new MinifigConfigService(supabase);
    this.jobTracker = new MinifigJobTracker(supabase, userId);
  }

  /**
   * Create staged eBay listings for qualifying minifigs (F36).
   * Only processes items with meets_threshold=true AND listing_status='NOT_LISTED'.
   */
  async createStagedListings(itemIds?: string[]): Promise<StagingResult> {
    const jobId = await this.jobTracker.start('LISTING_CREATION');
    const errors: Array<{ item?: string; error: string }> = [];
    let itemsProcessed = 0;
    let itemsStaged = 0;
    let itemsSkipped = 0;
    let itemsErrored = 0;

    try {
      // Get eBay access token
      const accessToken = await ebayAuthService.getAccessToken(this.userId);
      if (!accessToken) {
        throw new Error('eBay credentials not configured or token expired');
      }

      const ebayAdapter = new EbayApiAdapter({
        accessToken,
        marketplaceId: 'EBAY_GB',
        userId: this.userId,
      });

      // Get business policies
      const policiesService = new EbayBusinessPoliciesService(
        this.supabase,
        this.userId,
      );
      const policies = await policiesService.getPolicies();
      const defaultFulfillment = policies.fulfillment[0];
      const defaultPayment = policies.payment[0];
      const defaultReturn = policies.return[0];

      if (!defaultFulfillment || !defaultPayment || !defaultReturn) {
        throw new Error(
          'eBay business policies not configured (need fulfillment, payment, and return policies)',
        );
      }

      // Get Rebrickable API key for description generation
      const rebrickableApiKey = process.env.REBRICKABLE_API_KEY ?? '';

      // Query qualifying items (F36)
      let query = this.supabase
        .from('minifig_sync_items')
        .select('*')
        .eq('user_id', this.userId)
        .eq('meets_threshold', true)
        .eq('listing_status', 'NOT_LISTED')
        .not('bricklink_id', 'is', null)
        .not('recommended_price', 'is', null);

      if (itemIds?.length) {
        query = query.in('id', itemIds);
      }

      const { data: items } = await query;

      for (const item of (items ?? []) as MinifigSyncItem[]) {
        itemsProcessed++;

        if (!item.bricklink_id || item.recommended_price == null) {
          itemsSkipped++;
          continue;
        }

        try {
          await this.stageItem(
            item,
            ebayAdapter,
            {
              fulfillmentPolicyId: defaultFulfillment.id,
              paymentPolicyId: defaultPayment.id,
              returnPolicyId: defaultReturn.id,
            },
            rebrickableApiKey,
          );
          itemsStaged++;
        } catch (err) {
          // E6: Log error, keep status NOT_LISTED, continue batch
          itemsErrored++;
          errors.push({
            item: item.bricklink_id || item.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      await this.jobTracker.complete(jobId, {
        itemsProcessed,
        itemsCreated: itemsStaged,
        itemsUpdated: itemsSkipped,
        itemsErrored,
      });

      return {
        jobId,
        itemsProcessed,
        itemsStaged,
        itemsSkipped,
        itemsErrored,
        errors,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push({ error: errorMsg });
      await this.jobTracker.fail(jobId, errors, {
        itemsProcessed,
        itemsCreated: itemsStaged,
        itemsUpdated: itemsSkipped,
        itemsErrored,
      });
      throw err;
    }
  }

  /**
   * Stage a single minifig: create inventory item + offer (no publish).
   */
  private async stageItem(
    item: MinifigSyncItem,
    ebayAdapter: EbayApiAdapter,
    policyIds: {
      fulfillmentPolicyId: string;
      paymentPolicyId: string;
      returnPolicyId: string;
    },
    rebrickableApiKey: string,
  ): Promise<void> {
    const sku = buildSku(item.bricqer_item_id); // I1: HB-MF-{bricqer_item_id}
    const price = Number(item.recommended_price);
    const autoAccept = Number(item.best_offer_auto_accept) || Math.round(price * 0.95 * 100) / 100;
    const autoDecline = Number(item.best_offer_auto_decline) || Math.round(price * 0.75 * 100) / 100;

    // Generate description (F34, E7 fallback)
    const description = await generateDescription({
      name: item.name || item.bricklink_id || 'LEGO Minifigure',
      bricklinkId: item.bricklink_id!,
      conditionNotes: item.condition_notes,
      rebrickableApiKey,
    });

    // Get image URLs from stored images
    const imageUrls = this.getImageUrls(item);

    // Create inventory item (F37)
    const inventoryItem: EbayInventoryItem = {
      product: {
        title: `LEGO ${item.name || item.bricklink_id} Minifigure - Used`,
        description,
        imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
        aspects: {
          Brand: ['LEGO'],
          Type: ['Minifigure'],
          'LEGO Set Number': item.bricklink_id
            ? [item.bricklink_id]
            : [],
        },
      },
      condition: 'USED_EXCELLENT',
      conditionDescription:
        item.condition_notes || 'Used minifigure in excellent condition',
      availability: {
        shipToLocationAvailability: {
          quantity: 1,
        },
      },
    };

    await ebayAdapter.createOrReplaceInventoryItem(sku, inventoryItem);

    // Create offer but DO NOT publish (F38, I2)
    const offer: EbayOfferRequest = {
      sku,
      marketplaceId: 'EBAY_GB',
      format: 'FIXED_PRICE',
      availableQuantity: 1,
      categoryId: EBAY_MINIFIG_CATEGORY_ID,
      listingDescription: description,
      listingPolicies: {
        fulfillmentPolicyId: policyIds.fulfillmentPolicyId,
        paymentPolicyId: policyIds.paymentPolicyId,
        returnPolicyId: policyIds.returnPolicyId,
      },
      pricingSummary: {
        price: {
          value: price.toFixed(2),
          currency: 'GBP',
        },
      },
      bestOffer: {
        bestOfferEnabled: true,
        autoAcceptPrice: {
          value: autoAccept.toFixed(2),
          currency: 'GBP',
        },
        autoDeclinePrice: {
          value: autoDecline.toFixed(2),
          currency: 'GBP',
        },
      },
    };

    const createOfferResponse = await ebayAdapter.createOffer(offer);

    // Update sync item to STAGED (F39) — NO publish call (I2)
    const ebayTitle = `LEGO ${item.name || item.bricklink_id} Minifigure - Used`;
    await this.supabase
      .from('minifig_sync_items')
      .update({
        listing_status: 'STAGED',
        ebay_sku: sku,
        ebay_offer_id: createOfferResponse.offerId,
        ebay_title: ebayTitle,
        ebay_description: description,
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id);
  }

  /**
   * Extract image URLs from the stored images JSONB.
   */
  private getImageUrls(item: MinifigSyncItem): string[] {
    const images = item.images as Array<{ url: string }> | null;
    if (!images || !Array.isArray(images)) {
      // Fallback to bricqer image if no sourced images
      return item.bricqer_image_url ? [item.bricqer_image_url] : [];
    }
    return images.map((img) => img.url);
  }
}
