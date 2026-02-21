/**
 * Negotiation Service
 *
 * Main orchestration service for the eBay negotiation automation engine.
 * Coordinates between the API client, scoring service, and database.
 */

import { createClient } from '@/lib/supabase/server';
import { EbayAuthService } from '@/lib/ebay/ebay-auth.service';
import { EbayNegotiationClient, EbayNegotiationApiError } from './ebay-negotiation.client';
import { NegotiationScoringService, MIN_DISCOUNT_PERCENTAGE } from './negotiation-scoring.service';
import { discordService } from '@/lib/notifications';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  NegotiationConfig,
  NegotiationMetrics,
  EnrichedEligibleItem,
  ProcessOffersResult,
  SendOfferResult,
  NegotiationOffer,
  ReOfferEligibility,
} from './negotiation.types';

// ============================================================================
// Constants
// ============================================================================

// Offer duration in days (used for calculating expiry)
const OFFER_DURATION_DAYS = 4;

// Maximum discount percentage allowed
const MAX_DISCOUNT_PERCENTAGE = 50;

// Default offer message template with placeholder support
const DEFAULT_OFFER_MESSAGE_TEMPLATE =
  "Thank you for your interest! We're offering you an exclusive {discount}% discount on this item. Don't miss out on this special offer!";

/**
 * Format a price with currency symbol
 */
function formatPrice(price: number, currency: string = 'GBP'): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(price);
}

/**
 * Substitute placeholders in the offer message template
 * Supported placeholders:
 * - {discount} - discount percentage (e.g., "20")
 * - {title} - listing title
 * - {price} - original price (e.g., "£19.99")
 * - {offer_price} - discounted price (e.g., "£15.99")
 */
function substituteMessagePlaceholders(
  template: string,
  data: {
    discountPercentage: number;
    title?: string;
    originalPrice?: number;
    currency?: string;
  }
): string {
  const offerPrice = data.originalPrice
    ? data.originalPrice * (1 - data.discountPercentage / 100)
    : undefined;

  let message = template
    .replace(/\{discount\}/g, String(data.discountPercentage))
    .replace(/\{title\}/g, data.title || 'this item');

  if (data.originalPrice !== undefined && offerPrice !== undefined) {
    message = message
      .replace(/\{price\}/g, formatPrice(data.originalPrice, data.currency))
      .replace(/\{offer_price\}/g, formatPrice(offerPrice, data.currency));
  } else {
    // Remove price placeholders if no price available
    message = message.replace(/\{price\}/g, '').replace(/\{offer_price\}/g, '');
  }

  return message;
}

// ============================================================================
// Service Class
// ============================================================================

export class NegotiationService {
  private ebayAuth: EbayAuthService;
  private negotiationClient: EbayNegotiationClient | null = null;
  private scoringService: NegotiationScoringService | null = null;
  private supabase: SupabaseClient | null = null;
  private userId: string | null = null;
  private injectedSupabase: SupabaseClient | null = null;

  /**
   * Create a new NegotiationService
   * @param supabase Optional Supabase client (for cron/background jobs that need service role access)
   */
  constructor(supabase?: SupabaseClient) {
    this.injectedSupabase = supabase || null;
    // Pass the Supabase client to EbayAuthService so it can access credentials in cron context
    this.ebayAuth = new EbayAuthService(undefined, supabase);
  }

