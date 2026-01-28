/**
 * Listing Optimiser Service
 *
 * Analyses existing eBay listings against best practices,
 * generates improvement suggestions, and applies approved changes.
 */

import { GoogleGenAI } from '@google/genai';
import { createClient } from '@/lib/supabase/server';
import { EbayTradingClient } from '@/lib/platform-stock/ebay/ebay-trading.client';
import { EbayAuthService } from '@/lib/ebay/ebay-auth.service';
import { EbayApiAdapter } from '@/lib/ebay/ebay-api.adapter';
import type { EbayInventoryItem } from '@/lib/ebay/types';
import {
  getExtendedFindingClient,
  type PricingAnalysisResult,
} from './ebay-finding.client';
import {
  ANALYSE_LISTING_SYSTEM_PROMPT,
  createAnalyseListingMessage,
  type ListingAnalysisResponse,
  type ListingSuggestion,
  type CategoryBreakdown,
  type DescriptionTemplate,
} from '@/lib/ai/prompts/analyse-listing';
import { calculateEbayProfit } from '@/lib/purchase-evaluator/calculations';
import type {
  FullItemDetails,
  ReviseItemRequest,
  ReviseItemResult,
} from '@/lib/platform-stock/ebay/types';
import type { Json } from '@hadley-bricks/database';

// Gemini 3 Pro model ID
const GEMINI_MODEL = 'gemini-3-pro-preview';

let geminiClient: GoogleGenAI | null = null;

/**
 * Get the Gemini client instance (singleton)
 */
function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_AI_API_KEY environment variable is not set');
    }
    geminiClient = new GoogleGenAI({ apiKey });
  }
  return geminiClient;
}

/**
 * Listing with optimiser data
 */
export interface OptimiserListing {
  id: string;
  itemId: string;
  title: string;
  price: number;
  currency: string;
  quantity: number;
  listingAge: number; // days
  views: number;
  watchers: number;
  lastReviewedAt: string | null;
  qualityScore: number | null;
  qualityGrade: string | null;
  viewItemUrl: string | null;
  imageUrl: string | null;
  inventoryItemId: string | null;
  costPrice: number | null;
  // Revision restriction flags - these prevent title/subtitle changes on eBay
  pendingOfferCount: number;
  endsWithin12Hours: boolean;
  listingEndDate: string | null;
}

/**
 * Summary stats for listings
 */
export interface ListingOptimiserSummary {
  totalListings: number;
  reviewedCount: number;
  averageScore: number | null;
  lowScoreCount: number;
}

/**
 * Filters for listing optimiser
 */
export interface OptimiserFilters {
  search?: string;
  minAge?: number;
  minViews?: number;
  maxViews?: number;
  hasWatchers?: boolean;
  qualityGrade?: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' | 'all';
  reviewedStatus?: 'reviewed' | 'not_reviewed' | 'all';
}

/**
 * Full analysis result for a listing
 */
export interface FullAnalysisResult {
  listingId: string;
  analysis: ListingAnalysisResponse;
  pricing: PricingAnalysisResult & {
    profitEstimate: number | null;
    profitMargin: number | null;
    costSource: 'inventory' | null;
  };
  reviewId: string;
}

/**
 * Progress callback type
 */
export type AnalysisProgressCallback = (step: string, detail?: string) => void;

/**
 * Listing Optimiser Service
 */
export class ListingOptimiserService {
  private tradingClient: EbayTradingClient | null = null;
  private ebayAuth: EbayAuthService;

  constructor() {
    this.ebayAuth = new EbayAuthService();
  }

  /**
   * Initialise the service with eBay credentials
   */
  async init(userId: string): Promise<boolean> {
    // Get access token (handles refresh automatically)
    const accessToken = await this.ebayAuth.getAccessToken(userId);
    if (!accessToken) {
      return false;
    }

    this.tradingClient = new EbayTradingClient({
      accessToken,
      siteId: 3, // UK
    });

    return true;
  }

  /**
   * Check if Gemini is configured
   */
  isGeminiConfigured(): boolean {
    return !!process.env.GOOGLE_AI_API_KEY;
  }

