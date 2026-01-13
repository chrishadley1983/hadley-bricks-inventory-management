/**
 * Purchase Evaluator Service
 *
 * Main service for managing purchase evaluations, coordinating
 * lookups across Brickset, Amazon, and eBay.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import type {
  PurchaseEvaluation,
  EvaluationItem,
  CreateEvaluationRequest,
  UpdateEvaluationRequest,
  UpdateItemRequest,
  LookupProgress,
  CostAllocationMethod,
  AlternativeAsin,
} from './types';
import {
  allocateCostsByBuyBox,
  allocateCostsEqually,
  calculateItemProfitability,
  calculateEvaluationSummary,
} from './calculations';
import { BricksetCacheService } from '../brickset';
import { createAmazonCatalogClient, createAmazonPricingClient } from '../amazon';
import type { AmazonCredentials } from '../amazon';
import { getEbayBrowseClient, getEbayFindingClient } from '../ebay';
import { CredentialsRepository } from '../repositories';

// ============================================
// Type Imports
// ============================================

type PurchaseEvaluationRow = Database['public']['Tables']['purchase_evaluations']['Row'];
type PurchaseEvaluationItemRow = Database['public']['Tables']['purchase_evaluation_items']['Row'];
type PurchaseEvaluationInsert = Database['public']['Tables']['purchase_evaluations']['Insert'];
type PurchaseEvaluationItemInsert = Database['public']['Tables']['purchase_evaluation_items']['Insert'];

// ============================================
// Row Mapping Functions
// ============================================

function mapEvaluationRow(row: PurchaseEvaluationRow): PurchaseEvaluation {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    source: row.source,
    defaultPlatform: (row.default_platform as 'amazon' | 'ebay') || 'amazon',
    totalPurchasePrice: row.total_purchase_price,
    costAllocationMethod: row.cost_allocation_method as CostAllocationMethod | null,
    itemCount: row.item_count ?? 0,
    totalCost: row.total_cost,
    totalExpectedRevenue: row.total_expected_revenue,
    overallMarginPercent: row.overall_margin_percent,
    overallRoiPercent: row.overall_roi_percent,
    status: (row.status as 'draft' | 'in_progress' | 'completed' | 'saved' | 'converted') || 'draft',
    lookupCompletedAt: row.lookup_completed_at,
    // Conversion tracking - these columns may not exist in DB yet until migration is applied
    convertedAt: (row as Record<string, unknown>).converted_at as string | null ?? null,
    convertedPurchaseId: (row as Record<string, unknown>).converted_purchase_id as string | null ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapItemRow(row: PurchaseEvaluationItemRow): EvaluationItem {
  return {
    id: row.id,
    evaluationId: row.evaluation_id,
    setNumber: row.set_number,
    setName: row.set_name,
    condition: (row.condition as 'New' | 'Used') || 'New',
    quantity: row.quantity ?? 1,
    unitCost: row.unit_cost,
    allocatedCost: row.allocated_cost,
    bricksetSetId: row.brickset_set_id,
    ukRetailPrice: row.uk_retail_price,
    ean: row.ean,
    upc: row.upc,
    imageUrl: row.image_url,
    targetPlatform: (row.target_platform as 'amazon' | 'ebay') || 'amazon',
    amazonAsin: row.amazon_asin,
    amazonAsinSource: row.amazon_asin_source as 'ean_lookup' | 'upc_lookup' | 'keyword_search' | 'manual' | null,
    amazonAsinConfidence: row.amazon_asin_confidence as 'exact' | 'probable' | 'manual' | 'multiple' | null,
    amazonAlternativeAsins: row.amazon_alternative_asins as AlternativeAsin[] | null,
    amazonBuyBoxPrice: row.amazon_buy_box_price,
    amazonMyPrice: row.amazon_my_price,
    amazonWasPrice: row.amazon_was_price,
    amazonOfferCount: row.amazon_offer_count,
    amazonSalesRank: row.amazon_sales_rank,
    amazonLookupStatus: (row.amazon_lookup_status as 'pending' | 'found' | 'not_found' | 'multiple' | 'error') || 'pending',
    amazonLookupError: row.amazon_lookup_error,
    ebayMinPrice: row.ebay_min_price,
    ebayAvgPrice: row.ebay_avg_price,
    ebayMaxPrice: row.ebay_max_price,
    ebayListingCount: row.ebay_listing_count,
    ebaySoldMinPrice: row.ebay_sold_min_price,
    ebaySoldAvgPrice: row.ebay_sold_avg_price,
    ebaySoldMaxPrice: row.ebay_sold_max_price,
    ebaySoldCount: row.ebay_sold_count,
    ebayLookupStatus: (row.ebay_lookup_status as 'pending' | 'found' | 'not_found' | 'error') || 'pending',
    ebayLookupError: row.ebay_lookup_error,
    expectedSellPrice: row.expected_sell_price,
    cogPercent: row.cog_percent,
    grossProfit: row.gross_profit,
    profitMarginPercent: row.profit_margin_percent,
    roiPercent: row.roi_percent,
    userSellPriceOverride: row.user_sell_price_override,
    userNotes: row.user_notes,
    needsReview: row.needs_review ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================
// Service Class
// ============================================

export class PurchaseEvaluatorService {
  constructor(private supabase: SupabaseClient<Database>) {}

  // ==========================================
  // CRUD Operations
  // ==========================================

  /**
   * Create a new evaluation with items
   */
  async createEvaluation(
    userId: string,
    request: CreateEvaluationRequest
  ): Promise<PurchaseEvaluation> {
    // Create evaluation record
    const evaluationInsert: PurchaseEvaluationInsert = {
      user_id: userId,
      name: request.name || `Evaluation ${new Date().toLocaleDateString()}`,
      source: request.source,
      default_platform: request.defaultPlatform,
      total_purchase_price: request.totalPurchasePrice ?? null,
      cost_allocation_method: request.costAllocationMethod ?? 'per_item',
      item_count: request.items.length,
      status: 'draft',
    };

    const { data: evaluation, error: evalError } = await this.supabase
      .from('purchase_evaluations')
      .insert(evaluationInsert)
      .select()
      .single();

    if (evalError || !evaluation) {
      throw new Error(`Failed to create evaluation: ${evalError?.message}`);
    }

    // Create item records
    const itemInserts: PurchaseEvaluationItemInsert[] = request.items.map((item) => ({
      evaluation_id: evaluation.id,
      set_number: item.setNumber,
      set_name: item.setName ?? null,
      condition: item.condition,
      quantity: item.quantity ?? 1,
      unit_cost: item.cost ?? null,
      target_platform: request.defaultPlatform,
    }));

    const { error: itemsError } = await this.supabase
      .from('purchase_evaluation_items')
      .insert(itemInserts);

    if (itemsError) {
      // Clean up evaluation if items fail
      await this.supabase.from('purchase_evaluations').delete().eq('id', evaluation.id);
      throw new Error(`Failed to create items: ${itemsError.message}`);
    }

    return mapEvaluationRow(evaluation);
  }

  /**
   * Get all evaluations for a user
   */
  async getEvaluations(userId: string): Promise<PurchaseEvaluation[]> {
    const { data, error } = await this.supabase
      .from('purchase_evaluations')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch evaluations: ${error.message}`);
    }

    return (data || []).map(mapEvaluationRow);
  }

  /**
   * Get a single evaluation with items
   */
  async getEvaluation(userId: string, evaluationId: string): Promise<PurchaseEvaluation | null> {
    const { data: evaluation, error: evalError } = await this.supabase
      .from('purchase_evaluations')
      .select('*')
      .eq('id', evaluationId)
      .eq('user_id', userId)
      .single();

    if (evalError || !evaluation) {
      return null;
    }

    const { data: items, error: itemsError } = await this.supabase
      .from('purchase_evaluation_items')
      .select('*')
      .eq('evaluation_id', evaluationId)
      .order('created_at', { ascending: true });

    if (itemsError) {
      throw new Error(`Failed to fetch items: ${itemsError.message}`);
    }

    const result = mapEvaluationRow(evaluation);
    result.items = (items || []).map(mapItemRow);

    return result;
  }

  /**
   * Update evaluation metadata
   */
  async updateEvaluation(
    userId: string,
    evaluationId: string,
    updates: UpdateEvaluationRequest
  ): Promise<PurchaseEvaluation> {
    const updateData: Partial<PurchaseEvaluationRow> = {};

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.defaultPlatform !== undefined) updateData.default_platform = updates.defaultPlatform;
    if (updates.totalPurchasePrice !== undefined) updateData.total_purchase_price = updates.totalPurchasePrice;
    if (updates.costAllocationMethod !== undefined) updateData.cost_allocation_method = updates.costAllocationMethod;
    if (updates.status !== undefined) updateData.status = updates.status;

    const { data, error } = await this.supabase
      .from('purchase_evaluations')
      .update(updateData)
      .eq('id', evaluationId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to update evaluation: ${error?.message}`);
    }

    return mapEvaluationRow(data);
  }

  /**
   * Delete an evaluation and its items
   */
  async deleteEvaluation(userId: string, evaluationId: string): Promise<void> {
    const { error } = await this.supabase
      .from('purchase_evaluations')
      .delete()
      .eq('id', evaluationId)
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to delete evaluation: ${error.message}`);
    }
  }

  /**
   * Update a single item
   */
  async updateItem(
    userId: string,
    itemId: string,
    updates: UpdateItemRequest
  ): Promise<EvaluationItem> {
    // First verify the item belongs to user's evaluation
    const { data: item, error: checkError } = await this.supabase
      .from('purchase_evaluation_items')
      .select('evaluation_id')
      .eq('id', itemId)
      .single();

    if (checkError || !item) {
      throw new Error('Item not found');
    }

    // Verify evaluation ownership
    const { data: evaluation } = await this.supabase
      .from('purchase_evaluations')
      .select('id')
      .eq('id', item.evaluation_id)
      .eq('user_id', userId)
      .single();

    if (!evaluation) {
      throw new Error('Unauthorized');
    }

    // Update item
    const updateData: Partial<PurchaseEvaluationItemRow> = {};

    if (updates.targetPlatform !== undefined) updateData.target_platform = updates.targetPlatform;
    if (updates.amazonAsin !== undefined) {
      updateData.amazon_asin = updates.amazonAsin;
      updateData.amazon_asin_source = 'manual';
      updateData.amazon_asin_confidence = 'manual';
      // Clear needs_review when ASIN is manually selected
      updateData.needs_review = false;
      // Update Amazon lookup status to reflect manual selection
      updateData.amazon_lookup_status = 'found';
      updateData.amazon_lookup_error = null;
    }
    if (updates.allocatedCost !== undefined) updateData.allocated_cost = updates.allocatedCost;
    if (updates.userSellPriceOverride !== undefined) {
      updateData.user_sell_price_override = updates.userSellPriceOverride;
      // When user sets a manual price, clear the needs_review flag
      // and update the lookup status based on target platform
      if (updates.userSellPriceOverride !== null && updates.userSellPriceOverride > 0) {
        updateData.needs_review = false;
      }
    }
    if (updates.userNotes !== undefined) updateData.user_notes = updates.userNotes;

    const { data, error } = await this.supabase
      .from('purchase_evaluation_items')
      .update(updateData)
      .eq('id', itemId)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to update item: ${error?.message}`);
    }

    return mapItemRow(data);
  }

  // ==========================================
  // Cost Allocation
  // ==========================================

  /**
   * Allocate costs to items based on method
   *
   * For 'proportional' method, uses Amazon Buy Box price (or Was Price fallback).
   * Items without Amazon pricing get £0 allocated - user can override manually.
   */
  async allocateCosts(
    userId: string,
    evaluationId: string,
    method: CostAllocationMethod,
    totalPurchasePrice?: number
  ): Promise<void> {
    // Get evaluation with fresh data (including Amazon prices)
    const evaluation = await this.getEvaluation(userId, evaluationId);
    if (!evaluation || !evaluation.items) {
      throw new Error('Evaluation not found');
    }

    // If per_item, just use unit costs - no allocation needed
    if (method === 'per_item') {
      for (const item of evaluation.items) {
        await this.supabase
          .from('purchase_evaluation_items')
          .update({ allocated_cost: item.unitCost })
          .eq('id', item.id);
      }
      return;
    }

    const total = totalPurchasePrice ?? evaluation.totalPurchasePrice;
    if (!total || total <= 0) {
      throw new Error('Total purchase price required for proportional/equal allocation');
    }

    // Calculate allocations
    let allocations: number[];

    if (method === 'proportional') {
      // Use Buy Box price (or Was Price fallback, or user override) for proportional allocation
      allocations = allocateCostsByBuyBox(
        evaluation.items.map((item) => ({
          amazonBuyBoxPrice: item.amazonBuyBoxPrice,
          amazonWasPrice: item.amazonWasPrice,
          userSellPriceOverride: item.userSellPriceOverride,
          quantity: item.quantity,
        })),
        total
      );
    } else {
      allocations = allocateCostsEqually(
        evaluation.items.map((item) => ({ quantity: item.quantity })),
        total
      );
    }

    // Update items with allocated costs
    for (let i = 0; i < evaluation.items.length; i++) {
      await this.supabase
        .from('purchase_evaluation_items')
        .update({ allocated_cost: allocations[i] })
        .eq('id', evaluation.items[i].id);
    }

    // Update evaluation with method and total
    await this.supabase
      .from('purchase_evaluations')
      .update({
        cost_allocation_method: method,
        total_purchase_price: total,
      })
      .eq('id', evaluationId);
  }

  // ==========================================
  // Lookup Orchestration
  // ==========================================

  /**
   * Run all lookups for an evaluation
   *
   * This is the main orchestration method that:
   * 1. Looks up Brickset data (EAN/UPC, RRP)
   * 2. Looks up Amazon pricing (ASIN, Buy Box, Was Price)
   * 3. Looks up eBay pricing (Active and Sold listings)
   * 4. Calculates profitability for all items
   */
  async runLookups(
    userId: string,
    evaluationId: string,
    onProgress?: (progress: LookupProgress) => void
  ): Promise<void> {
    const emitProgress = (progress: LookupProgress) => {
      if (onProgress) onProgress(progress);
    };

    // Get evaluation with items
    const evaluation = await this.getEvaluation(userId, evaluationId);
    if (!evaluation || !evaluation.items) {
      throw new Error('Evaluation not found');
    }

    // Update status to in_progress
    await this.supabase
      .from('purchase_evaluations')
      .update({ status: 'in_progress' })
      .eq('id', evaluationId);

    const items = evaluation.items;
    const total = items.length;

    emitProgress({ type: 'start', total });

    try {
      // Phase 1: Brickset lookups
      emitProgress({ type: 'progress', phase: 'brickset', processed: 0, total, percent: 0 });
      await this.runBricksetLookups(userId, items, (processed) => {
        emitProgress({
          type: 'progress',
          phase: 'brickset',
          processed,
          total,
          percent: Math.round((processed / total) * 100),
          currentItem: items[processed - 1]?.setNumber,
        });
      });
      emitProgress({ type: 'phase_complete', phase: 'brickset' });

      // Phase 2: Amazon lookups
      emitProgress({ type: 'progress', phase: 'amazon', processed: 0, total, percent: 0 });
      await this.runAmazonLookups(userId, evaluationId, (processed) => {
        emitProgress({
          type: 'progress',
          phase: 'amazon',
          processed,
          total,
          percent: Math.round((processed / total) * 100),
          currentItem: items[processed - 1]?.setNumber,
        });
      });
      emitProgress({ type: 'phase_complete', phase: 'amazon' });

      // Allocate costs after Amazon lookup (uses Buy Box / Was Price)
      if (evaluation.costAllocationMethod === 'proportional' && evaluation.totalPurchasePrice) {
        await this.allocateCosts(userId, evaluationId, 'proportional', evaluation.totalPurchasePrice);
      }

      // Phase 3: eBay lookups
      emitProgress({ type: 'progress', phase: 'ebay', processed: 0, total, percent: 0 });
      await this.runEbayLookups(evaluationId, (processed) => {
        emitProgress({
          type: 'progress',
          phase: 'ebay',
          processed,
          total,
          percent: Math.round((processed / total) * 100),
          currentItem: items[processed - 1]?.setNumber,
        });
      });
      emitProgress({ type: 'phase_complete', phase: 'ebay' });

      // Phase 4: Calculate profitability
      await this.calculateProfitability(userId, evaluationId);

      // Update evaluation summary
      await this.updateEvaluationSummary(userId, evaluationId);

      // Mark as completed
      await this.supabase
        .from('purchase_evaluations')
        .update({
          status: 'completed',
          lookup_completed_at: new Date().toISOString(),
        })
        .eq('id', evaluationId);

      emitProgress({ type: 'complete' });
    } catch (error) {
      emitProgress({
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Run Brickset lookups for all items
   */
  private async runBricksetLookups(
    userId: string,
    items: EvaluationItem[],
    onProgress: (processed: number) => void
  ): Promise<void> {
    const bricksetCache = new BricksetCacheService(this.supabase);
    const { BricksetCredentialsService } = await import('../services/brickset-credentials.service');
    const bricksetCredService = new BricksetCredentialsService(this.supabase);

    // Get Brickset API key
    const bricksetCreds = await bricksetCredService.getCredentials(userId);
    const apiKey = bricksetCreds?.apiKey;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      try {
        // Look up set in Brickset
        const set = apiKey
          ? await bricksetCache.getSet(item.setNumber, apiKey)
          : null;

        if (set) {
          await this.supabase
            .from('purchase_evaluation_items')
            .update({
              set_name: set.setName,
              brickset_set_id: set.id,
              uk_retail_price: set.ukRetailPrice,
              ean: set.ean,
              upc: set.upc,
              image_url: set.imageUrl,
            })
            .eq('id', item.id);
        }
      } catch (error) {
        console.error(`Brickset lookup failed for ${item.setNumber}:`, error);
      }

      onProgress(i + 1);
    }
  }

  /**
   * Run Amazon lookups for all items
   *
   * Uses a two-phase approach to respect Amazon SP-API rate limits:
   * 1. Phase 1: Catalog lookups (ASIN discovery) - one at a time with delays
   * 2. Phase 2: Batch pricing lookups for all found ASINs
   *
   * Rate limits:
   * - Catalog API: 2 req/sec burst, 1 req/sec sustained
   * - Pricing API v0: ~0.5 req/sec sustained
   * - Pricing API v2022-05-01 batch: ~0.033 req/sec (30s between batches)
   */
  private async runAmazonLookups(
    userId: string,
    evaluationId: string,
    onProgress: (processed: number) => void
  ): Promise<void> {
    // Get Amazon credentials
    const credentialsRepo = new CredentialsRepository(this.supabase);
    const credentials = await credentialsRepo.getCredentials<AmazonCredentials>(userId, 'amazon');

    if (!credentials) {
      console.log('No Amazon credentials found, skipping Amazon lookups');
      return;
    }

    const catalogClient = createAmazonCatalogClient(credentials);
    const pricingClient = createAmazonPricingClient(credentials);

    // Get items
    const { data: items } = await this.supabase
      .from('purchase_evaluation_items')
      .select('*')
      .eq('evaluation_id', evaluationId);

    if (!items) return;

    // Delay helper - Amazon Catalog API needs ~1.5s between calls to stay under rate limit
    const catalogDelay = () => new Promise((resolve) => setTimeout(resolve, 1500));

    // Phase 1: ASIN Discovery - one item at a time with rate limiting
    const asinMap = new Map<string, { itemId: string; asin: string }>();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const updates: Partial<PurchaseEvaluationItemRow> = {};

      try {
        let asin: string | null = null;
        let asinSource: string | null = null;
        let asinConfidence: string | null = null;
        let alternatives: AlternativeAsin[] = [];

        // Try EAN first (most reliable)
        if (item.ean) {
          const result = await catalogClient.searchCatalogByIdentifier(item.ean, 'EAN');
          await catalogDelay();

          if (result.items.length === 1) {
            asin = result.items[0].asin;
            asinSource = 'ean_lookup';
            asinConfidence = 'exact';
          } else if (result.items.length > 1) {
            asin = result.items[0].asin;
            asinSource = 'ean_lookup';
            asinConfidence = 'multiple';
            alternatives = result.items.slice(1).map((r) => ({
              asin: r.asin,
              title: r.title || '',
              imageUrl: r.imageUrl,
              confidence: 0.8,
            }));
          }
        }

        // Try UPC if no EAN result
        if (!asin && item.upc) {
          const result = await catalogClient.searchCatalogByIdentifier(item.upc, 'UPC');
          await catalogDelay();

          if (result.items.length === 1) {
            asin = result.items[0].asin;
            asinSource = 'upc_lookup';
            asinConfidence = 'exact';
          } else if (result.items.length > 1) {
            asin = result.items[0].asin;
            asinSource = 'upc_lookup';
            asinConfidence = 'multiple';
            alternatives = result.items.slice(1).map((r) => ({
              asin: r.asin,
              title: r.title || '',
              imageUrl: r.imageUrl,
              confidence: 0.7,
            }));
          }
        }

        // Fallback to keyword search (least reliable, skip if we have EAN/UPC attempts)
        if (!asin && !item.ean && !item.upc) {
          const keywords = `LEGO ${item.set_number}`;
          const result = await catalogClient.searchCatalogByKeywords(keywords);
          await catalogDelay();

          if (result.items.length === 1) {
            asin = result.items[0].asin;
            asinSource = 'keyword_search';
            asinConfidence = 'probable';
          } else if (result.items.length > 1) {
            asin = result.items[0].asin;
            asinSource = 'keyword_search';
            asinConfidence = 'multiple';
            alternatives = result.items.slice(1, 5).map((r) => ({
              asin: r.asin,
              title: r.title || '',
              imageUrl: r.imageUrl,
              confidence: 0.5,
            }));
          }
        }

        if (asin) {
          updates.amazon_asin = asin;
          updates.amazon_asin_source = asinSource;
          updates.amazon_asin_confidence = asinConfidence;
          updates.amazon_alternative_asins = alternatives.length > 0 ? JSON.parse(JSON.stringify(alternatives)) : null;
          updates.needs_review = asinConfidence === 'multiple';
          updates.amazon_lookup_status = 'found';

          // Store for batch pricing lookup
          asinMap.set(item.id, { itemId: item.id, asin });
        } else {
          updates.amazon_lookup_status = 'not_found';
        }
      } catch (error) {
        console.error(`Amazon ASIN lookup failed for ${item.set_number}:`, error);
        updates.amazon_lookup_status = 'error';
        updates.amazon_lookup_error = error instanceof Error ? error.message : 'Unknown error';
      }

      // Update item with ASIN data
      await this.supabase
        .from('purchase_evaluation_items')
        .update(updates)
        .eq('id', item.id);

      onProgress(i + 1);
    }

    // Phase 2: Batch pricing lookups for all found ASINs
    // This is more efficient and respects rate limits better
    if (asinMap.size > 0) {
      console.log(`[PurchaseEvaluator] Fetching pricing for ${asinMap.size} ASINs in batch...`);

      const asinEntries = Array.from(asinMap.values());
      const asins = asinEntries.map((e) => e.asin);

      try {
        // Get competitive pricing (v0 API - handles batching internally with proper delays)
        const pricingData = await pricingClient.getCompetitivePricing(asins);

        // Map pricing data to items
        const pricingByAsin = new Map(pricingData.map((p) => [p.asin, p]));

        for (const entry of asinEntries) {
          const pricing = pricingByAsin.get(entry.asin);
          if (pricing) {
            await this.supabase
              .from('purchase_evaluation_items')
              .update({
                amazon_buy_box_price: pricing.buyBoxPrice ?? null,
                amazon_offer_count: (pricing.newOfferCount ?? 0) + (pricing.usedOfferCount ?? 0),
                amazon_sales_rank: pricing.salesRank ?? null,
                amazon_my_price: pricing.yourPrice ?? null,
              })
              .eq('id', entry.itemId);
          }
        }

        // Get competitive summary for wasPrice (much slower API - 35s between batches)
        // Only do this if we have a small number of ASINs to avoid very long waits
        if (asins.length <= 20) {
          console.log(`[PurchaseEvaluator] Fetching competitive summary (wasPrice) for ${asins.length} ASINs...`);
          const summaryData = await pricingClient.getCompetitiveSummary(asins);

          const summaryByAsin = new Map(summaryData.map((s) => [s.asin, s]));

          for (const entry of asinEntries) {
            const summary = summaryByAsin.get(entry.asin);
            if (summary?.wasPrice) {
              await this.supabase
                .from('purchase_evaluation_items')
                .update({ amazon_was_price: summary.wasPrice })
                .eq('id', entry.itemId);
            }
          }
        } else {
          console.log(`[PurchaseEvaluator] Skipping competitive summary (${asins.length} ASINs would take too long)`);
        }
      } catch (error) {
        console.error('[PurchaseEvaluator] Batch pricing lookup failed:', error);
        // Don't fail the whole process, we still have ASIN data
      }
    }
  }

  /**
   * Run eBay lookups for all items
   */
  private async runEbayLookups(
    evaluationId: string,
    onProgress: (processed: number) => void
  ): Promise<void> {
    const browseClient = getEbayBrowseClient();
    const findingClient = getEbayFindingClient();

    // Helper to add delay between API calls to avoid rate limiting
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    // Get items
    const { data: items } = await this.supabase
      .from('purchase_evaluation_items')
      .select('*')
      .eq('evaluation_id', evaluationId);

    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const updates: Partial<PurchaseEvaluationItemRow> = {};
      const condition = item.condition === 'New' ? 'New' : 'Used';

      try {
        // Get active listings (Browse API)
        const activeResults =
          condition === 'New'
            ? await browseClient.searchLegoSet(item.set_number)
            : await browseClient.searchLegoSetUsed(item.set_number);

        if (activeResults.itemSummaries && activeResults.itemSummaries.length > 0) {
          const prices = activeResults.itemSummaries.map((listing) => {
            const price = parseFloat(listing.price?.value || '0');
            const shipping = parseFloat(listing.shippingOptions?.[0]?.shippingCost?.value || '0');
            return price + shipping;
          }).filter((p) => p > 0);

          if (prices.length > 0) {
            updates.ebay_min_price = Math.min(...prices);
            updates.ebay_max_price = Math.max(...prices);
            updates.ebay_avg_price = prices.reduce((a, b) => a + b, 0) / prices.length;
            updates.ebay_listing_count = prices.length;
          }
        }

        // Add delay before Finding API call to avoid rate limiting
        // eBay Finding API has stricter rate limits than Browse API
        await delay(1500);

        // Get sold listings (Finding API)
        const soldResults = await findingClient.findCompletedItems(
          item.set_number,
          condition,
          30
        );

        if (soldResults.soldCount > 0) {
          updates.ebay_sold_min_price = soldResults.minPrice;
          updates.ebay_sold_avg_price = soldResults.avgPrice;
          updates.ebay_sold_max_price = soldResults.maxPrice;
          updates.ebay_sold_count = soldResults.soldCount;
          updates.ebay_sold_listings_json = soldResults.listings;
        }

        // Handle rate limited responses gracefully
        if (soldResults.rateLimited) {
          updates.ebay_lookup_status = 'error';
          updates.ebay_lookup_error = 'eBay API rate limit exceeded - try again later';
        } else {
          updates.ebay_lookup_status =
            (updates.ebay_listing_count ?? 0) > 0 || (updates.ebay_sold_count ?? 0) > 0
              ? 'found'
              : 'not_found';
        }
      } catch (error) {
        console.error(`eBay lookup failed for ${item.set_number}:`, error);
        updates.ebay_lookup_status = 'error';
        updates.ebay_lookup_error = error instanceof Error ? error.message : 'Unknown error';
      }

      await this.supabase
        .from('purchase_evaluation_items')
        .update(updates)
        .eq('id', item.id);

      onProgress(i + 1);
    }
  }

  /**
   * Calculate profitability for all items
   */
  async calculateProfitability(userId: string, evaluationId: string): Promise<void> {
    // Get items
    const { data: items } = await this.supabase
      .from('purchase_evaluation_items')
      .select('*')
      .eq('evaluation_id', evaluationId);

    if (!items) return;

    for (const item of items) {
      const profitability = calculateItemProfitability({
        targetPlatform: (item.target_platform as 'amazon' | 'ebay') || 'amazon',
        allocatedCost: item.allocated_cost,
        unitCost: item.unit_cost,
        amazonBuyBoxPrice: item.amazon_buy_box_price,
        amazonWasPrice: item.amazon_was_price,
        ebaySoldAvgPrice: item.ebay_sold_avg_price,
        ebayAvgPrice: item.ebay_avg_price,
        userSellPriceOverride: item.user_sell_price_override,
      });

      if (profitability) {
        await this.supabase
          .from('purchase_evaluation_items')
          .update({
            expected_sell_price: profitability.expectedSellPrice,
            cog_percent: profitability.cogPercent,
            gross_profit: profitability.grossProfit,
            profit_margin_percent: profitability.profitMarginPercent,
            roi_percent: profitability.roiPercent,
          })
          .eq('id', item.id);
      }
    }
  }

  /**
   * Update evaluation summary statistics
   * Call this after modifying item costs or prices to refresh totals
   */
  async updateEvaluationSummary(userId: string, evaluationId: string): Promise<void> {
    const evaluation = await this.getEvaluation(userId, evaluationId);
    if (!evaluation || !evaluation.items) return;

    const summary = calculateEvaluationSummary(evaluation.items);

    await this.supabase
      .from('purchase_evaluations')
      .update({
        item_count: summary.itemCount,
        total_cost: summary.totalCost,
        total_expected_revenue: summary.totalExpectedRevenue,
        overall_margin_percent: summary.overallMarginPercent,
        overall_roi_percent: summary.overallRoiPercent,
      })
      .eq('id', evaluationId);
  }
}