  /**
   * Initialize the service for a user
   */
  async init(userId: string): Promise<boolean> {
    this.userId = userId;
    // Use injected client if available (cron context), otherwise create cookie-based client
    this.supabase = this.injectedSupabase || (await createClient());

    // Get access token
    const accessToken = await this.ebayAuth.getAccessToken(userId);
    if (!accessToken) {
      console.error('[NegotiationService] Failed to get eBay access token');
      return false;
    }

    // Initialize the API client
    this.negotiationClient = new EbayNegotiationClient({
      accessToken,
      marketplaceId: 'EBAY_GB',
    });

    // Load user config and initialize scoring service
    const config = await this.getConfig(userId);
    this.scoringService = new NegotiationScoringService({
      listingAge: config.weightListingAge,
      stockLevel: config.weightStockLevel,
      itemValue: config.weightItemValue,
      category: config.weightCategory,
      watchers: config.weightWatchers,
    });

    return true;
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  /**
   * Get the user's negotiation configuration
   */
  async getConfig(userId: string): Promise<NegotiationConfig> {
    const supabase = this.supabase || (await createClient());

    const { data, error } = await supabase
      .from('negotiation_config')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('[NegotiationService] Error fetching config:', error);
      throw error;
    }

    // Return existing config or defaults
    if (data) {
      return this.mapConfigFromDb(data);
    }

    // Create default config if it doesn't exist
    const { data: newConfig, error: insertError } = await supabase
      .from('negotiation_config')
      .insert({
        user_id: userId,
        automation_enabled: false,
        min_days_before_offer: 14,
        re_offer_cooldown_days: 7,
        re_offer_escalation_percent: 5,
        weight_listing_age: 50,
        weight_stock_level: 15,
        weight_item_value: 15,
        weight_category: 10,
        weight_watchers: 10,
      })
      .select()
      .single();

    if (insertError) {
      console.error('[NegotiationService] Error creating config:', insertError);
      throw insertError;
    }

    return this.mapConfigFromDb(newConfig);
  }

  /**
   * Update the user's negotiation configuration
   */
  async updateConfig(
    userId: string,
    updates: Partial<Omit<NegotiationConfig, 'id' | 'userId'>>
  ): Promise<NegotiationConfig> {
    const supabase = this.supabase || (await createClient());

    // Map to database column names
    const dbUpdates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (updates.automationEnabled !== undefined) {
      dbUpdates.automation_enabled = updates.automationEnabled;
    }
    if (updates.minDaysBeforeOffer !== undefined) {
      dbUpdates.min_days_before_offer = updates.minDaysBeforeOffer;
    }
    if (updates.reOfferCooldownDays !== undefined) {
      dbUpdates.re_offer_cooldown_days = updates.reOfferCooldownDays;
    }
    if (updates.reOfferEscalationPercent !== undefined) {
      dbUpdates.re_offer_escalation_percent = updates.reOfferEscalationPercent;
    }
    if (updates.weightListingAge !== undefined) {
      dbUpdates.weight_listing_age = updates.weightListingAge;
    }
    if (updates.weightStockLevel !== undefined) {
      dbUpdates.weight_stock_level = updates.weightStockLevel;
    }
    if (updates.weightItemValue !== undefined) {
      dbUpdates.weight_item_value = updates.weightItemValue;
    }
    if (updates.weightCategory !== undefined) {
      dbUpdates.weight_category = updates.weightCategory;
    }
    if (updates.weightWatchers !== undefined) {
      dbUpdates.weight_watchers = updates.weightWatchers;
    }
    if (updates.offerMessageTemplate !== undefined) {
      dbUpdates.offer_message_template = updates.offerMessageTemplate;
    }

    const { data, error } = await supabase
      .from('negotiation_config')
      .update(dbUpdates)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      console.error('[NegotiationService] Error updating config:', error);
      throw error;
    }

