import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PurchaseEvaluatorService } from '../evaluator.service';
import type { SupabaseClient } from '@supabase/supabase-js';

// Mock Supabase client with chainable methods
function createMockSupabaseClient() {
  // Create a chainable mock that returns itself for method chaining
  const createChainableMock = () => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};

    chain.select = vi.fn().mockReturnValue(chain);
    chain.insert = vi.fn().mockReturnValue(chain);
    chain.update = vi.fn().mockReturnValue(chain);
    chain.delete = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    chain.single = vi.fn();

    return chain;
  };

  const mockChain = createChainableMock();

  return {
    from: vi.fn().mockReturnValue(mockChain),
    auth: {
      getUser: vi.fn(),
    },
    _mockChain: mockChain,
    _createChain: createChainableMock,
  };
}

// Mock the external dependencies
vi.mock('../calculations', () => ({
  allocateCostsByBuyBox: vi.fn().mockReturnValue([50, 100]),
  allocateCostsEqually: vi.fn().mockReturnValue([75, 75]),
  calculateItemProfitability: vi.fn().mockReturnValue({
    expectedSellPrice: 100,
    cogPercent: 50,
    grossProfit: 30,
    profitMarginPercent: 30,
    roiPercent: 60,
  }),
  calculateEvaluationSummary: vi.fn().mockReturnValue({
    itemCount: 2,
    totalCost: 150,
    totalExpectedRevenue: 300,
    totalGrossProfit: 90,
    overallMarginPercent: 30,
    overallRoiPercent: 60,
    itemsWithCost: 2,
    itemsWithPrice: 2,
    itemsNeedingReview: 0,
    averageCogPercent: 50,
  }),
}));