  /**
   * Get all active eBay listings with optimiser data
   */
  async getListings(
    userId: string,
    filters?: OptimiserFilters
  ): Promise<{ listings: OptimiserListing[]; summary: ListingOptimiserSummary }> {
    const supabase = await createClient();

    // Query platform_listings with quality data
    let query = supabase
      .from('platform_listings')
      .select(`
        id,
        platform_item_id,
        title,
        price,
        currency,
        quantity,
        listing_status,
        created_at,
        last_reviewed_at,
        quality_score,
        quality_grade,
        ebay_data
      `)
      .eq('user_id', userId)
      .eq('platform', 'ebay')
      .eq('listing_status', 'Active');

    // Apply filters
    if (filters?.search) {
      query = query.ilike('title', `%${filters.search}%`);
    }

    if (filters?.qualityGrade && filters.qualityGrade !== 'all') {
      query = query.eq('quality_grade', filters.qualityGrade);
    }

    if (filters?.reviewedStatus === 'reviewed') {
      query = query.not('last_reviewed_at', 'is', null);
    } else if (filters?.reviewedStatus === 'not_reviewed') {
      query = query.is('last_reviewed_at', null);
    }

    const { data: listings, error } = await query;

    if (error) {
      console.error('[ListingOptimiserService] Error fetching listings:', error);
      throw error;
    }

    // Get SKU mappings to link to inventory
    const itemIds = listings?.map((l) => l.platform_item_id) || [];

    // We need to find inventory items linked via ebay_sku_mappings
    // First get SKUs from listings, then look them up
    const skuToInventoryMap: Record<string, { id: string; cost: number | null }> = {};

    if (itemIds.length > 0) {
      // Get ebay_data.sku from listings and look up inventory
      const skus: string[] = [];
      for (const listing of listings || []) {
        const ebayData = listing.ebay_data as Record<string, unknown> | null;
        if (ebayData?.sku && typeof ebayData.sku === 'string') {
          skus.push(ebayData.sku);
        }
      }

      if (skus.length > 0) {
        // Get SKU mappings
        const { data: mappings } = await supabase
          .from('ebay_sku_mappings')
          .select('ebay_sku, inventory_item_id')
          .eq('user_id', userId)
          .in('ebay_sku', skus);

        if (mappings && mappings.length > 0) {
          const inventoryIds = mappings.map((m) => m.inventory_item_id);

          // Get inventory items
          const { data: inventoryItems } = await supabase
            .from('inventory_items')
            .select('id, cost')
            .in('id', inventoryIds);

          if (inventoryItems) {
            const invMap = Object.fromEntries(
              inventoryItems.map((i) => [i.id, i.cost])
            );

            for (const mapping of mappings) {
              skuToInventoryMap[mapping.ebay_sku] = {
                id: mapping.inventory_item_id,
                cost: invMap[mapping.inventory_item_id] || null,
              };
            }
          }
        }
      }
    }

    // Get pending offer counts for all listings
    const pendingOfferCounts: Record<string, number> = {};
    if (itemIds.length > 0) {
      // Query negotiation_offers for pending offers grouped by listing ID
      const { data: pendingOffers } = await supabase
        .from('negotiation_offers')
        .select('ebay_listing_id')
        .eq('user_id', userId)
        .in('ebay_listing_id', itemIds)
        .eq('status', 'PENDING');

      if (pendingOffers) {
        for (const offer of pendingOffers) {
          const listingId = offer.ebay_listing_id;
          pendingOfferCounts[listingId] = (pendingOfferCounts[listingId] || 0) + 1;
        }
      }
    }

    // Transform to OptimiserListing
    const now = new Date();
    const twelveHoursFromNow = new Date(now.getTime() + 12 * 60 * 60 * 1000);

    const transformed: OptimiserListing[] = (listings || []).map((listing) => {
      const ebayData = listing.ebay_data as Record<string, unknown> || {};

      // Use eBay's listingStartDate for age calculation, fall back to created_at
      const listingStartDate = ebayData.listingStartDate
        ? new Date(ebayData.listingStartDate as string)
        : new Date(listing.created_at);
      const listingAge = Math.floor((now.getTime() - listingStartDate.getTime()) / (1000 * 60 * 60 * 24));

      const sku = ebayData.sku as string | undefined;
      const inventoryData = sku ? skuToInventoryMap[sku] : null;

      // Calculate if listing ends within 12 hours
      const listingEndDateStr = ebayData.listingEndDate as string | null;
      const listingEndDate = listingEndDateStr ? new Date(listingEndDateStr) : null;
      const endsWithin12Hours = listingEndDate ? listingEndDate <= twelveHoursFromNow : false;

      return {
        id: listing.id,
        itemId: listing.platform_item_id,
        title: listing.title || '',
        price: listing.price || 0,
        currency: listing.currency || 'GBP',
        quantity: listing.quantity || 0,
        listingAge,
        views: (ebayData.hitCount as number) || 0,
        watchers: (ebayData.watchers as number) || 0,
        lastReviewedAt: listing.last_reviewed_at,
        qualityScore: listing.quality_score,
        qualityGrade: listing.quality_grade,
        viewItemUrl: (ebayData.viewItemUrl as string) || null,
        imageUrl: (ebayData.galleryUrl as string) || null,
        inventoryItemId: inventoryData?.id || null,
        costPrice: inventoryData?.cost || null,
        // Revision restriction flags
        pendingOfferCount: pendingOfferCounts[listing.platform_item_id] || 0,
        endsWithin12Hours,
        listingEndDate: listingEndDateStr,
      };
    });

    // Apply client-side filters that can't be done in SQL
    let filtered = transformed;

    if (filters?.minAge !== undefined) {
      filtered = filtered.filter((l) => l.listingAge >= filters.minAge!);
    }

    if (filters?.minViews !== undefined) {
      filtered = filtered.filter((l) => l.views >= filters.minViews!);
    }

    if (filters?.maxViews !== undefined) {
      filtered = filtered.filter((l) => l.views <= filters.maxViews!);
    }

    if (filters?.hasWatchers !== undefined) {
      filtered = filtered.filter((l) =>
        filters.hasWatchers ? l.watchers > 0 : l.watchers === 0
      );
    }

    // Calculate summary
    const reviewed = transformed.filter((l) => l.qualityScore !== null);
    const averageScore =
      reviewed.length > 0
        ? reviewed.reduce((sum, l) => sum + (l.qualityScore || 0), 0) / reviewed.length
        : null;
    const lowScoreCount = reviewed.filter((l) => (l.qualityScore || 0) < 70).length;

    const summary: ListingOptimiserSummary = {
      totalListings: transformed.length,
      reviewedCount: reviewed.length,
      averageScore: averageScore ? Math.round(averageScore * 10) / 10 : null,
      lowScoreCount,
    };

    return { listings: filtered, summary };
  }

