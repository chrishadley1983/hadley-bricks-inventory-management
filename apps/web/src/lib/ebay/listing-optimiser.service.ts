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

    // Transform to OptimiserListing
    const now = new Date();
    const transformed: OptimiserListing[] = (listings || []).map((listing) => {
      const ebayData = listing.ebay_data as Record<string, unknown> || {};
      const createdAt = new Date(listing.created_at);
      const listingAge = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));

      const sku = ebayData.sku as string | undefined;
      const inventoryData = sku ? skuToInventoryMap[sku] : null;

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

    // 3. Run AI analysis
    log('Starting AI analysis');
    const analysis = await this.runAiAnalysis(listingDetails, inventoryData, onProgress);
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

    switch (suggestion.category) {
      case 'title':
        request.title = suggestion.suggestedValue;
        break;
      case 'description':
        request.description = suggestion.suggestedValue;
        break;
      case 'itemSpecifics':
        // Parse as single item specific
        request.itemSpecifics = [
          { name: suggestion.field, value: suggestion.suggestedValue },
        ];
        break;
      case 'condition':
        // Parse condition ID from suggested value (e.g., "1000 (New)")
        const conditionMatch = suggestion.suggestedValue.match(/^(\d+)/);
        if (conditionMatch) {
          request.conditionId = parseInt(conditionMatch[1], 10);
        }
        break;
      default:
        throw new Error(`Unsupported suggestion category: ${suggestion.category}`);
    }

    console.log(`[ListingOptimiserService] Applying change to ${itemId}:`, request);

    // Call ReviseItem API
    const result = await this.tradingClient!.reviseFixedPriceItem(request);

    // Update last_updated_at if successful
    if (result.success) {
      const supabase = await createClient();
      await supabase
        .from('platform_listings')
        .update({ last_updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('platform_item_id', itemId);
    }

    return result;
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
    onProgress?: AnalysisProgressCallback
  ): Promise<ListingAnalysisResponse> {
    if (!this.isGeminiConfigured()) {
      throw new Error('Gemini API is not configured');
    }

    const client = getGeminiClient();
    const userMessage = createAnalyseListingMessage(listing, inventoryData);

    onProgress?.('Sending to Gemini 3 Pro');

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
        maxOutputTokens: 4096,
      },
    });

    const responseText = response.text || '';
    onProgress?.('Parsing response');

    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to parse AI response: no JSON found');
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as ListingAnalysisResponse;
      return parsed;
    } catch (error) {
      console.error('[ListingOptimiserService] JSON parse error:', error);
      throw new Error('Failed to parse AI response: invalid JSON');
    }
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