describe('PurchaseEvaluatorService', () => {
  let service: PurchaseEvaluatorService;
  let mockSupabase: ReturnType<typeof createMockSupabaseClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
    service = new PurchaseEvaluatorService(mockSupabase as unknown as SupabaseClient);
  });

  // ============================================
  // createEvaluation
  // ============================================

  describe('createEvaluation', () => {
    it('should create an evaluation with items', async () => {
      const mockEvaluation = {
        id: 'eval-1',
        user_id: 'user-1',
        name: 'Test Evaluation',
        source: 'csv_upload',
        default_platform: 'amazon',
        total_purchase_price: null,
        cost_allocation_method: 'per_item',
        item_count: 2,
        total_cost: null,
        total_expected_revenue: null,
        overall_margin_percent: null,
        overall_roi_percent: null,
        status: 'draft',
        lookup_completed_at: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      // First chain for creating evaluation
      const evalChain = mockSupabase._createChain();
      evalChain.single.mockResolvedValueOnce({
        data: mockEvaluation,
        error: null,
      });

      // Second chain for inserting items
      const itemsChain = mockSupabase._createChain();
      itemsChain.insert.mockResolvedValueOnce({ error: null });

      mockSupabase.from
        .mockReturnValueOnce(evalChain)
        .mockReturnValueOnce(itemsChain);

      const result = await service.createEvaluation('user-1', {
        name: 'Test Evaluation',
        source: 'csv_upload',
        defaultPlatform: 'amazon',
        items: [
          { setNumber: '75192', condition: 'New' },
          { setNumber: '76139', condition: 'Used' },
        ],
      });

      expect(result.id).toBe('eval-1');
      expect(result.name).toBe('Test Evaluation');
      expect(mockSupabase.from).toHaveBeenCalledWith('purchase_evaluations');
    });

    it('should throw error when evaluation creation fails', async () => {
      const evalChain = mockSupabase._createChain();
      evalChain.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database error' },
      });

      mockSupabase.from.mockReturnValueOnce(evalChain);

      await expect(
        service.createEvaluation('user-1', {
          name: 'Test',
          source: 'csv_upload',
          defaultPlatform: 'amazon',
          items: [{ setNumber: '75192', condition: 'New' }],
        })
      ).rejects.toThrow('Failed to create evaluation');
    });

    it('should clean up evaluation if items creation fails', async () => {
      const mockEvaluation = {
        id: 'eval-1',
        user_id: 'user-1',
        name: 'Test',
        source: 'csv_upload',
        default_platform: 'amazon',
        total_purchase_price: null,
        cost_allocation_method: 'per_item',
        item_count: 1,
        total_cost: null,
        total_expected_revenue: null,
        overall_margin_percent: null,
        overall_roi_percent: null,
        status: 'draft',
        lookup_completed_at: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      // First call returns evaluation
      const evalChain = mockSupabase._createChain();
      evalChain.single.mockResolvedValueOnce({
        data: mockEvaluation,
        error: null,
      });

      // Items insert fails
      const itemsChain = mockSupabase._createChain();
      itemsChain.insert.mockResolvedValueOnce({ error: { message: 'Insert failed' } });

      // Delete should be called to clean up
      const deleteChain = mockSupabase._createChain();
      deleteChain.eq.mockResolvedValueOnce({ error: null });

      mockSupabase.from
        .mockReturnValueOnce(evalChain)
        .mockReturnValueOnce(itemsChain)
        .mockReturnValueOnce(deleteChain);

      await expect(
        service.createEvaluation('user-1', {
          name: 'Test',
          source: 'csv_upload',
          defaultPlatform: 'amazon',
          items: [{ setNumber: '75192', condition: 'New' }],
        })
      ).rejects.toThrow('Failed to create items');
    });

    it('should handle photo analysis fields', async () => {
      const mockEvaluation = {
        id: 'eval-1',
        user_id: 'user-1',
        name: 'Photo Evaluation',
        source: 'photo_analysis',
        default_platform: 'ebay',
        total_purchase_price: null,
        cost_allocation_method: 'proportional',
        item_count: 1,
        total_cost: null,
        total_expected_revenue: null,
        overall_margin_percent: null,
        overall_roi_percent: null,
        status: 'draft',
        lookup_completed_at: null,
        evaluation_mode: 'max_bid',
        target_margin_percent: 25,
        photo_analysis_json: { models: ['opus'] },
        listing_description: 'eBay listing text',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      const evalChain = mockSupabase._createChain();
      evalChain.single.mockResolvedValueOnce({
        data: mockEvaluation,
        error: null,
      });

      const itemsChain = mockSupabase._createChain();
      itemsChain.insert.mockResolvedValueOnce({ error: null });

      mockSupabase.from
        .mockReturnValueOnce(evalChain)
        .mockReturnValueOnce(itemsChain);

      const result = await service.createEvaluation('user-1', {
        name: 'Photo Evaluation',
        source: 'photo_analysis',
        defaultPlatform: 'ebay',
        evaluationMode: 'max_bid',
        targetMarginPercent: 25,
        photoAnalysisJson: { models: ['opus'] },
        listingDescription: 'eBay listing text',
        items: [
          {
            setNumber: '75192',
            condition: 'New',
            itemType: 'set',
            boxCondition: 'Excellent',
            sealStatus: 'Factory Sealed',
            aiConfidenceScore: 0.92,
          },
        ],
      });

      expect(result.evaluationMode).toBe('max_bid');
      expect(result.targetMarginPercent).toBe(25);
    });
  });

  // ============================================
  // getEvaluations
  // ============================================

  describe('getEvaluations', () => {
    it('should fetch all evaluations for a user', async () => {
      const mockEvaluations = [
        {
          id: 'eval-1',
          user_id: 'user-1',
          name: 'Evaluation 1',
          source: 'csv_upload',
          default_platform: 'amazon',
          total_purchase_price: 100,
          cost_allocation_method: 'per_item',
          item_count: 2,
          total_cost: 100,
          total_expected_revenue: 200,
          overall_margin_percent: 30,
          overall_roi_percent: 60,
          status: 'completed',
          lookup_completed_at: '2024-01-01T00:00:00Z',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'eval-2',
          user_id: 'user-1',
          name: 'Evaluation 2',
          source: 'clipboard_paste',
          default_platform: 'ebay',
          total_purchase_price: null,
          cost_allocation_method: 'proportional',
          item_count: 1,
          total_cost: null,
          total_expected_revenue: null,
          overall_margin_percent: null,
          overall_roi_percent: null,
          status: 'draft',
          lookup_completed_at: null,
          created_at: '2024-01-02T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z',
        },
      ];

      const listChain = mockSupabase._createChain();
      listChain.order.mockResolvedValueOnce({
        data: mockEvaluations,
        error: null,
      });

      mockSupabase.from.mockReturnValueOnce(listChain);

      const result = await service.getEvaluations('user-1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('eval-1');
      expect(result[1].id).toBe('eval-2');
      expect(mockSupabase.from).toHaveBeenCalledWith('purchase_evaluations');
    });

    it('should return empty array when no evaluations found', async () => {
      const listChain = mockSupabase._createChain();
      listChain.order.mockResolvedValueOnce({
        data: [],
        error: null,
      });

      mockSupabase.from.mockReturnValueOnce(listChain);

      const result = await service.getEvaluations('user-1');

      expect(result).toHaveLength(0);
    });

    it('should throw error on database error', async () => {
      const listChain = mockSupabase._createChain();
      listChain.order.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database error' },
      });

      mockSupabase.from.mockReturnValueOnce(listChain);

      await expect(service.getEvaluations('user-1')).rejects.toThrow(
        'Failed to fetch evaluations'
      );
    });
  });

  // ============================================
  // getEvaluation
  // ============================================

  describe('getEvaluation', () => {
    it('should fetch evaluation with items', async () => {
      const mockEvaluation = {
        id: 'eval-1',
        user_id: 'user-1',
        name: 'Test Evaluation',
        source: 'csv_upload',
        default_platform: 'amazon',
        total_purchase_price: 100,
        cost_allocation_method: 'per_item',
        item_count: 2,
        total_cost: 100,
        total_expected_revenue: 200,
        overall_margin_percent: 30,
        overall_roi_percent: 60,
        status: 'completed',
        lookup_completed_at: '2024-01-01T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      const mockItems = [
        {
          id: 'item-1',
          evaluation_id: 'eval-1',
          set_number: '75192',
          set_name: 'Millennium Falcon',
          condition: 'New',
          quantity: 1,
          unit_cost: 50,
          allocated_cost: 50,
          brickset_set_id: 'brickset-1',
          uk_retail_price: 849.99,
          ean: '1234567890123',
          upc: null,
          image_url: 'https://example.com/image.jpg',
          target_platform: 'amazon',
          amazon_asin: 'B01ABC123',
          amazon_asin_source: 'ean_lookup',
          amazon_asin_confidence: 'exact',
          amazon_alternative_asins: null,
          amazon_buy_box_price: 700,
          amazon_my_price: null,
          amazon_was_price: 750,
          amazon_offer_count: 5,
          amazon_sales_rank: 1000,
          amazon_lookup_status: 'found',
          amazon_lookup_error: null,
          ebay_min_price: null,
          ebay_avg_price: null,
          ebay_max_price: null,
          ebay_listing_count: null,
          ebay_sold_min_price: null,
          ebay_sold_avg_price: null,
          ebay_sold_max_price: null,
          ebay_sold_count: null,
          ebay_lookup_status: 'pending',
          ebay_lookup_error: null,
          expected_sell_price: 700,
          cog_percent: 7.14,
          gross_profit: 600,
          profit_margin_percent: 85.7,
          roi_percent: 1200,
          user_sell_price_override: null,
          user_notes: null,
          needs_review: false,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ];

      // Mock first call (evaluation query)
      const evalChain = mockSupabase._createChain();
      evalChain.single.mockResolvedValueOnce({
        data: mockEvaluation,
        error: null,
      });

      // Mock second call (items query)
      const itemsChain = mockSupabase._createChain();
      itemsChain.order.mockResolvedValueOnce({ data: mockItems, error: null });

      mockSupabase.from
        .mockReturnValueOnce(evalChain)
        .mockReturnValueOnce(itemsChain);

      const result = await service.getEvaluation('user-1', 'eval-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('eval-1');
      expect(result!.items).toHaveLength(1);
      expect(result!.items![0].setNumber).toBe('75192');
    });

    it('should return null when evaluation not found', async () => {
      const evalChain = mockSupabase._createChain();
      evalChain.single.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });

      mockSupabase.from.mockReturnValueOnce(evalChain);

      const result = await service.getEvaluation('user-1', 'non-existent');

      expect(result).toBeNull();
    });

    it('should throw error when items fetch fails', async () => {
      const mockEvaluation = {
        id: 'eval-1',
        user_id: 'user-1',
        name: 'Test',
        source: 'csv_upload',
        default_platform: 'amazon',
        total_purchase_price: null,
        cost_allocation_method: 'per_item',
        item_count: 1,
        total_cost: null,
        total_expected_revenue: null,
        overall_margin_percent: null,
        overall_roi_percent: null,
        status: 'draft',
        lookup_completed_at: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      const evalChain = mockSupabase._createChain();
      evalChain.single.mockResolvedValueOnce({
        data: mockEvaluation,
        error: null,
      });

      const itemsChain = mockSupabase._createChain();
      itemsChain.order.mockResolvedValueOnce({
        data: null,
        error: { message: 'Items fetch failed' },
      });

      mockSupabase.from
        .mockReturnValueOnce(evalChain)
        .mockReturnValueOnce(itemsChain);

      await expect(service.getEvaluation('user-1', 'eval-1')).rejects.toThrow(
        'Failed to fetch items'
      );
    });
  });

  // ============================================
  // updateEvaluation
  // ============================================

  describe('updateEvaluation', () => {
    it('should update evaluation metadata', async () => {
      const mockUpdated = {
        id: 'eval-1',
        user_id: 'user-1',
        name: 'Updated Name',
        source: 'csv_upload',
        default_platform: 'ebay',
        total_purchase_price: 200,
        cost_allocation_method: 'proportional',
        item_count: 2,
        total_cost: null,
        total_expected_revenue: null,
        overall_margin_percent: null,
        overall_roi_percent: null,
        status: 'saved',
        lookup_completed_at: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
      };

      const updateChain = mockSupabase._createChain();
      updateChain.single.mockResolvedValueOnce({
        data: mockUpdated,
        error: null,
      });

      mockSupabase.from.mockReturnValueOnce(updateChain);

      const result = await service.updateEvaluation('user-1', 'eval-1', {
        name: 'Updated Name',
        defaultPlatform: 'ebay',
        totalPurchasePrice: 200,
        costAllocationMethod: 'proportional',
        status: 'saved',
      });

      expect(result.name).toBe('Updated Name');
      expect(result.defaultPlatform).toBe('ebay');
      expect(mockSupabase.from).toHaveBeenCalledWith('purchase_evaluations');
    });

    it('should throw error on update failure', async () => {
      const updateChain = mockSupabase._createChain();
      updateChain.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Update failed' },
      });

      mockSupabase.from.mockReturnValueOnce(updateChain);

      await expect(
        service.updateEvaluation('user-1', 'eval-1', { name: 'New Name' })
      ).rejects.toThrow('Failed to update evaluation');
    });
  });

  // ============================================
  // deleteEvaluation
  // ============================================

  describe('deleteEvaluation', () => {
    it('should delete evaluation', async () => {
      const deleteChain = mockSupabase._createChain();
      // The delete operation chains: delete().eq().eq() and then resolves
      deleteChain.eq.mockReturnValueOnce(deleteChain);
      deleteChain.eq.mockResolvedValueOnce({ error: null });

      mockSupabase.from.mockReturnValueOnce(deleteChain);

      await expect(
        service.deleteEvaluation('user-1', 'eval-1')
      ).resolves.toBeUndefined();

      expect(mockSupabase.from).toHaveBeenCalledWith('purchase_evaluations');
    });

    it('should throw error on delete failure', async () => {
      const deleteChain = mockSupabase._createChain();
      deleteChain.eq.mockReturnValueOnce(deleteChain);
      deleteChain.eq.mockResolvedValueOnce({
        error: { message: 'Delete failed' },
      });

      mockSupabase.from.mockReturnValueOnce(deleteChain);

      await expect(service.deleteEvaluation('user-1', 'eval-1')).rejects.toThrow(
        'Failed to delete evaluation'
      );
    });
  });

  // ============================================
  // updateItem
  // ============================================

  describe('updateItem', () => {
    it('should update item fields', async () => {
      // First call to check item exists
      mockSupabase._mockChain.single
        .mockResolvedValueOnce({
          data: { evaluation_id: 'eval-1' },
          error: null,
        })
        // Second call to verify ownership
        .mockResolvedValueOnce({
          data: { id: 'eval-1' },
          error: null,
        })
        // Third call for actual update
        .mockResolvedValueOnce({
          data: {
            id: 'item-1',
            evaluation_id: 'eval-1',
            set_number: '75192',
            set_name: 'Millennium Falcon',
            condition: 'New',
            quantity: 1,
            unit_cost: null,
            allocated_cost: 60,
            brickset_set_id: null,
            uk_retail_price: null,
            ean: null,
            upc: null,
            image_url: null,
            target_platform: 'ebay',
            amazon_asin: null,
            amazon_asin_source: null,
            amazon_asin_confidence: null,
            amazon_alternative_asins: null,
            amazon_buy_box_price: null,
            amazon_my_price: null,
            amazon_was_price: null,
            amazon_offer_count: null,
            amazon_sales_rank: null,
            amazon_lookup_status: 'pending',
            amazon_lookup_error: null,
            ebay_min_price: null,
            ebay_avg_price: null,
            ebay_max_price: null,
            ebay_listing_count: null,
            ebay_sold_min_price: null,
            ebay_sold_avg_price: null,
            ebay_sold_max_price: null,
            ebay_sold_count: null,
            ebay_lookup_status: 'pending',
            ebay_lookup_error: null,
            expected_sell_price: null,
            cog_percent: null,
            gross_profit: null,
            profit_margin_percent: null,
            roi_percent: null,
            user_sell_price_override: 150,
            user_notes: 'Manual override',
            needs_review: false,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-02T00:00:00Z',
          },
          error: null,
        });

      const result = await service.updateItem('user-1', 'item-1', {
        targetPlatform: 'ebay',
        allocatedCost: 60,
        userSellPriceOverride: 150,
        userNotes: 'Manual override',
      });

      expect(result.targetPlatform).toBe('ebay');
      expect(result.allocatedCost).toBe(60);
      expect(result.userSellPriceOverride).toBe(150);
    });

    it('should throw error when item not found', async () => {
      mockSupabase._mockChain.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Not found' },
      });

      await expect(
        service.updateItem('user-1', 'non-existent', { targetPlatform: 'ebay' })
      ).rejects.toThrow('Item not found');
    });

    it('should throw error when user does not own evaluation', async () => {
      mockSupabase._mockChain.single
        .mockResolvedValueOnce({
          data: { evaluation_id: 'eval-1' },
          error: null,
        })
        .mockResolvedValueOnce({
          data: null, // Ownership check fails
          error: null,
        });

      await expect(
        service.updateItem('user-1', 'item-1', { targetPlatform: 'ebay' })
      ).rejects.toThrow('Unauthorized');
    });

    it('should set ASIN source and confidence when manually selecting ASIN', async () => {
      mockSupabase._mockChain.single
        .mockResolvedValueOnce({
          data: { evaluation_id: 'eval-1' },
          error: null,
        })
        .mockResolvedValueOnce({
          data: { id: 'eval-1' },
          error: null,
        })
        .mockResolvedValueOnce({
          data: {
            id: 'item-1',
            evaluation_id: 'eval-1',
            set_number: '75192',
            set_name: null,
            condition: 'New',
            quantity: 1,
            unit_cost: null,
            allocated_cost: null,
            brickset_set_id: null,
            uk_retail_price: null,
            ean: null,
            upc: null,
            image_url: null,
            target_platform: 'amazon',
            amazon_asin: 'B01NEW123',
            amazon_asin_source: 'manual',
            amazon_asin_confidence: 'manual',
            amazon_alternative_asins: null,
            amazon_buy_box_price: null,
            amazon_my_price: null,
            amazon_was_price: null,
            amazon_offer_count: null,
            amazon_sales_rank: null,
            amazon_lookup_status: 'found',
            amazon_lookup_error: null,
            ebay_min_price: null,
            ebay_avg_price: null,
            ebay_max_price: null,
            ebay_listing_count: null,
            ebay_sold_min_price: null,
            ebay_sold_avg_price: null,
            ebay_sold_max_price: null,
            ebay_sold_count: null,
            ebay_lookup_status: 'pending',
            ebay_lookup_error: null,
            expected_sell_price: null,
            cog_percent: null,
            gross_profit: null,
            profit_margin_percent: null,
            roi_percent: null,
            user_sell_price_override: null,
            user_notes: null,
            needs_review: false,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-02T00:00:00Z',
          },
          error: null,
        });

      const result = await service.updateItem('user-1', 'item-1', {
        amazonAsin: 'B01NEW123',
      });

      expect(result.amazonAsin).toBe('B01NEW123');
      expect(result.amazonAsinSource).toBe('manual');
      expect(result.amazonAsinConfidence).toBe('manual');
      expect(result.needsReview).toBe(false);
    });
  });

  // ============================================
  // allocateCosts
  // ============================================

  describe('allocateCosts', () => {
    const mockEvaluationWithItems = {
      id: 'eval-1',
      userId: 'user-1',
      name: 'Test',
      source: 'csv_upload',
      defaultPlatform: 'amazon' as const,
      totalPurchasePrice: 150,
      costAllocationMethod: 'per_item' as const,
      itemCount: 2,
      totalCost: null,
      totalExpectedRevenue: null,
      overallMarginPercent: null,
      overallRoiPercent: null,
      status: 'draft' as const,
      lookupCompletedAt: null,
      convertedAt: null,
      convertedPurchaseId: null,
      evaluationMode: 'cost_known' as const,
      targetMarginPercent: null,
      photoAnalysisJson: null,
      listingDescription: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      items: [
        {
          id: 'item-1',
          evaluationId: 'eval-1',
          setNumber: '75192',
          setName: 'Millennium Falcon',
          condition: 'New' as const,
          quantity: 1,
          unitCost: 50,
          allocatedCost: null,
          bricksetSetId: null,
          ukRetailPrice: null,
          ean: null,
          upc: null,
          imageUrl: null,
          targetPlatform: 'amazon' as const,
          amazonAsin: null,
          amazonAsinSource: null,
          amazonAsinConfidence: null,
          amazonAlternativeAsins: null,
          amazonBuyBoxPrice: 100,
          amazonMyPrice: null,
          amazonWasPrice: 120,
          amazonOfferCount: null,
          amazonSalesRank: null,
          amazonLookupStatus: 'found' as const,
          amazonLookupError: null,
          ebayMinPrice: null,
          ebayAvgPrice: null,
          ebayMaxPrice: null,
          ebayListingCount: null,
          ebaySoldMinPrice: null,
          ebaySoldAvgPrice: null,
          ebaySoldMaxPrice: null,
          ebaySoldCount: null,
          ebayLookupStatus: 'pending' as const,
          ebayLookupError: null,
          expectedSellPrice: null,
          cogPercent: null,
          grossProfit: null,
          profitMarginPercent: null,
          roiPercent: null,
          userSellPriceOverride: null,
          userNotes: null,
          needsReview: false,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 'item-2',
          evaluationId: 'eval-1',
          setNumber: '76139',
          setName: 'Batmobile',
          condition: 'New' as const,
          quantity: 1,
          unitCost: 100,
          allocatedCost: null,
          bricksetSetId: null,
          ukRetailPrice: null,
          ean: null,
          upc: null,
          imageUrl: null,
          targetPlatform: 'amazon' as const,
          amazonAsin: null,
          amazonAsinSource: null,
          amazonAsinConfidence: null,
          amazonAlternativeAsins: null,
          amazonBuyBoxPrice: 200,
          amazonMyPrice: null,
          amazonWasPrice: null,
          amazonOfferCount: null,
          amazonSalesRank: null,
          amazonLookupStatus: 'found' as const,
          amazonLookupError: null,
          ebayMinPrice: null,
          ebayAvgPrice: null,
          ebayMaxPrice: null,
          ebayListingCount: null,
          ebaySoldMinPrice: null,
          ebaySoldAvgPrice: null,
          ebaySoldMaxPrice: null,
          ebaySoldCount: null,
          ebayLookupStatus: 'pending' as const,
          ebayLookupError: null,
          expectedSellPrice: null,
          cogPercent: null,
          grossProfit: null,
          profitMarginPercent: null,
          roiPercent: null,
          userSellPriceOverride: null,
          userNotes: null,
          needsReview: false,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ],
    };

    it('should allocate costs using per_item method', async () => {
      // Mock getEvaluation
      const getEvaluationSpy = vi
        .spyOn(service, 'getEvaluation')
        .mockResolvedValueOnce(mockEvaluationWithItems);

      // Mock update calls
      mockSupabase.from.mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      await service.allocateCosts('user-1', 'eval-1', 'per_item');

      expect(getEvaluationSpy).toHaveBeenCalledWith('user-1', 'eval-1');
      // per_item uses unitCost directly
      expect(mockSupabase.from).toHaveBeenCalledWith('purchase_evaluation_items');

      getEvaluationSpy.mockRestore();
    });

    it('should throw error when evaluation not found', async () => {
      vi.spyOn(service, 'getEvaluation').mockResolvedValueOnce(null);

      await expect(
        service.allocateCosts('user-1', 'eval-1', 'proportional', 150)
      ).rejects.toThrow('Evaluation not found');
    });

    it('should throw error when total price required but missing', async () => {
      const evalWithoutPrice = { ...mockEvaluationWithItems, totalPurchasePrice: null };
      vi.spyOn(service, 'getEvaluation').mockResolvedValueOnce(evalWithoutPrice);

      await expect(
        service.allocateCosts('user-1', 'eval-1', 'proportional')
      ).rejects.toThrow('Total purchase price required');
    });
  });

  // ============================================
  // calculateProfitability
  // ============================================

  describe('calculateProfitability', () => {
    it('should calculate profitability for all items', async () => {
      const mockItems = [
        {
          id: 'item-1',
          set_number: '75192',
          condition: 'New',
          target_platform: 'amazon',
          allocated_cost: 50,
          unit_cost: null,
          amazon_buy_box_price: 100,
          amazon_was_price: null,
          ebay_sold_avg_price: null,
          ebay_avg_price: null,
          user_sell_price_override: null,
        },
      ];

      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValueOnce({ data: mockItems, error: null }),
      });

      // Mock update
      mockSupabase.from.mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      await service.calculateProfitability('user-1', 'eval-1');

      expect(mockSupabase.from).toHaveBeenCalledWith('purchase_evaluation_items');
    });
  });

  // ============================================
  // updateEvaluationSummary
  // ============================================

  describe('updateEvaluationSummary', () => {
    it('should update evaluation with summary statistics', async () => {
      const mockEval = {
        id: 'eval-1',
        userId: 'user-1',
        name: 'Test',
        source: 'csv_upload',
        defaultPlatform: 'amazon' as const,
        totalPurchasePrice: 100,
        costAllocationMethod: 'per_item' as const,
        itemCount: 2,
        totalCost: null,
        totalExpectedRevenue: null,
        overallMarginPercent: null,
        overallRoiPercent: null,
        status: 'completed' as const,
        lookupCompletedAt: null,
        convertedAt: null,
        convertedPurchaseId: null,
        evaluationMode: 'cost_known' as const,
        targetMarginPercent: null,
        photoAnalysisJson: null,
        listingDescription: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        items: [
          {
            id: 'item-1',
            evaluationId: 'eval-1',
            setNumber: '75192',
            setName: null,
            condition: 'New' as const,
            quantity: 1,
            unitCost: 50,
            allocatedCost: 50,
            bricksetSetId: null,
            ukRetailPrice: null,
            ean: null,
            upc: null,
            imageUrl: null,
            targetPlatform: 'amazon' as const,
            amazonAsin: null,
            amazonAsinSource: null,
            amazonAsinConfidence: null,
            amazonAlternativeAsins: null,
            amazonBuyBoxPrice: 100,
            amazonMyPrice: null,
            amazonWasPrice: null,
            amazonOfferCount: null,
            amazonSalesRank: null,
            amazonLookupStatus: 'found' as const,
            amazonLookupError: null,
            ebayMinPrice: null,
            ebayAvgPrice: null,
            ebayMaxPrice: null,
            ebayListingCount: null,
            ebaySoldMinPrice: null,
            ebaySoldAvgPrice: null,
            ebaySoldMaxPrice: null,
            ebaySoldCount: null,
            ebayLookupStatus: 'pending' as const,
            ebayLookupError: null,
            expectedSellPrice: 100,
            cogPercent: 50,
            grossProfit: 30,
            profitMarginPercent: 30,
            roiPercent: 60,
            userSellPriceOverride: null,
            userNotes: null,
            needsReview: false,
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        ],
      };

      vi.spyOn(service, 'getEvaluation').mockResolvedValueOnce(mockEval);

      mockSupabase.from.mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      await service.updateEvaluationSummary('user-1', 'eval-1');

      expect(mockSupabase.from).toHaveBeenCalledWith('purchase_evaluations');
    });

    it('should do nothing when evaluation not found', async () => {
      vi.spyOn(service, 'getEvaluation').mockResolvedValueOnce(null);

      await service.updateEvaluationSummary('user-1', 'eval-1');

      // Should return early without updating
      expect(mockSupabase.from).not.toHaveBeenCalledWith('purchase_evaluations');
    });
  });
});
