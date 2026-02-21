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

      // Ensure merchant location exists (required for publishing offers)
      await onProgress?.({
        type: 'stage',
        stage: 'policies',
        message: 'Checking merchant location...',
      });
      const merchantLocationKey = await this.getOrCreateMerchantLocation(ebayAdapter);
      console.log('[ListingStagingService] Using merchant location:', merchantLocationKey);

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
      // Use the smart defaults from identifyDefaults() which prefers returnsAccepted policies
      const defaultFulfillment = policies.fulfillment.find((p) => p.id === policies.defaults.fulfillmentPolicyId) || policies.fulfillment[0];
      const defaultPayment = policies.payment.find((p) => p.id === policies.defaults.paymentPolicyId) || policies.payment[0];
      const defaultReturn = policies.return.find((p) => p.id === policies.defaults.returnPolicyId) || policies.return[0];

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
            merchantLocationKey,
          });
          itemsStaged++;
        } catch (err) {
          // E6: Log error, keep status NOT_LISTED, continue batch
          itemsErrored++;
          // Extract detailed eBay error message including parameters
          let errorDetail = err instanceof Error ? err.message : String(err);
          if (err && typeof err === 'object' && 'errors' in err) {
            const ebayErrors = (err as { errors?: Array<{ message?: string; longMessage?: string; errorId?: number; parameters?: Array<{ name: string; value: string }> }> }).errors;
            if (ebayErrors && ebayErrors.length > 0) {
              const parts = ebayErrors.map((e) => {
                let msg = e.longMessage || e.message || '';
                if (e.parameters?.length) {
                  msg += ' [' + e.parameters.map((p) => `${p.name}=${p.value}`).join(', ') + ']';
                }
                return msg;
              });
              errorDetail = parts.join(' | ');
            }
          }
          errors.push({
            item: item.bricklink_id || item.id,
            error: errorDetail,
          });
        }
      }

      await this.jobTracker.complete(
        jobId,
        {
          itemsProcessed,
          itemsCreated: itemsStaged,
          itemsUpdated: itemsSkipped,
          itemsErrored,
        },
        errors.length > 0 ? errors : undefined
      );

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
      merchantLocationKey: string;
    }
  ): Promise<void> {
    const sku = buildSku(item.bricqer_item_id, item.storage_location); // I1: HB-MF-{bricqer_item_id}-{storage}
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
          notes: 'This is an INDIVIDUAL MINIFIGURE listing, NOT a set. Keep the description very short and lean — max 80 words. Do NOT include "What\'s Included" lists, "Perfect For" sections, or "Authenticity Guaranteed" sections. Just state what it is, its condition briefly ("Used, complete - in excellent condition"), and one short paragraph of appeal. Use category 19003 (not 183447). Use condition USED_EXCELLENT (3000).',
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

    // eBay Inventory API requires specific sub-conditions (USED is not valid)
    const conditionEnum = generated.conditionId === 1000 ? 'NEW' : 'USED_EXCELLENT';

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
      merchantLocationKey: policyIds.merchantLocationKey,
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

    // Create or update offer — proactively check for existing offers by SKU
    const offerId = await this.createOrUpdateOffer(ebayAdapter, offer, sku, item.ebay_offer_id);

    // Update sync item to STAGED (F39) — NO publish call (I2)
    await this.supabase
      .from('minifig_sync_items')
      .update({
        listing_status: 'STAGED',
        ebay_sku: sku,
        ebay_offer_id: offerId,
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
   * Create or update an eBay offer for a SKU.
   * Proactively checks for existing offers by SKU to avoid "offer already exists" errors.
   */
  private async createOrUpdateOffer(
    ebayAdapter: EbayApiAdapter,
    offer: EbayOfferRequest,
    sku: string,
    knownOfferId?: string | null
  ): Promise<string> {
    // 1. If we already know the offer ID (from a previous staging), try updating it
    if (knownOfferId) {
      try {
        console.log(`[ListingStagingService] Updating known offer ${knownOfferId} for SKU ${sku}`);
        await ebayAdapter.updateOffer(knownOfferId, offer);
        return knownOfferId;
      } catch (err) {
        console.warn(`[ListingStagingService] Failed to update known offer ${knownOfferId}:`, err instanceof Error ? err.message : err);
        // Offer might have been deleted on eBay — fall through to create/query
      }
    }

    // 2. Query eBay for existing offers for this SKU
    const existingOffers = await ebayAdapter.getOffersBySku(sku);
    if (existingOffers.length > 0) {
      const existingId = existingOffers[0].offerId;
      console.log(`[ListingStagingService] Found existing offer ${existingId} for SKU ${sku}, updating`);
      await ebayAdapter.updateOffer(existingId, offer);
      return existingId;
    }

    // 3. No existing offer — create a new one
    console.log(`[ListingStagingService] Creating new offer for SKU ${sku}`);
    const response = await ebayAdapter.createOffer(offer);
    return response.offerId;
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
   * Source up to 3 images: BrickLink catalogue + 2 Brave photos (front + back).
   * Serverless-compatible (HTTP APIs only, no Playwright).
   */
  private async sourceImagesServerless(
    bricklinkId: string,
    name?: string | null,
    _bricqerImageUrl?: string | null
  ): Promise<SourcedImage[]> {
    const images: SourcedImage[] = [];

    // 1. BrickLink catalogue image (always first — reliable, consistent)
    images.push({
      url: `https://img.bricklink.com/ItemImage/MN/0/${bricklinkId}.png`,
      source: 'bricklink',
      type: 'stock',
    });

    // 2. Brave Image Search — 2 queries (front + back) for 2 diverse photos
    const braveApiKey = process.env.BRAVE_API_KEY;
    if (braveApiKey) {
      const usedUrls = new Set<string>();
      const braveQueries = [
        `LEGO ${name || ''} ${bricklinkId} minifigure front`,
        `LEGO ${name || ''} ${bricklinkId} minifigure back`,
      ];

      for (const query of braveQueries) {
        try {
          const url = `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=10&safesearch=off`;
          const response = await fetch(url, {
            headers: { 'X-Subscription-Token': braveApiKey },
          });

          if (response.ok) {
            const data = await response.json();
            const results = data.results ?? [];

            for (const result of results) {
              const imageUrl = result.properties?.url || result.thumbnail?.src;
              if (!imageUrl) continue;
              // Skip eBay and BrickLink (we already have the BrickLink catalogue image)
              if (/ebay|bricklink/i.test(imageUrl)) continue;
              // Skip exact same URL already used by the other query
              if (usedUrls.has(imageUrl)) continue;
              // Skip tiny thumbnails
              const w = result.properties?.width ?? result.thumbnail?.width ?? 0;
              if (w > 0 && w < 200) continue;
              // Validate URL
              try {
                new URL(imageUrl);
              } catch {
                continue;
              }

              images.push({ url: imageUrl, source: 'brave', type: 'sourced' });
              usedUrls.add(imageUrl);
              break; // One image per query
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

    return images;
  }

  /**
   * Get or create a default merchant location (required by eBay for publishing offers).
   * Mirrors ListingCreationService.getOrCreateMerchantLocation().
   */
  private async getOrCreateMerchantLocation(adapter: EbayApiAdapter): Promise<string> {
    const DEFAULT_LOCATION_KEY = 'HADLEY_BRICKS_DEFAULT';

    try {
      const locationsResponse = await adapter.getInventoryLocations();
      const locations = locationsResponse.locations || [];

      if (locations.length > 0) {
        console.log(
          '[ListingStagingService] Using existing location:',
          locations[0].merchantLocationKey
        );
        return locations[0].merchantLocationKey;
      }
    } catch {
      console.log('[ListingStagingService] No existing locations found, creating default');
    }

    try {
      await adapter.createInventoryLocation(DEFAULT_LOCATION_KEY, {
        location: {
          address: {
            city: 'London',
            postalCode: 'EC1A 1BB',
            country: 'GB',
          },
        },
        locationTypes: ['WAREHOUSE'],
        name: 'Hadley Bricks Default Location',
        merchantLocationStatus: 'ENABLED',
      });
      console.log('[ListingStagingService] Created default location:', DEFAULT_LOCATION_KEY);
      return DEFAULT_LOCATION_KEY;
    } catch (createError) {
      console.log(
        '[ListingStagingService] Error creating location, may already exist:',
        createError
      );
      return DEFAULT_LOCATION_KEY;
    }
  }
}
