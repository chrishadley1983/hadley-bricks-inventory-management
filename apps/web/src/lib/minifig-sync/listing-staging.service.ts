/**
 * Listing Staging Service (F36-F39, E6, I1, I2)
 *
 * Creates eBay inventory items and unpublished offers for qualifying minifigs.
 * NEVER publishes offers — publish only occurs through the review queue (I2).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { EbayApiAdapter } from '@/lib/ebay/ebay-api.adapter';
import { ebayAuthService, EbayAuthService } from '@/lib/ebay/ebay-auth.service';
import { EbayBusinessPoliciesService } from '@/lib/ebay/ebay-business-policies.service';
import type { EbayInventoryItem, EbayOfferRequest } from '@/lib/ebay/types';
import { ListingGenerationService } from '@/lib/ebay/listing-generation.service';
import type { AIGeneratedListing } from '@/lib/ebay/listing-creation.types';
import { RebrickableApiClient } from '@/lib/rebrickable';
import { MinifigConfigService } from './config.service';
import { MinifigJobTracker } from './job-tracker';
import { buildSku } from './types';
import type { MinifigSyncItem, SourcedImage } from './types';
import type { SyncProgressCallback } from '@/types/minifig-sync-stream';

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
  private ebayAuth: EbayAuthService;

  constructor(
    private supabase: SupabaseClient<Database>,
    private userId: string,
    ebayAuth?: EbayAuthService
  ) {
    this.configService = new MinifigConfigService(supabase);
    this.jobTracker = new MinifigJobTracker(supabase, userId);
    this.ebayAuth = ebayAuth ?? ebayAuthService;
  }

  /**
   * Create staged eBay listings for qualifying minifigs (F36).
   * Only processes items with meets_threshold=true AND listing_status='NOT_LISTED'.
   */
  async createStagedListings(
    itemIds?: string[],
    options?: { onProgress?: SyncProgressCallback; limit?: number }
  ): Promise<StagingResult> {
    const onProgress = options?.onProgress;
    const jobId = await this.jobTracker.start('LISTING_CREATION');
    const errors: Array<{ item?: string; error: string }> = [];
    let itemsProcessed = 0;
    let itemsStaged = 0;
    let itemsSkipped = 0;
    let itemsErrored = 0;

    try {
      // Get eBay access token
      await onProgress?.({
        type: 'stage',
        stage: 'credentials',
        message: 'Checking eBay credentials...',
      });
      const accessToken = await this.ebayAuth.getAccessToken(this.userId);
      if (!accessToken) {
        throw new Error('eBay credentials not configured or token expired');
      }

      const ebayAdapter = new EbayApiAdapter({
        accessToken,
        marketplaceId: 'EBAY_GB',
        userId: this.userId,
      });

      // Get business policies
      await onProgress?.({
        type: 'stage',
        stage: 'policies',
        message: 'Loading business policies...',
      });
      const policiesService = new EbayBusinessPoliciesService(
        this.supabase,
        this.userId,
        this.ebayAuth
      );
      const policies = await policiesService.getPolicies();
      const defaultFulfillment = policies.fulfillment[0];
      const defaultPayment = policies.payment[0];
      const defaultReturn = policies.return[0];

      if (!defaultFulfillment || !defaultPayment || !defaultReturn) {
        throw new Error(
          'eBay business policies not configured (need fulfillment, payment, and return policies)'
        );
      }

      // Query qualifying items (F36) — paginated (M1)
      await onProgress?.({ type: 'stage', stage: 'fetch', message: 'Loading qualifying items...' });
      const items: Array<Database['public']['Tables']['minifig_sync_items']['Row']> = [];
      const pageSize = 1000;
      let page = 0;
      let hasMore = true;
      while (hasMore) {
        let query = this.supabase
          .from('minifig_sync_items')
          .select('*')
          .eq('user_id', this.userId)
          .eq('meets_threshold', true)
          .eq('listing_status', 'NOT_LISTED')
          .not('bricklink_id', 'is', null)
          .not('recommended_price', 'is', null)
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (itemIds?.length) {
          query = query.in('id', itemIds);
        }

        const { data } = await query;
        items.push(...(data ?? []));
        hasMore = (data?.length ?? 0) === pageSize;
        page++;
      }

      // Apply limit if specified
      const itemsToProcess = options?.limit ? items.slice(0, options.limit) : items;

      await onProgress?.({ type: 'stage', stage: 'staging', message: `Creating eBay listings (${itemsToProcess.length} of ${items.length} qualifying)...` });
      for (let i = 0; i < itemsToProcess.length; i++) {
        const item = itemsToProcess[i] as MinifigSyncItem;
        itemsProcessed++;

        await onProgress?.({
          type: 'progress',
          current: i + 1,
          total: itemsToProcess.length,
          message: item.bricklink_id || item.name || `Item ${i + 1}`,
        });

        if (!item.bricklink_id || item.recommended_price == null) {
          itemsSkipped++;
          continue;
        }

        try {
          await this.stageItem(item, ebayAdapter, {
            fulfillmentPolicyId: defaultFulfillment.id,
            paymentPolicyId: defaultPayment.id,
            returnPolicyId: defaultReturn.id,
          });
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
    }
  ): Promise<void> {
    const sku = buildSku(item.bricqer_item_id); // I1: HB-MF-{bricqer_item_id}
    const price = Number(item.recommended_price);
    const autoAccept = Number(item.best_offer_auto_accept) || Math.round(price * 0.95 * 100) / 100;
    const autoDecline =
      Number(item.best_offer_auto_decline) || Math.round(price * 0.75 * 100) / 100;

    // Generate AI-optimized listing content via Claude
    const genService = new ListingGenerationService();
    let generated: Awaited<ReturnType<ListingGenerationService['generateListing']>>;
    try {
      generated = await genService.generateListing(
        {
          setNumber: item.bricklink_id!,
          setName: item.name || undefined,
          condition: 'Used',
          conditionNotes: item.condition_notes || undefined,
          pieceCount: 1,
          minifigureCount: 1,
          notes: 'This is an INDIVIDUAL MINIFIGURE listing, NOT a set. Keep the description very short and lean — max 80 words. Do NOT include "What\'s Included" lists, "Perfect For" sections, or "Authenticity Guaranteed" sections. Just state what it is, its condition briefly ("Used, complete - in excellent condition"), and one short paragraph of appeal. Use category 19003 (not 183447). Condition must be USED (3000) not USED_EXCELLENT.',
        },
        { style: 'Minimalist', price }
      );
    } catch (err) {
      console.warn(
        `[ListingStagingService] AI generation failed for ${item.bricklink_id}, skipping:`,
        err instanceof Error ? err.message : err
      );
      throw err;
    }

    // Source images if none exist yet
    const existingImages = (item.images as SourcedImage[] | null) ?? [];
    if (existingImages.length === 0 && item.bricklink_id) {
      const sourced = await this.sourceImagesServerless(
        item.bricklink_id,
        item.name,
        item.bricqer_image_url
      );
      if (sourced.length > 0) {
        await this.supabase
          .from('minifig_sync_items')
          .update({ images: sourced as unknown as Database['public']['Tables']['minifig_sync_items']['Update']['images'] })
          .eq('id', item.id);
        // Update local reference for getImageUrls below
        (item as Record<string, unknown>).images = sourced;
      }
    }

    // Get image URLs from stored images
    const imageUrls = this.getImageUrls(item);

    // Map AI-generated item specifics to eBay aspects format
    const aspects = this.mapItemSpecificsToAspects(generated.itemSpecifics);

    // Minifig category (19003) only allows NEW or USED on eBay
    const conditionEnum: 'NEW' | 'USED' =
      generated.conditionId === 1000 ? 'NEW' : 'USED';

    // Create inventory item (F37)
    const inventoryItem: EbayInventoryItem = {
      product: {
        title: generated.title,
        description: generated.description,
        imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
        aspects,
      },
      condition: conditionEnum,
      conditionDescription:
        generated.conditionDescription ||
        item.condition_notes ||
        'Used, complete - in excellent condition',
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
      categoryId: generated.categoryId || EBAY_MINIFIG_CATEGORY_ID,
      listingDescription: generated.description,
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
    await this.supabase
      .from('minifig_sync_items')
      .update({
        listing_status: 'STAGED',
        ebay_sku: sku,
        ebay_offer_id: createOfferResponse.offerId,
        ebay_title: generated.title,
        ebay_description: generated.description,
        ebay_condition: conditionEnum,
        ebay_condition_description:
          generated.conditionDescription ||
          item.condition_notes ||
          'Used, complete - in excellent condition',
        ebay_category_id: generated.categoryId || EBAY_MINIFIG_CATEGORY_ID,
        ebay_aspects: aspects,
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id)
      .eq('user_id', this.userId);
  }

  /**
   * Map AI-generated item specifics to eBay aspects format.
   * Truncates values exceeding eBay's 65-character limit.
   * Adds Country/Region of Manufacture for LEGO items.
   */
  private mapItemSpecificsToAspects(
    specifics: AIGeneratedListing['itemSpecifics']
  ): Record<string, string[]> {
    const aspects: Record<string, string[]> = {};

    for (const [key, value] of Object.entries(specifics)) {
      if (value !== undefined && value !== null && value !== '') {
        const truncated = value.length > 65 ? value.substring(0, 62) + '...' : value;
        aspects[key] = [truncated];
      }
    }

    if (specifics.Brand?.toUpperCase() === 'LEGO') {
      aspects['Country/Region of Manufacture'] = ['Denmark'];
    }

    return aspects;
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

  /**
   * Source up to 4 images from Brave Search, BrickLink, Rebrickable, and Bricqer.
   * Serverless-compatible (HTTP APIs only, no Playwright).
   */
  private async sourceImagesServerless(
    bricklinkId: string,
    name?: string | null,
    bricqerImageUrl?: string | null
  ): Promise<SourcedImage[]> {
    const images: SourcedImage[] = [];
    const MAX_IMAGES = 4;
    const MAX_BRAVE_IMAGES = 3;

    // 1. Brave Image Search — three queries for front, back, and alternate views
    const braveApiKey = process.env.BRAVE_API_KEY;
    if (braveApiKey && images.length < MAX_IMAGES) {
      const usedDomains = new Set<string>();
      const braveQueries = [
        `LEGO ${name || ''} ${bricklinkId} minifigure front -site:ebay.com -site:ebay.co.uk`,
        `LEGO ${name || ''} ${bricklinkId} minifigure back -site:ebay.com -site:ebay.co.uk`,
        `LEGO ${bricklinkId} minifig -site:ebay.com -site:ebay.co.uk`,
      ];

      for (const query of braveQueries) {
        if (images.length >= MAX_BRAVE_IMAGES) break;
        try {
          const url = `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=10&safesearch=off`;
          const response = await fetch(url, {
            headers: { 'X-Subscription-Token': braveApiKey },
          });

          if (response.ok) {
            const data = await response.json();
            const results = data.results ?? [];

            for (const result of results) {
              if (images.length >= MAX_BRAVE_IMAGES) break;
              const imageUrl = result.properties?.url || result.thumbnail?.src;
              if (!imageUrl) continue;
              // Skip eBay, BrickLink, and Rebrickable URLs (catalogue dupes)
              if (/ebay|bricklink|rebrickable/i.test(imageUrl)) continue;
              // Skip tiny thumbnails
              const w = result.properties?.width ?? result.thumbnail?.width ?? 0;
              if (w > 0 && w < 200) continue;
              // Skip duplicate domains to ensure visual diversity
              try {
                const domain = new URL(imageUrl).hostname;
                if (usedDomains.has(domain)) continue;
                usedDomains.add(domain);
              } catch {
                // Invalid URL — skip
                continue;
              }

              images.push({ url: imageUrl, source: 'brave', type: 'sourced' });
              break; // One image per query for front/back diversity
            }
          }
        } catch (err) {
          console.warn(
            `[ListingStagingService] Brave image search failed for ${bricklinkId}:`,
            err instanceof Error ? err.message : err
          );
        }
      }
    }

    // 2. BrickLink catalogue image (static URL, always available)
    const hasBrickLink = images.length < MAX_IMAGES;
    if (hasBrickLink) {
      images.push({
        url: `https://img.bricklink.com/ItemImage/MN/0/${bricklinkId}.png`,
        source: 'bricklink',
        type: 'stock',
      });
    }

    // 3. Rebrickable catalogue image — skip if BrickLink already added
    //    (both render the same front-view catalogue image)
    if (!hasBrickLink && images.length < MAX_IMAGES) {
      const rebrickableApiKey = process.env.REBRICKABLE_API_KEY;
      if (rebrickableApiKey) {
        try {
          const client = new RebrickableApiClient(rebrickableApiKey);
          const minifig = await client.getMinifig(bricklinkId);
          if (minifig.set_img_url) {
            images.push({
              url: minifig.set_img_url,
              source: 'rebrickable',
              type: 'stock',
            });
          }
        } catch {
          // Rebrickable lookup failed — continue without
        }
      }
    }

    // 4. Bricqer stored image
    if (images.length < MAX_IMAGES && bricqerImageUrl) {
      images.push({
        url: bricqerImageUrl,
        source: 'bricqer',
        type: 'original',
      });
    }

    return images.slice(0, MAX_IMAGES);
  }
}