    return this.mapConfigFromDb(data);
  }

  // ==========================================================================
  // Eligible Items
  // ==========================================================================

  /**
   * Get all eligible listings enriched with scoring data
   */
  async getEligibleItems(userId: string): Promise<EnrichedEligibleItem[]> {
    if (!this.negotiationClient || !this.scoringService || !this.supabase) {
      const initialized = await this.init(userId);
      if (!initialized) {
        throw new Error('Failed to initialize negotiation service');
      }
    }

    const config = await this.getConfig(userId);
    const supabase = this.supabase!;

    // Debug: Track filtering stats
    const filterStats = {
      ebayReturned: 0,
      notInPlatformListings: 0,
      tooNewForOffer: 0,
      inReOfferCooldown: 0,
      passed: 0,
    };
    const filteredItems: { listingId: string; reason: string; details?: string }[] = [];

    // Fetch eligible items from eBay
    const eligibleItems = await this.negotiationClient!.findAllEligibleItems();
    filterStats.ebayReturned = eligibleItems.length;

    console.log(`[NegotiationService] eBay returned ${eligibleItems.length} eligible items`);

    if (eligibleItems.length === 0) {
      console.log('[NegotiationService] No eligible items from eBay API');
      return [];
    }

    // Get listing IDs
    const listingIds = eligibleItems.map((item) => item.listingId);

    // Fetch platform_listings data for these items
    const { data: listings, error: listingsError } = await supabase
      .from('platform_listings')
      .select(
        `
        id,
        platform_item_id,
        platform_sku,
        title,
        price,
        currency,
        quantity,
        ebay_data
      `
      )
      .eq('user_id', userId)
      .eq('platform', 'ebay')
      .in('platform_item_id', listingIds);

    if (listingsError) {
      console.error('[NegotiationService] Error fetching listings:', listingsError);
      throw listingsError;
    }

    // Get the SKUs from platform_listings to look up in ebay_sku_mappings
    const skusFromListings =
      listings
        ?.map((l) => l.platform_sku)
        .filter((sku): sku is string => sku !== null && sku !== undefined) || [];

    // Get inventory item mappings from ebay_sku_mappings (match by SKU, not item ID)
    const { data: skuMappings } = await supabase
      .from('ebay_sku_mappings')
      .select('ebay_sku, inventory_item_id')
      .eq('user_id', userId)
      .in('ebay_sku', skusFromListings);

    // Create a map of platform_sku -> inventory_item_id
    const skuToInventoryMap: Record<string, string> = {};
    if (skuMappings) {
      for (const mapping of skuMappings) {
        skuToInventoryMap[mapping.ebay_sku] = mapping.inventory_item_id;
      }
    }

    // Create a map of platform_item_id -> inventory_item_id (via SKU)
    const listingToInventoryMap: Record<string, string> = {};
    if (listings) {
      for (const listing of listings) {
        if (listing.platform_sku && skuToInventoryMap[listing.platform_sku]) {
          listingToInventoryMap[listing.platform_item_id] = skuToInventoryMap[listing.platform_sku];
        }
      }
    }

    // Get inventory items for cost and listing date
    const inventoryItemIds = Object.values(listingToInventoryMap);

    let inventoryItems: Record<string, { cost: number; listingDate: Date }> = {};

    // Get previous offer counts per listing (to show how many buyers were reached)
    const { data: offerCounts } = await supabase
      .from('negotiation_offers')
      .select('ebay_listing_id')
      .eq('user_id', userId)
      .in('ebay_listing_id', listingIds);

    // Count offers per listing
    const offerCountMap: Record<string, number> = {};
    if (offerCounts) {
      for (const offer of offerCounts) {
        offerCountMap[offer.ebay_listing_id] = (offerCountMap[offer.ebay_listing_id] || 0) + 1;
      }
    }

    if (inventoryItemIds.length > 0) {
      const { data: invData } = await supabase
        .from('inventory_items')
        .select('id, cost, listing_date')
        .in('id', inventoryItemIds);

      if (invData) {
        inventoryItems = Object.fromEntries(
          invData.map((item) => [
            item.id,
            {
              cost: item.cost || 0,
              listingDate: item.listing_date ? new Date(item.listing_date) : new Date(),
            },
          ])
        );
      }
    }

    // Enrich each eligible item
    const enrichedItems: EnrichedEligibleItem[] = [];

    for (const eligibleItem of eligibleItems) {
      const listing = listings?.find((l) => l.platform_item_id === eligibleItem.listingId);

      if (!listing) {
        // Skip items we don't have data for
        filterStats.notInPlatformListings++;
        filteredItems.push({
          listingId: eligibleItem.listingId,
          reason: 'not_in_platform_listings',
        });
        continue;
      }

      const ebayData = listing.ebay_data as Record<string, unknown> | null;
      const watchers = (ebayData?.watchers as number) || (ebayData?.watchCount as number) || 0;

      // Get inventory data for scoring (use mapping table to find inventory item)
      const inventoryItemId = listingToInventoryMap[listing.platform_item_id];
      const invData = inventoryItemId ? inventoryItems[inventoryItemId] : null;

      // Use listing date: prefer inventory data, then eBay listingStartDate, then skip filtering
      const ebayStartDate = ebayData?.listingStartDate
        ? new Date(ebayData.listingStartDate as string)
        : null;
      // Inventory listing_date takes priority, then eBay start date, fallback to epoch (won't filter)
      const originalListingDate = invData?.listingDate || ebayStartDate || new Date(0);

      // Check if this listing meets the minimum days threshold
      const daysSinceListing = Math.floor(
        (Date.now() - originalListingDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysSinceListing < config.minDaysBeforeOffer) {
        // Skip listings that haven't been listed long enough
        filterStats.tooNewForOffer++;
        filteredItems.push({
          listingId: eligibleItem.listingId,
          reason: 'too_new',
          details: `${daysSinceListing} days old, need ${config.minDaysBeforeOffer}`,
        });
        continue;
      }

      // Calculate score
      const scoreResult = this.scoringService!.calculateScore({
        originalListingDate,
        stockLevel: listing.quantity || 1,
        itemCost: invData?.cost || listing.price || 0,
        watcherCount: watchers,
      });

      // Get discount for this score
      const discountPercentage = await this.scoringService!.getDiscountForScore(
        userId,
        scoreResult.score,
        supabase
      );

      // Check re-offer eligibility
      const reOfferCheck = await this.checkReOfferEligibility(
        userId,
        eligibleItem.listingId,
        config.reOfferCooldownDays
      );

      // Calculate final discount (include escalation if re-offer)
      let finalDiscount = discountPercentage;
      let isReOffer = false;
      let previousOfferId: string | undefined;

      if (reOfferCheck.lastDiscount !== undefined) {
        // This is a potential re-offer
        if (reOfferCheck.canSend) {
          isReOffer = true;
          // Only escalate if current score is at least as high as the previous score
          // This prevents over-discounting when a listing's situation has improved
          // (e.g., gained watchers, sold some stock)
          const lastScore = reOfferCheck.lastScore ?? 0;
          if (scoreResult.score >= lastScore) {
            // Score still warrants escalation - apply escalated discount
            finalDiscount = Math.min(
              MAX_DISCOUNT_PERCENTAGE,
              Math.max(
                MIN_DISCOUNT_PERCENTAGE,
                reOfferCheck.lastDiscount + config.reOfferEscalationPercent
              )
            );
          } else {
            // Score has improved (lower = less urgency), use current score's discount
            // but ensure we don't offer less than the minimum
            finalDiscount = Math.max(MIN_DISCOUNT_PERCENTAGE, discountPercentage);
          }
        } else {
          // Can't re-offer yet, skip this item
          filterStats.inReOfferCooldown++;
          filteredItems.push({
            listingId: eligibleItem.listingId,
            reason: 're_offer_cooldown',
            details: `Last offer at ${reOfferCheck.lastDiscount}%, cooldown ${config.reOfferCooldownDays} days`,
          });
          continue;
        }
      }

      filterStats.passed++;
      enrichedItems.push({
        listingId: eligibleItem.listingId,
        inventoryItemId: inventoryItemId || undefined,
        title: listing.title || undefined,
        originalListingDate,
        currentPrice: listing.price,
        stockLevel: listing.quantity || 1,
        watcherCount: watchers,
        previousOfferCount: offerCountMap[eligibleItem.listingId] || 0,
        score: scoreResult.score,
        scoreFactors: scoreResult.factors,
        discountPercentage: finalDiscount,
        isReOffer,
        previousOfferId,
      });
    }

    // Log filtering summary
    console.log('[NegotiationService] Eligible items filter summary:', {
      ebayReturned: filterStats.ebayReturned,
      notInPlatformListings: filterStats.notInPlatformListings,
      tooNewForOffer: filterStats.tooNewForOffer,
      inReOfferCooldown: filterStats.inReOfferCooldown,
      passed: filterStats.passed,
    });

    // Log first few filtered items for debugging
    if (filteredItems.length > 0) {
      console.log(
        '[NegotiationService] Sample filtered items (first 10):',
        filteredItems.slice(0, 10)
      );
    }

    return enrichedItems;
  }

  // ==========================================================================
  // Send Offers
  // ==========================================================================

  /**
   * Process and send offers for all eligible items
   */
  async processOffers(
    userId: string,
    triggerType: 'manual' | 'automated' = 'manual',
    listingIds?: string[]
  ): Promise<ProcessOffersResult> {
    if (!this.negotiationClient || !this.supabase) {
      const initialized = await this.init(userId);
      if (!initialized) {
        throw new Error('Failed to initialize negotiation service');
      }
    }

    const results: SendOfferResult[] = [];
    const errors: string[] = [];
    let offersSent = 0;
    let offersFailed = 0;

    // Get config for message template
    const config = await this.getConfig(userId);
    const messageTemplate = config.offerMessageTemplate || DEFAULT_OFFER_MESSAGE_TEMPLATE;

    // Get eligible items
    const eligibleItems = await this.getEligibleItems(userId);

    // Filter to specific listing IDs if provided
    const itemsToProcess = listingIds
      ? eligibleItems.filter((item) => listingIds.includes(item.listingId))
      : eligibleItems;

    for (const item of itemsToProcess) {
      try {
        const result = await this.sendOfferForItem(userId, item, triggerType, messageTemplate);
        results.push(result);

        if (result.success) {
          offersSent += result.offersCreated || 1;
        } else {
          offersFailed++;
          if (result.error) {
            errors.push(`${item.listingId}: ${result.error}`);
          }
        }
      } catch (error) {
        offersFailed++;
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`${item.listingId}: ${errorMsg}`);
        results.push({
          success: false,
          listingId: item.listingId,
          discountPercentage: item.discountPercentage,
          score: item.score,
          error: errorMsg,
        });
      }
    }

    // Update last auto run if this was automated
    if (triggerType === 'automated') {
      await this.supabase!.from('negotiation_config')
        .update({
          last_auto_run_at: new Date().toISOString(),
          last_auto_run_offers_sent: offersSent,
        })
        .eq('user_id', userId);
    }

    return {
      offersSent,
      offersFailed,
      offersSkipped: 0, // Skipping is handled during eligibility filtering
      eligibleCount: itemsToProcess.length,
      results,
      errors,
    };
  }

  /**
   * Send an offer for a single eligible item
   */
  private async sendOfferForItem(
    userId: string,
    item: EnrichedEligibleItem,
    triggerType: 'manual' | 'automated',
    messageTemplate: string
  ): Promise<SendOfferResult> {
    try {
      // Build the offer message using the template with placeholder substitution
      const offerMessage = substituteMessagePlaceholders(messageTemplate, {
        discountPercentage: item.discountPercentage,
        title: item.title,
        originalPrice: item.currentPrice,
        currency: 'GBP',
      });

      // Send offer via eBay API
      const response = await this.negotiationClient!.sendOfferToInterestedBuyers(
        item.listingId,
        item.discountPercentage,
        offerMessage
      );

      // Record each offer in the database
      const offersCreated = response.offers?.length || 0;

      for (const offer of response.offers || []) {
        await this.recordOffer({
          userId,
          ebayListingId: item.listingId,
          listingTitle: item.title,
          inventoryItemId: item.inventoryItemId,
          ebayOfferId: offer.offerId,
          buyerMaskedUsername: offer.buyer?.maskedUsername,
          discountPercentage: item.discountPercentage,
          originalPrice: item.currentPrice,
          offerPrice: item.currentPrice
            ? item.currentPrice * (1 - item.discountPercentage / 100)
            : undefined,
          score: item.score,
          scoreFactors: item.scoreFactors,
          offerMessage,
          status: 'PENDING',
          isReOffer: item.isReOffer,
          previousOfferId: item.previousOfferId,
          triggerType,
          expiresAt: new Date(Date.now() + OFFER_DURATION_DAYS * 24 * 60 * 60 * 1000),
        });
      }

      return {
        success: true,
        listingId: item.listingId,
        ebayOfferId: response.offers?.[0]?.offerId,
        buyerMaskedUsername: response.offers?.[0]?.buyer?.maskedUsername,
        discountPercentage: item.discountPercentage,
        score: item.score,
        offersCreated,
      };
    } catch (error) {
      // Handle specific eBay errors
      if (error instanceof EbayNegotiationApiError) {
        if (error.isNoInterestedBuyersError()) {
          // No interested buyers - not really a failure
          return {
            success: true,
            listingId: item.listingId,
            discountPercentage: item.discountPercentage,
            score: item.score,
            offersCreated: 0,
          };
        }

        if (error.isMaxOffersReachedError()) {
          return {
            success: false,
            listingId: item.listingId,
            discountPercentage: item.discountPercentage,
            score: item.score,
            error: 'Maximum offers reached for this listing',
          };
        }
      }

      throw error;
    }
  }

  /**
   * Record an offer in the database
   */
  private async recordOffer(offer: Omit<NegotiationOffer, 'id' | 'sentAt'>): Promise<void> {
    const supabase = this.supabase!;

    const { error } = await supabase.from('negotiation_offers').insert({
      user_id: offer.userId,
      ebay_listing_id: offer.ebayListingId,
      listing_title: offer.listingTitle || null,
      inventory_item_id: offer.inventoryItemId || null,
      ebay_offer_id: offer.ebayOfferId || null,
      buyer_masked_username: offer.buyerMaskedUsername || null,
      discount_percentage: offer.discountPercentage,
      original_price: offer.originalPrice || null,
      offer_price: offer.offerPrice || null,
      score: offer.score,
      score_factors: offer.scoreFactors,
      offer_message: offer.offerMessage || null,
      status: offer.status,
      is_re_offer: offer.isReOffer,
      previous_offer_id: offer.previousOfferId || null,
      trigger_type: offer.triggerType,
      expires_at: offer.expiresAt?.toISOString() || null,
    });

    if (error) {
      console.error('[NegotiationService] Error recording offer:', error);
      // Don't throw - we don't want to fail the whole batch for a recording error
    }
  }

  // ==========================================================================
  // Re-offer Logic
  // ==========================================================================

  /**
   * Check if we can re-offer on a listing
   */
  async checkReOfferEligibility(
    userId: string,
    ebayListingId: string,
    cooldownDays: number
  ): Promise<ReOfferEligibility> {
    const supabase = this.supabase || (await createClient());

    // Get the last offer for this listing
    const { data: lastOffer, error } = await supabase
      .from('negotiation_offers')
      .select('id, sent_at, discount_percentage, score, status')
      .eq('user_id', userId)
      .eq('ebay_listing_id', ebayListingId)
      .in('status', ['EXPIRED', 'DECLINED'])
      .order('sent_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('[NegotiationService] Error checking re-offer:', error);
      throw error;
    }

    if (!lastOffer) {
      // No previous offer - can send
      return { canSend: true };
    }

    const lastOfferDate = new Date(lastOffer.sent_at);
    const daysSinceLast = Math.floor(
      (Date.now() - lastOfferDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      canSend: daysSinceLast >= cooldownDays,
      lastOfferDate,
      lastDiscount: lastOffer.discount_percentage,
      lastScore: lastOffer.score,
      daysSinceLast,
    };
  }

  // ==========================================================================
  // Metrics
  // ==========================================================================

  /**
   * Get negotiation metrics for the dashboard
   */
  async getMetrics(userId: string, days: number = 30): Promise<NegotiationMetrics> {
    const supabase = this.supabase || (await createClient());

    // Use the database function for efficient calculation
    const { data, error } = await supabase.rpc('get_negotiation_metrics', {
      p_user_id: userId,
      p_days: days,
    });

    if (error) {
      console.error('[NegotiationService] Error fetching metrics:', error);
      throw error;
    }

    const row = data?.[0] || {};

    return {
      totalOffersSent: row.total_offers_sent || 0,
      offersAccepted: row.offers_accepted || 0,
      offersDeclined: row.offers_declined || 0,
      offersExpired: row.offers_expired || 0,
      offersPending: row.offers_pending || 0,
      acceptanceRate: row.acceptance_rate || 0,
      avgDiscountSent: row.avg_discount_sent || 0,
      avgDiscountConverted: row.avg_discount_converted || 0,
    };
  }

  // ==========================================================================
  // Offers List
  // ==========================================================================

  /**
   * Get list of sent offers with filtering and pagination
   */
  async getOffers(
    userId: string,
    options: {
      status?: string;
      triggerType?: 'manual' | 'automated';
      listingId?: string;
      limit?: number;
      offset?: number;
      startDate?: string;
      endDate?: string;
    } = {}
  ): Promise<{ offers: NegotiationOffer[]; total: number }> {
    const supabase = this.supabase || (await createClient());

    let query = supabase
      .from('negotiation_offers')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('sent_at', { ascending: false });

    if (options.status) {
      query = query.eq('status', options.status);
    }

    if (options.triggerType) {
      query = query.eq('trigger_type', options.triggerType);
    }

    if (options.listingId) {
      query = query.eq('ebay_listing_id', options.listingId);
    }

    if (options.startDate) {
      query = query.gte('sent_at', options.startDate);
    }

    if (options.endDate) {
      query = query.lte('sent_at', options.endDate);
    }

    const limit = options.limit || 50;
    const offset = options.offset || 0;
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error('[NegotiationService] Error fetching offers:', error);
      throw error;
    }

    const offers: NegotiationOffer[] =
      data?.map((row) => ({
        id: row.id,
        userId: row.user_id,
        ebayListingId: row.ebay_listing_id,
        listingTitle: row.listing_title || undefined,
        inventoryItemId: row.inventory_item_id || undefined,
        ebayOfferId: row.ebay_offer_id || undefined,
        buyerMaskedUsername: row.buyer_masked_username || undefined,
        discountPercentage: row.discount_percentage,
        originalPrice: row.original_price || undefined,
        offerPrice: row.offer_price || undefined,
        score: row.score,
        scoreFactors: row.score_factors as NegotiationOffer['scoreFactors'],
        offerMessage: row.offer_message || undefined,
        status: row.status as NegotiationOffer['status'],
        isReOffer: row.is_re_offer,
        previousOfferId: row.previous_offer_id || undefined,
        triggerType: row.trigger_type as 'manual' | 'automated',
        sentAt: new Date(row.sent_at),
        expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
        statusUpdatedAt: row.status_updated_at ? new Date(row.status_updated_at) : undefined,
        errorMessage: row.error_message || undefined,
      })) || [];

    return { offers, total: count || 0 };
  }

  // ==========================================================================
  // Status Sync
  // ==========================================================================

  /**
   * Sync offer statuses by:
   * 1. Detecting accepted offers by matching with eBay orders
   * 2. Marking expired offers past their expiry date
   *
   * Note: eBay doesn't provide a direct API to check offer status,
   * so we detect acceptance by checking if an order was placed at the offer price.
   */
  async syncOfferStatuses(userId: string): Promise<{
    accepted: number;
    expired: number;
    total: number;
  }> {
    const supabase = this.supabase || (await createClient());
    const now = new Date().toISOString();
    let acceptedCount = 0;
    let expiredCount = 0;

    // Step 1: Get all PENDING offers
    const { data: pendingOffers, error: fetchError } = await supabase
      .from('negotiation_offers')
      .select('id, ebay_listing_id, offer_price, sent_at, expires_at')
      .eq('user_id', userId)
      .eq('status', 'PENDING');

    if (fetchError) {
      console.error('[NegotiationService] Error fetching pending offers:', fetchError);
      throw fetchError;
    }

    if (!pendingOffers || pendingOffers.length === 0) {
      console.log('[NegotiationService] No pending offers to sync');
      return { accepted: 0, expired: 0, total: 0 };
    }

    console.log(`[NegotiationService] Syncing ${pendingOffers.length} pending offers`);

    // Step 2: Get listing IDs from pending offers
    const listingIds = [...new Set(pendingOffers.map((o) => o.ebay_listing_id))];

    // Step 3: Find eBay orders for these listings placed after offers were sent
    // We match by: listing ID + order placed after offer sent + price matches offer price (within tolerance)
    const { data: matchingOrders, error: ordersError } = await supabase
      .from('ebay_order_line_items')
      .select(
        `
        legacy_item_id,
        line_item_cost_amount,
        order:ebay_orders!inner(
          creation_date,
          user_id
        )
      `
      )
      .in('legacy_item_id', listingIds)
      .eq('order.user_id', userId);

    if (ordersError) {
      console.error('[NegotiationService] Error fetching orders:', ordersError);
      // Don't throw - continue with expiry marking
    }

    // Step 4: Match offers to orders
    const acceptedOfferIds: string[] = [];

    if (matchingOrders && matchingOrders.length > 0) {
      for (const offer of pendingOffers) {
        // Find orders for this listing
        const ordersForListing = matchingOrders.filter(
          (o) => o.legacy_item_id === offer.ebay_listing_id
        );

        for (const order of ordersForListing) {
          // order.order is an array from the join, take first element
          const orderData = Array.isArray(order.order) ? order.order[0] : order.order;
          if (!orderData?.creation_date) continue;

          const orderDate = new Date(orderData.creation_date);
          const offerSentDate = new Date(offer.sent_at);
          const orderPrice = parseFloat(String(order.line_item_cost_amount));
          const offerPrice = offer.offer_price ? parseFloat(String(offer.offer_price)) : null;

          // Check if order was placed after offer was sent
          if (orderDate < offerSentDate) {
            continue;
          }

          // Check if price matches (within 1p tolerance for rounding)
          if (offerPrice !== null && Math.abs(orderPrice - offerPrice) <= 0.01) {
            acceptedOfferIds.push(offer.id);
            console.log(
              `[NegotiationService] Offer ${offer.id} accepted: listing ${offer.ebay_listing_id}, ` +
                `offer price £${offerPrice}, order price £${orderPrice}`
            );
            break; // One match is enough for this offer
          }
        }
      }
    }

    // Step 5: Mark accepted offers
    if (acceptedOfferIds.length > 0) {
      const { error: acceptError } = await supabase
        .from('negotiation_offers')
        .update({
          status: 'ACCEPTED',
          status_updated_at: now,
        })
        .in('id', acceptedOfferIds);

      if (acceptError) {
        console.error('[NegotiationService] Error marking accepted offers:', acceptError);
      } else {
        acceptedCount = acceptedOfferIds.length;
        console.log(`[NegotiationService] Marked ${acceptedCount} offers as ACCEPTED`);
      }
    }

    // Step 6: Mark expired offers (excluding ones we just marked as accepted)
    const expiredOfferIds = pendingOffers
      .filter(
        (o) =>
          !acceptedOfferIds.includes(o.id) && o.expires_at && new Date(o.expires_at) < new Date()
      )
      .map((o) => o.id);

    if (expiredOfferIds.length > 0) {
      const { error: expireError } = await supabase
        .from('negotiation_offers')
        .update({
          status: 'EXPIRED',
          status_updated_at: now,
        })
        .in('id', expiredOfferIds);

      if (expireError) {
        console.error('[NegotiationService] Error marking expired offers:', expireError);
      } else {
        expiredCount = expiredOfferIds.length;
        console.log(`[NegotiationService] Marked ${expiredCount} offers as EXPIRED`);
      }
    }

    return {
      accepted: acceptedCount,
      expired: expiredCount,
      total: acceptedCount + expiredCount,
    };
  }

  // ==========================================================================
  // Notifications
  // ==========================================================================

  /**
   * Send a notification summary after automated offer processing
   */
  async sendAutomatedRunNotification(result: ProcessOffersResult): Promise<void> {
    if (result.offersSent === 0 && result.offersFailed === 0) {
      // Don't send notification if nothing happened
      return;
    }

    const message =
      result.offersFailed > 0
        ? `${result.offersSent} offer(s) sent, ${result.offersFailed} failed`
        : `${result.offersSent} offer(s) sent to interested buyers`;

    await discordService.sendSyncStatus({
      title: '📤 eBay Offers Sent',
      message,
      success: result.offersFailed === 0,
    });
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Map database config row to typed config object
   */
  private mapConfigFromDb(row: Record<string, unknown>): NegotiationConfig {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      automationEnabled: row.automation_enabled as boolean,
      minDaysBeforeOffer: row.min_days_before_offer as number,
      reOfferCooldownDays: row.re_offer_cooldown_days as number,
      reOfferEscalationPercent: row.re_offer_escalation_percent as number,
      weightListingAge: row.weight_listing_age as number,
      weightStockLevel: row.weight_stock_level as number,
      weightItemValue: row.weight_item_value as number,
      weightCategory: row.weight_category as number,
      weightWatchers: row.weight_watchers as number,
      offerMessageTemplate:
        (row.offer_message_template as string) || DEFAULT_OFFER_MESSAGE_TEMPLATE,
      lastAutoRunAt: row.last_auto_run_at ? new Date(row.last_auto_run_at as string) : undefined,
      lastAutoRunOffersSent: row.last_auto_run_offers_sent as number | undefined,
    };
  }
}

/**
 * Factory function to create a new NegotiationService instance.
 * Creates a fresh instance per request to avoid shared state between users.
 * @param supabase Optional Supabase client (for cron/background jobs that need service role access)
 */
export function getNegotiationService(supabase?: SupabaseClient): NegotiationService {
  return new NegotiationService(supabase);
}