  /**
   * Analyse a single listing
   */
  async analyseListing(
    userId: string,
    itemId: string,
    onProgress?: AnalysisProgressCallback
  ): Promise<FullAnalysisResult> {
    const log = (step: string, detail?: string) => {
      console.log(`[ListingOptimiserService] ${step}${detail ? `: ${detail}` : ''}`);
      onProgress?.(step, detail);
    };

    log('Starting analysis', `ItemID: ${itemId}`);

    // Ensure trading client is initialised
    if (!this.tradingClient) {
      const success = await this.init(userId);
      if (!success) {
        throw new Error('EBAY_NOT_CONNECTED');
      }
    }

    // 1. Fetch current listing data from eBay
    log('Fetching listing details from eBay');
    const listingDetails = await this.tradingClient!.getItem(itemId);
    log('Listing fetched', listingDetails.title);

    // 2. Get inventory data if linked via SKU
    const supabase = await createClient();

    let inventoryData: {
      setNumber?: string;
      theme?: string;
      condition?: string;
      pieceCount?: number;
      hasBox?: boolean;
      hasInstructions?: boolean;
      costPrice?: number;
    } | undefined;

    if (listingDetails.sku) {
      // Look up SKU mapping
      const { data: mapping } = await supabase
        .from('ebay_sku_mappings')
        .select('inventory_item_id')
        .eq('user_id', userId)
        .eq('ebay_sku', listingDetails.sku)
        .single();

      if (mapping?.inventory_item_id) {
        const { data: inventory } = await supabase
          .from('inventory_items')
          .select('set_number, condition, cost')
          .eq('id', mapping.inventory_item_id)
          .single();

        if (inventory) {
          inventoryData = {
            setNumber: inventory.set_number,
            condition: inventory.condition || undefined,
            costPrice: inventory.cost || undefined,
          };
        }
      }
    }

    // 2b. Fetch recently applied suggestions (to avoid re-suggesting same changes)
    const { data: appliedSuggestions } = await supabase
      .from('listing_applied_suggestions')
      .select('category, field, applied_value, applied_at')
      .eq('user_id', userId)
      .eq('ebay_listing_id', itemId)
      .gte('applied_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()) // Last 30 days
      .order('applied_at', { ascending: false });

    if (appliedSuggestions && appliedSuggestions.length > 0) {
      log('Found recently applied suggestions', `${appliedSuggestions.length} suggestion(s)`);
    }

    // 2c. Fetch description template based on listing type
    // Determine if this is a LEGO listing and whether it's new or used
    const isLegoListing = this.isLegoListing(listingDetails);
    const isUsedCondition = listingDetails.conditionId && listingDetails.conditionId >= 3000;

    let descriptionTemplate: DescriptionTemplate | undefined;

    if (isLegoListing) {
      // Fetch the appropriate LEGO template
      const templateType = isUsedCondition ? 'lego_used' : 'lego_new';
      log('Fetching description template', templateType);

      const { data: template } = await supabase
        .from('listing_templates')
        .select('name, type, content')
        .eq('user_id', userId)
        .eq('type', templateType)
        .limit(1)
        .single();

      if (template) {
        descriptionTemplate = {
          name: template.name,
          type: template.type as DescriptionTemplate['type'],
          content: template.content,
        };
        log('Template found', template.name);
      } else {
        log('No template found for type', templateType);
      }
    } else {
      // Non-LEGO listing - use general template
      log('Fetching general description template');

      const { data: template } = await supabase
        .from('listing_templates')
        .select('name, type, content')
        .eq('user_id', userId)
        .eq('type', 'general')
        .limit(1)
        .single();

      if (template) {
        descriptionTemplate = {
          name: template.name,
          type: template.type as DescriptionTemplate['type'],
          content: template.content,
        };
        log('Template found', template.name);
      }
    }

    // 3. Run AI analysis
    log('Starting AI analysis');
    const analysis = await this.runAiAnalysis(listingDetails, inventoryData, appliedSuggestions || undefined, descriptionTemplate, onProgress);
    log('AI analysis complete', `Score: ${analysis.score}, Grade: ${analysis.grade}`);

    // 4. Get pricing analysis
    log('Fetching pricing data');
    const setNumber = inventoryData?.setNumber || this.extractSetNumber(listingDetails.title);
    const condition = this.mapConditionToSimple(listingDetails.conditionId);

    let pricing: PricingAnalysisResult;
    try {
      const findingClient = getExtendedFindingClient();
      pricing = await findingClient.getPricingAnalysis(
        setNumber,
        listingDetails.startPrice,
        condition
      );
      log('Pricing data fetched', `Competitor count: ${pricing.competitorCount}`);
    } catch (error) {
      console.error('[ListingOptimiserService] Pricing fetch error:', error);
      pricing = {
        currentPrice: listingDetails.startPrice,
        competitorAvgPrice: null,
        competitorMinPrice: null,
        competitorMaxPrice: null,
        competitorCount: 0,
        soldAvgPrice: null,
        soldMinPrice: null,
        soldMaxPrice: null,
        soldCount: 0,
        suggestedPrice: null,
        rateLimited: false,
      };
    }

    // 5. Calculate profit estimate
    let profitEstimate: number | null = null;
    let profitMargin: number | null = null;
    let costSource: 'inventory' | null = null;

    if (inventoryData?.costPrice) {
      const suggestedPrice = pricing.suggestedPrice || listingDetails.startPrice;
      const profitCalc = calculateEbayProfit(suggestedPrice, inventoryData.costPrice);
      if (profitCalc) {
        profitEstimate = profitCalc.totalProfit;
        profitMargin = profitCalc.profitMarginPercent;
        costSource = 'inventory';
      }
    }

    const pricingWithProfit = {
      ...pricing,
      profitEstimate,
      profitMargin,
      costSource,
    };

    // 6. Save review to database
    log('Saving review to database');
    const reviewId = await this.saveReview(userId, itemId, analysis, pricingWithProfit);

    // 7. Update platform_listings summary
    await supabase
      .from('platform_listings')
      .update({
        last_reviewed_at: new Date().toISOString(),
        quality_score: analysis.score,
        quality_grade: analysis.grade,
      })
      .eq('user_id', userId)
      .eq('platform_item_id', itemId);

    log('Analysis complete');

    return {
      listingId: itemId,
      analysis,
      pricing: pricingWithProfit,
      reviewId,
    };
  }

  /**
   * Apply approved changes to a listing
   */
  async applyChange(
    userId: string,
    itemId: string,
    suggestion: ListingSuggestion
  ): Promise<ReviseItemResult> {
    // Ensure trading client is initialised
    if (!this.tradingClient) {
      const success = await this.init(userId);
      if (!success) {
        throw new Error('EBAY_NOT_CONNECTED');
      }
    }

    // Build revision request based on suggestion category
    const request: ReviseItemRequest = { itemId };

    // CRITICAL: Category changes are NOT supported by eBay's ReviseFixedPriceItem API
    // Check for any category-related suggestion field regardless of which category it comes under
    const fieldLower = suggestion.field.toLowerCase();
    if (fieldLower === 'category' || fieldLower === 'categoryid' || fieldLower.includes('category')) {
      console.log(`[ListingOptimiserService] Category changes not supported, field: ${suggestion.field}`);
      throw new Error('Category changes are not supported via the eBay API. Please update the category manually on eBay.');
    }

    switch (suggestion.category) {
      case 'title':
        request.title = suggestion.suggestedValue;
        break;
      case 'description':
        request.description = suggestion.suggestedValue;
        break;
      case 'itemSpecifics':
        // IMPORTANT: eBay's ReviseFixedPriceItem replaces ALL item specifics, not just the one being changed
        // We must fetch current specifics, update the one we want, and send all of them back
        console.log(`[ListingOptimiserService] Fetching current item specifics for ${itemId} to update ${suggestion.field}`);

        try {
          const currentListing = await this.tradingClient!.getItem(itemId);
          const currentSpecifics = currentListing.itemSpecifics || [];

          // Find and update the specific, or add it if it doesn't exist
          const fieldNameLower = suggestion.field.toLowerCase();
          const existingIndex = currentSpecifics.findIndex(
            (spec) => spec.name.toLowerCase() === fieldNameLower
          );

          let updatedSpecifics: Array<{ name: string; value: string }>;

          if (existingIndex >= 0) {
            // Update existing specific
            updatedSpecifics = currentSpecifics.map((spec, idx) =>
              idx === existingIndex
                ? { name: spec.name, value: suggestion.suggestedValue }
                : spec
            );
            console.log(`[ListingOptimiserService] Updated existing specific "${suggestion.field}" at index ${existingIndex}`);
          } else {
            // Add new specific
            updatedSpecifics = [
              ...currentSpecifics,
              { name: suggestion.field, value: suggestion.suggestedValue },
            ];
            console.log(`[ListingOptimiserService] Added new specific "${suggestion.field}"`);
          }

          console.log(`[ListingOptimiserService] Sending ${updatedSpecifics.length} item specifics to eBay`);
          request.itemSpecifics = updatedSpecifics;
        } catch (fetchError) {
          console.error(`[ListingOptimiserService] Failed to fetch current item specifics:`, fetchError);
          throw new Error(`Failed to fetch current listing data: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}`);
        }
        break;
      case 'condition':
        // Check if this is a conditionDescription update vs conditionId update
        const fieldLowerCondition = suggestion.field.toLowerCase();
        if (fieldLowerCondition.includes('description') || fieldLowerCondition === 'conditiondescription') {
          // This is a condition DESCRIPTION update (the text field)
          console.log(`[ListingOptimiserService] Updating condition description to: "${suggestion.suggestedValue.substring(0, 100)}..."`);
          request.conditionDescription = suggestion.suggestedValue;
        } else {
          // This is a condition ID update
          // Try to find a 4-digit condition ID anywhere in the string
          console.log(`[ListingOptimiserService] Parsing condition ID from: "${suggestion.suggestedValue}"`);
          const conditionMatch = suggestion.suggestedValue.match(/\b(1000|1500|3000)\b/);
          if (conditionMatch) {
            const conditionId = parseInt(conditionMatch[1], 10);
            console.log(`[ListingOptimiserService] Extracted condition ID: ${conditionId}`);
            request.conditionId = conditionId;
          } else {
            // Try to infer from text if no valid ID found
            const lowerValue = suggestion.suggestedValue.toLowerCase();
            if (lowerValue.includes('new') && !lowerValue.includes('other')) {
              console.log(`[ListingOptimiserService] Inferred condition ID 1000 (New) from text`);
              request.conditionId = 1000;
            } else if (lowerValue.includes('new') && lowerValue.includes('other')) {
              console.log(`[ListingOptimiserService] Inferred condition ID 1500 (New Other) from text`);
              request.conditionId = 1500;
            } else if (lowerValue.includes('used')) {
              console.log(`[ListingOptimiserService] Inferred condition ID 3000 (Used) from text`);
              request.conditionId = 3000;
            } else {
              // If the suggested value looks like a description (long text), treat it as conditionDescription
              if (suggestion.suggestedValue.length > 20) {
                console.log(`[ListingOptimiserService] Suggested value looks like a description, updating conditionDescription`);
                request.conditionDescription = suggestion.suggestedValue;
              } else {
                throw new Error(`Could not parse condition from "${suggestion.suggestedValue}". Valid LEGO conditions are: New (1000), New (Other) (1500), or Used (3000).`);
              }
            }
          }
        }
        break;
      case 'seo':
        // SEO suggestions that aren't category-related should update the description
        // (Category changes are already blocked at the top of this method)
        request.description = suggestion.suggestedValue;
        break;
      default:
        throw new Error(`Unsupported suggestion category: ${suggestion.category}`);
    }

    console.log(`[ListingOptimiserService] Applying change to ${itemId}:`, request);

    // Call ReviseItem API (Trading API)
    // If listing was created via Inventory API, this will fail with a specific error
    let result = await this.tradingClient!.reviseFixedPriceItem(request);

    // Check if the listing is inventory-based and requires Inventory API
    if (!result.success && result.errorMessage?.toLowerCase().includes('inventory-based')) {
      console.log(`[ListingOptimiserService] Listing ${itemId} is inventory-based, falling back to Inventory API`);
      result = await this.applyChangeViaInventoryApi(userId, itemId, suggestion);
    }

    // Check for product catalog override warning
    // eBay returns success but with a warning when product catalog data overrides custom values
    if (result.success && result.warnings && result.warnings.length > 0) {
      const productOverrideWarning = result.warnings.find(
        (w) => w.includes('from the product were used instead')
      );

      if (productOverrideWarning) {
        // Check if the specific field we tried to change is in the warning
        const fieldLower = suggestion.field.toLowerCase();
        const warningLower = productOverrideWarning.toLowerCase();

        if (warningLower.includes(fieldLower)) {
          console.log(`[ListingOptimiserService] Product catalog override detected for "${suggestion.field}"`);

          // Return a failure result with a user-friendly message
          return {
            success: false,
            itemId: result.itemId,
            errorMessage: `Cannot update "${suggestion.field}" - this listing is linked to an eBay product catalog entry that defines this value. To change it, you would need to remove the product link on eBay first, which may affect your listing visibility.`,
            warnings: result.warnings,
          };
        }
      }
    }

    // Update last_updated_at and record applied suggestion if successful
    if (result.success) {
      const supabase = await createClient();

      // Update listing timestamp
      await supabase
        .from('platform_listings')
        .update({ last_updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('platform_item_id', itemId);

      // Record the applied suggestion so AI doesn't re-suggest similar changes
      await supabase
        .from('listing_applied_suggestions')
        .insert({
          user_id: userId,
          ebay_listing_id: itemId,
          category: suggestion.category,
          field: suggestion.field,
          original_value: suggestion.currentValue || null,
          applied_value: suggestion.suggestedValue,
        });

      console.log(`[ListingOptimiserService] Recorded applied suggestion: ${suggestion.category}/${suggestion.field}`);
    }

    return result;
  }

  /**
   * Apply changes to an inventory-based listing via the Inventory API
   *
   * Listings created via the Inventory API cannot be modified using the Trading API's
   * ReviseFixedPriceItem. Instead, we must:
   * - For title/itemSpecifics/conditionDescription: Update the inventory item
   * - For description: Update the offer
   */
  private async applyChangeViaInventoryApi(
    userId: string,
    itemId: string,
    suggestion: ListingSuggestion
  ): Promise<ReviseItemResult> {
    console.log(`[ListingOptimiserService] Applying change via Inventory API for ${itemId}`);

    // Get access token for Inventory API
    const accessToken = await this.ebayAuth.getAccessToken(userId);
    if (!accessToken) {
      return {
        success: false,
        itemId,
        errorMessage: 'Failed to get eBay access token',
      };
    }

    const adapter = new EbayApiAdapter({
      accessToken,
      marketplaceId: 'EBAY_GB',
      userId,
    });

    // Get the listing details to find the SKU
    const listing = await this.tradingClient!.getItem(itemId);
    const sku = listing.sku;

    if (!sku) {
      return {
        success: false,
        itemId,
        errorMessage: 'Cannot update inventory-based listing: SKU not found. Please update this listing directly on eBay.',
      };
    }

    console.log(`[ListingOptimiserService] Found SKU: ${sku} for listing ${itemId}`);

    try {
      // For description updates, update the inventory item's product description
      // Note: The Inventory API stores description on the inventory item, not the offer
      if (suggestion.category === 'description' || suggestion.category === 'seo') {
        console.log(`[ListingOptimiserService] Updating inventory item description for SKU: ${sku}`);

        // Get current inventory item
        const currentItem = await adapter.getInventoryItem(sku);

        // Update with new description
        const updatedItem: EbayInventoryItem = {
          ...currentItem,
          product: {
            ...currentItem.product,
            description: suggestion.suggestedValue,
          },
        };

        await adapter.createOrReplaceInventoryItem(sku, updatedItem);

        return {
          success: true,
          itemId,
          warnings: ['Updated via Inventory API. Changes may take a few minutes to appear on eBay.'],
        };
      }

      // For title, item specifics, and condition updates, update the inventory item
      const currentItem = await adapter.getInventoryItem(sku);

      switch (suggestion.category) {
        case 'title':
          currentItem.product.title = suggestion.suggestedValue;
          break;

        case 'itemSpecifics': {
          // Update aspects (item specifics)
          const aspects = currentItem.product.aspects || {};
          aspects[suggestion.field] = [suggestion.suggestedValue];
          currentItem.product.aspects = aspects;
          break;
        }

        case 'condition': {
          const fieldLower = suggestion.field.toLowerCase();
          if (fieldLower.includes('description') || fieldLower === 'conditiondescription') {
            currentItem.conditionDescription = suggestion.suggestedValue;
          } else {
            // Condition ID changes via Inventory API require mapping to enum values
            const lowerValue = suggestion.suggestedValue.toLowerCase();
            if (lowerValue.includes('new') && !lowerValue.includes('other')) {
              currentItem.condition = 'NEW';
            } else if (lowerValue.includes('new') && lowerValue.includes('other')) {
              currentItem.condition = 'NEW_OTHER';
            } else if (lowerValue.includes('used')) {
              currentItem.condition = 'USED_GOOD';
            }
          }
          break;
        }

        default:
          return {
            success: false,
            itemId,
            errorMessage: `Unsupported suggestion category for Inventory API: ${suggestion.category}`,
          };
      }

      // Apply the update
      await adapter.createOrReplaceInventoryItem(sku, currentItem);

      console.log(`[ListingOptimiserService] Successfully updated inventory item via Inventory API`);

      return {
        success: true,
        itemId,
        warnings: ['Updated via Inventory API. Changes may take a few minutes to appear on eBay.'],
      };
    } catch (error) {
      console.error(`[ListingOptimiserService] Inventory API update failed:`, error);
      return {
        success: false,
        itemId,
        errorMessage: error instanceof Error
          ? `Inventory API error: ${error.message}`
          : 'Failed to update listing via Inventory API',
      };
    }
  }

  /**
   * Run AI analysis on a listing
   */
  private async runAiAnalysis(
    listing: FullItemDetails,
    inventoryData?: {
      setNumber?: string;
      theme?: string;
      condition?: string;
      pieceCount?: number;
      hasBox?: boolean;
      hasInstructions?: boolean;
      costPrice?: number;
    },
    appliedSuggestions?: { category: string; field: string; applied_value: string; applied_at: string }[],
    template?: DescriptionTemplate,
    onProgress?: AnalysisProgressCallback
  ): Promise<ListingAnalysisResponse> {
    if (!this.isGeminiConfigured()) {
      throw new Error('Gemini API is not configured');
    }

    const client = getGeminiClient();
    const userMessage = createAnalyseListingMessage(listing, inventoryData, appliedSuggestions, template);

    onProgress?.('Sending to Gemini 2.5 Pro');

    // Retry logic for empty responses
    const maxRetries = 3;
    let responseText = '';
    let apiError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[ListingOptimiserService] Gemini API attempt ${attempt}/${maxRetries}`);

        const response = await client.models.generateContent({
          model: GEMINI_MODEL,
          contents: [
            {
              role: 'user',
              parts: [{ text: `${ANALYSE_LISTING_SYSTEM_PROMPT}\n\n${userMessage}` }],
            },
          ],
          config: {
            temperature: 0.3,
            maxOutputTokens: 8192, // Increased to prevent truncation of detailed analyses
          },
        });

        responseText = response.text || '';

        // Check if we got a valid response
        if (responseText && responseText.trim().length > 0) {
          console.log(`[ListingOptimiserService] Got response on attempt ${attempt}, length: ${responseText.length}`);

          // Check for potential truncation - response should end with valid JSON closure
          const trimmed = responseText.trim();
          const endsWithValidJson = trimmed.endsWith('}') || trimmed.endsWith(']');

          if (!endsWithValidJson) {
            console.warn(`[ListingOptimiserService] Response may be truncated - doesn't end with } or ], ends with: "${trimmed.slice(-20)}"`);
          }

          break;
        }

        console.warn(`[ListingOptimiserService] Empty response on attempt ${attempt}`);
        apiError = new Error('Empty response from Gemini API');

        // Wait before retrying (exponential backoff)
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
          console.log(`[ListingOptimiserService] Waiting ${delay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } catch (error) {
        apiError = error instanceof Error ? error : new Error(String(error));
        console.error(`[ListingOptimiserService] Gemini API error on attempt ${attempt}:`, apiError.message);

        // Wait before retrying
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // If we still have no response after all retries, throw
    if (!responseText || responseText.trim().length === 0) {
      console.error('[ListingOptimiserService] All Gemini API attempts failed with empty response');
      throw new Error(`Gemini API returned empty response after ${maxRetries} attempts: ${apiError?.message || 'Unknown error'}`);
    }

    onProgress?.('Parsing response');

    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[ListingOptimiserService] No JSON found in response:', responseText.substring(0, 500));
      throw new Error('Failed to parse AI response: no JSON found');
    }

    const jsonString = jsonMatch[0];

    // Helper function to fix common JSON issues from LLM responses
    const fixJsonString = (str: string): string => {
      // Step 1: Replace literal \n (backslash followed by n) with space
      // This handles cases where LLM outputs \n as two characters instead of actual newline
      let fixed = str.replace(/\\n/g, ' ');

      // Step 2: Replace actual newlines/tabs inside strings with spaces
      // We need to be careful to only replace inside string values, not structural newlines
      // Approach: Replace newlines/tabs that appear after a quote (inside strings)
      fixed = fixed.replace(/(?<="[^"]*)\r?\n(?=[^"]*")/g, ' ');
      fixed = fixed.replace(/(?<="[^"]*)\t(?=[^"]*")/g, ' ');

      // Step 3: Handle control characters that break JSON
      // eslint-disable-next-line no-control-regex
      fixed = fixed.replace(/[\x00-\x1F\x7F]/g, ' ');

      // Step 4: Remove trailing commas before ] or }
      fixed = fixed.replace(/,(\s*[\]}])/g, '$1');

      // Step 5: Collapse multiple spaces into single space
      fixed = fixed.replace(/\s+/g, ' ');

      return fixed;
    };

    // Try to parse with progressive fixes
    const attempts = [
      { name: 'raw', transform: (s: string) => s },
      { name: 'fixed', transform: fixJsonString },
      {
        name: 'aggressive',
        transform: (s: string) => {
          // Remove markdown code blocks first
          const cleaned = s
            .replace(/```json\s*/gi, '')
            .replace(/```\s*/gi, '')
            .trim();
          const start = cleaned.indexOf('{');
          const end = cleaned.lastIndexOf('}');
          if (start !== -1 && end > start) {
            return fixJsonString(cleaned.substring(start, end + 1));
          }
          return fixJsonString(s);
        }
      },
      {
        name: 'quotes-fix',
        transform: (s: string) => {
          // Fix smart quotes and other quote variants
          const fixed = s
            .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"') // smart double quotes
            .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'") // smart single quotes
            .replace(/'/g, "'"); // another variant
          return fixJsonString(fixed);
        }
      },
      {
        name: 'escape-quotes-in-strings',
        transform: (s: string) => {
          // More aggressive: try to fix unescaped quotes within string values
          // This is a common issue when AI includes quotes in suggestions
          let fixed = fixJsonString(s);

          // Try to match and fix strings with unescaped internal quotes
          // Pattern: find strings that have unbalanced quotes
          fixed = fixed.replace(/"suggestedValue"\s*:\s*"([^"]*)"([^,}\]]*)"([^"]*?)"/g,
            (match, p1, p2, p3) => {
              // Escape the internal quotes
              const combined = p1 + '\\"' + p2 + '\\"' + p3;
              return `"suggestedValue": "${combined}"`;
            });

          return fixed;
        }
      },
      {
        name: 'truncation-recovery',
        transform: (s: string) => {
          // Handle truncated JSON responses from LLM output limits
          // Try to complete the JSON structure if it's cut off mid-object
          let fixed = fixJsonString(s);

          // Check if the JSON appears truncated (doesn't end with })
          const trimmed = fixed.trim();
          if (!trimmed.endsWith('}')) {
            console.log('[ListingOptimiserService] Attempting to recover truncated JSON');

            // Find the last complete object/array and try to close it properly
            // Count open braces/brackets to determine what needs closing
            let braceCount = 0;
            let bracketCount = 0;
            let inString = false;

            for (let i = 0; i < fixed.length; i++) {
              const char = fixed[i];
              const prevChar = i > 0 ? fixed[i - 1] : '';

              // Track if we're inside a string
              if (char === '"' && prevChar !== '\\') {
                inString = !inString;
              }

              if (!inString) {
                if (char === '{') {
                  braceCount++;
                } else if (char === '}') {
                  braceCount--;
                } else if (char === '[') {
                  bracketCount++;
                } else if (char === ']') {
                  bracketCount--;
                }
              }
            }

            // If we're in a string, close it first
            if (inString) {
              fixed += '"';
            }

            // Close any remaining open structures
            // Add closing brackets for arrays
            while (bracketCount > 0) {
              fixed += ']';
              bracketCount--;
            }

            // Add closing braces for objects
            while (braceCount > 0) {
              fixed += '}';
              braceCount--;
            }

            console.log('[ListingOptimiserService] Recovered truncated JSON, added closures');
          }

          return fixed;
        }
      },
    ];

    let lastError: Error | null = null;

    for (const attempt of attempts) {
      try {
        const transformed = attempt.transform(jsonString);
        const parsed = JSON.parse(transformed) as ListingAnalysisResponse;
        if (attempt.name !== 'raw') {
          console.log(`[ListingOptimiserService] JSON parsed successfully with ${attempt.name} strategy`);
        }

        // Post-processing: Filter out invalid suggestions
        // eBay does NOT allow condition descriptions for New (1000) condition items
        if (parsed.suggestions && listing.conditionId === 1000) {
          const originalCount = parsed.suggestions.length;
          parsed.suggestions = parsed.suggestions.filter((s) => {
            const isConditionDescription =
              s.category === 'condition' &&
              s.field.toLowerCase().includes('conditiondescription');
            if (isConditionDescription) {
              console.log(
                '[ListingOptimiserService] Filtered out conditionDescription suggestion for New (1000) item - eBay does not allow this'
              );
            }
            return !isConditionDescription;
          });
          if (parsed.suggestions.length < originalCount) {
            console.log(
              `[ListingOptimiserService] Removed ${originalCount - parsed.suggestions.length} invalid conditionDescription suggestion(s)`
            );
          }
        }

        return parsed;
      } catch (error) {
        lastError = error as Error;
        if (attempt.name === 'raw') {
          console.log('[ListingOptimiserService] First JSON parse failed, attempting fixes...');
        }
      }
    }

    // All attempts failed - log detailed error info
    console.error('[ListingOptimiserService] All JSON parse attempts failed');
    console.error('[ListingOptimiserService] Last error:', lastError?.message);
    console.error('[ListingOptimiserService] JSON length:', jsonString.length);
    console.error('[ListingOptimiserService] JSON (first 500 chars):', jsonString.substring(0, 500));
    console.error('[ListingOptimiserService] JSON (last 500 chars):', jsonString.substring(Math.max(0, jsonString.length - 500)));

    // Try to identify the specific issue
    const errorMatch = lastError?.message.match(/position (\d+)/);
    if (errorMatch) {
      const pos = parseInt(errorMatch[1], 10);
      const context = jsonString.substring(Math.max(0, pos - 100), Math.min(jsonString.length, pos + 100));
      console.error(`[ListingOptimiserService] Error near position ${pos}:`, JSON.stringify(context));
    }

    throw new Error(`Failed to parse AI response: invalid JSON - ${lastError?.message || 'unknown error'}`);
  }

  /**
   * Save review to database
   */
  private async saveReview(
    userId: string,
    listingId: string,
    analysis: ListingAnalysisResponse,
    pricing: PricingAnalysisResult & {
      profitEstimate: number | null;
      profitMargin: number | null;
      costSource: 'inventory' | null;
    }
  ): Promise<string> {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('listing_quality_reviews')
      .insert({
        user_id: userId,
        ebay_listing_id: listingId,
        quality_score: analysis.score,
        quality_grade: analysis.grade,
        breakdown: analysis.breakdown as unknown as Json,
        suggestions: analysis.suggestions as unknown as Json,
        pricing_analysis: pricing as unknown as Json,
        reviewed_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      console.error('[ListingOptimiserService] Error saving review:', error);
      throw error;
    }

    return data.id;
  }

  /**
   * Extract set number from title
   */
  private extractSetNumber(title: string): string {
    // Try to find a 4-6 digit number that looks like a set number
    const match = title.match(/\b(\d{4,6})\b/);
    return match ? match[1] : '0';
  }

  /**
   * Map condition ID to simple condition
   */
  private mapConditionToSimple(conditionId: number | null): 'New' | 'Used' {
    if (!conditionId) return 'New';
    // 1000 = New, 1500 = New Other
    return conditionId <= 1500 ? 'New' : 'Used';
  }

  /**
   * Check if a listing is for a LEGO item based on title, category, or item specifics
   */
  private isLegoListing(listing: FullItemDetails): boolean {
    // Check title
    const titleLower = listing.title.toLowerCase();
    if (titleLower.includes('lego')) {
      return true;
    }

    // Check category - LEGO categories are under 19006, 183448, 183447
    const legoCategories = ['19006', '183448', '183447'];
    if (legoCategories.includes(String(listing.categoryId))) {
      return true;
    }

    // Check item specifics for Brand = LEGO
    const brandSpecific = listing.itemSpecifics.find(
      (spec) => spec.name.toLowerCase() === 'brand'
    );
    if (brandSpecific && brandSpecific.value.toLowerCase() === 'lego') {
      return true;
    }

    return false;
  }

  /**
   * Get the latest review for a listing
   */
  async getLatestReview(
    userId: string,
    listingId: string
  ): Promise<{
    id: string;
    analysis: ListingAnalysisResponse;
    pricing: PricingAnalysisResult;
    reviewedAt: string;
  } | null> {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('listing_quality_reviews')
      .select('id, quality_score, quality_grade, breakdown, suggestions, pricing_analysis, reviewed_at')
      .eq('user_id', userId)
      .eq('ebay_listing_id', listingId)
      .order('reviewed_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return null;
    }

    // Type-safe conversion of JSON columns
    const breakdown = data.breakdown as unknown as {
      title: CategoryBreakdown;
      itemSpecifics: CategoryBreakdown;
      description: CategoryBreakdown;
      conditionAccuracy: CategoryBreakdown;
      seoOptimization: CategoryBreakdown;
    };

    const suggestions = (data.suggestions || []) as unknown as ListingSuggestion[];
    const pricingAnalysis = data.pricing_analysis as unknown as PricingAnalysisResult;

    return {
      id: data.id,
      analysis: {
        score: data.quality_score,
        grade: data.quality_grade as ListingAnalysisResponse['grade'],
        breakdown,
        suggestions,
        highlights: [],
        criticalIssues: [],
      },
      pricing: pricingAnalysis,
      reviewedAt: data.reviewed_at,
    };
  }
}

// Singleton instance
let serviceInstance: ListingOptimiserService | null = null;

/**
 * Get the listing optimiser service instance
 */
export function getListingOptimiserService(): ListingOptimiserService {
  if (!serviceInstance) {
    serviceInstance = new ListingOptimiserService();
  }
  return serviceInstance;
}
