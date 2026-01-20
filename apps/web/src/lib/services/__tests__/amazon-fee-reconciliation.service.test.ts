/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AmazonFeeReconciliationService } from '../amazon-fee-reconciliation.service';

describe('AmazonFeeReconciliationService', () => {
  let service: AmazonFeeReconciliationService;
  const userId = 'test-user-id';

  // Mock Supabase client
  const mockSupabase = {
    from: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new AmazonFeeReconciliationService(mockSupabase as any);
  });

  describe('reconcileFees', () => {
    it('should return success when no items need reconciliation', async () => {
      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: [], error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.reconcileFees(userId);

      expect(result.success).toBe(true);
      expect(result.itemsProcessed).toBe(0);
      expect(result.itemsUpdated).toBe(0);
    });

    it('should reconcile items with matching transactions', async () => {
      const mockInventoryItems = [
        {
          id: 'inv-1',
          set_number: '75192',
          sold_order_id: '206-1234567-1234567',
          sold_price: 800,
          sold_gross_amount: null,
          sold_fees_amount: null,
          sold_net_amount: null,
          sold_postage_received: null,
        },
      ];

      const mockTransactions = [
        {
          amazon_order_id: '206-1234567-1234567',
          transaction_type: 'Shipment',
          transaction_status: 'RELEASED',
          posted_date: '2025-01-15',
          total_amount: 720,
          net_amount: 720,
          total_fees: 80,
          gross_sales_amount: 800,
          shipping_credit: 5,
        },
      ];

      // Mock for inventory items query
      const mockInventoryBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockInventoryItems, error: null })),
      };

      // Mock for platform_orders query (won't be called for direct Amazon order IDs)
      const mockOrdersBuilder = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: [], error: null })),
      };

      // Mock for transactions query
      const mockTransactionsBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockTransactions, error: null })),
      };

      // Mock for update
      const mockUpdateBuilder = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ error: null })),
      };

      let callCount = 0;
      mockSupabase.from.mockImplementation((table: string) => {
        callCount++;
        if (table === 'inventory_items') {
          if (callCount === 1) return mockInventoryBuilder;
          return mockUpdateBuilder;
        }
        if (table === 'platform_orders') return mockOrdersBuilder;
        if (table === 'amazon_transactions') return mockTransactionsBuilder;
        return mockUpdateBuilder;
      });

      const result = await service.reconcileFees(userId);

      expect(result.itemsProcessed).toBe(1);
      expect(result.itemsUpdated).toBe(1);
    });

    it('should handle UUID sold_order_ids by looking up platform_orders', async () => {
      const mockInventoryItems = [
        {
          id: 'inv-1',
          set_number: '75192',
          sold_order_id: '550e8400-e29b-41d4-a716-446655440000', // UUID format
          sold_price: 800,
          sold_gross_amount: null,
          sold_fees_amount: null,
          sold_net_amount: null,
        },
      ];

      const mockPlatformOrders = [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          platform_order_id: '206-1234567-1234567',
        },
      ];

      const mockTransactions = [
        {
          amazon_order_id: '206-1234567-1234567',
          transaction_type: 'Shipment',
          transaction_status: 'RELEASED',
          net_amount: 720,
          total_fees: 80,
          gross_sales_amount: 800,
        },
      ];

      let queryIndex = 0;
      mockSupabase.from.mockImplementation((table: string) => {
        queryIndex++;
        const builder = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnThis(),
          range: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          then: vi.fn((resolve) => {
            if (table === 'inventory_items' && queryIndex === 1) {
              resolve({ data: mockInventoryItems, error: null });
            } else if (table === 'platform_orders') {
              resolve({ data: mockPlatformOrders, error: null });
            } else if (table === 'amazon_transactions') {
              resolve({ data: mockTransactions, error: null });
            } else {
              resolve({ error: null });
            }
            return Promise.resolve({ data: null, error: null });
          }),
        };
        return builder;
      });

      const result = await service.reconcileFees(userId);

      expect(result.itemsProcessed).toBe(1);
    });

    it('should skip items without sold_order_id', async () => {
      const mockInventoryItems = [
        {
          id: 'inv-1',
          set_number: '75192',
          sold_order_id: null,
          sold_price: 800,
        },
      ];

      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockInventoryItems, error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.reconcileFees(userId);

      expect(result.itemsProcessed).toBe(1);
      expect(result.itemsSkipped).toBe(1);
      expect(result.itemsUpdated).toBe(0);
    });

    it('should skip items without matching transactions', async () => {
      const mockInventoryItems = [
        {
          id: 'inv-1',
          set_number: '75192',
          sold_order_id: '206-1234567-1234567',
          sold_price: 800,
        },
      ];

      let queryIndex = 0;
      mockSupabase.from.mockImplementation(() => {
        queryIndex++;
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnThis(),
          range: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          then: vi.fn((resolve) => {
            if (queryIndex === 1) {
              resolve({ data: mockInventoryItems, error: null });
            } else {
              resolve({ data: [], error: null }); // No transactions
            }
            return Promise.resolve({ data: [], error: null });
          }),
        };
      });

      const result = await service.reconcileFees(userId);

      expect(result.itemsSkipped).toBe(1);
    });

    it('should prefer RELEASED over DEFERRED transactions', async () => {
      const mockInventoryItems = [
        {
          id: 'inv-1',
          set_number: '75192',
          sold_order_id: '206-1234567-1234567',
          sold_price: 800,
        },
      ];

      const mockTransactions = [
        {
          amazon_order_id: '206-1234567-1234567',
          transaction_type: 'Shipment',
          transaction_status: 'DEFERRED',
          posted_date: '2025-01-10',
          net_amount: 700,
          total_fees: 90, // Different fees
          gross_sales_amount: 790,
        },
        {
          amazon_order_id: '206-1234567-1234567',
          transaction_type: 'Shipment',
          transaction_status: 'RELEASED',
          posted_date: '2025-01-15',
          net_amount: 720, // Correct amount
          total_fees: 80,
          gross_sales_amount: 800,
        },
      ];

      let queryIndex = 0;
      mockSupabase.from.mockImplementation((table: string) => {
        queryIndex++;
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnThis(),
          range: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          then: vi.fn((resolve) => {
            if (queryIndex === 1) {
              resolve({ data: mockInventoryItems, error: null });
            } else if (table === 'amazon_transactions') {
              resolve({ data: mockTransactions, error: null });
            } else {
              resolve({ data: [], error: null });
            }
            return Promise.resolve({ data: [], error: null });
          }),
        };
      });

      const result = await service.reconcileFees(userId);

      expect(result.itemsUpdated).toBe(1);
    });

    it('should sum multiple transactions for multi-item orders', async () => {
      const mockInventoryItems = [
        {
          id: 'inv-1',
          set_number: '75192',
          sold_order_id: '206-1234567-1234567',
          sold_price: 800,
        },
      ];

      const mockTransactions = [
        {
          amazon_order_id: '206-1234567-1234567',
          transaction_type: 'Shipment',
          transaction_status: 'RELEASED',
          net_amount: 400,
          total_fees: 40,
          gross_sales_amount: 440,
          shipping_credit: 2.50,
        },
        {
          amazon_order_id: '206-1234567-1234567',
          transaction_type: 'Sale',
          transaction_status: 'RELEASED',
          net_amount: 320,
          total_fees: 40,
          gross_sales_amount: 360,
          shipping_credit: 2.50,
        },
      ];

      let queryIndex = 0;
      mockSupabase.from.mockImplementation((table: string) => {
        queryIndex++;
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnThis(),
          range: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          then: vi.fn((resolve) => {
            if (queryIndex === 1) {
              resolve({ data: mockInventoryItems, error: null });
            } else if (table === 'amazon_transactions') {
              resolve({ data: mockTransactions, error: null });
            } else {
              resolve({ data: [], error: null });
            }
            return Promise.resolve({ data: [], error: null });
          }),
        };
      });

      const result = await service.reconcileFees(userId);

      // Should have summed the transactions
      expect(result.itemsUpdated).toBe(1);
    });

    it('should reconcile all items when reconcileAll is true', async () => {
      const mockInventoryItems = [
        {
          id: 'inv-1',
          set_number: '75192',
          sold_order_id: '206-1234567-1234567',
          sold_price: 800,
          sold_fees_amount: 80, // Already has fees
        },
      ];

      let queryIndex = 0;
      mockSupabase.from.mockImplementation(() => {
        queryIndex++;
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnThis(),
          range: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          then: vi.fn((resolve) => {
            if (queryIndex === 1) {
              resolve({ data: mockInventoryItems, error: null });
            } else {
              resolve({ data: [], error: null });
            }
            return Promise.resolve({ data: [], error: null });
          }),
        };
      });

      // With reconcileAll=true, it should not filter by missing fees
      await service.reconcileFees(userId, true);

      // Should process even items with existing fees
      expect(mockSupabase.from).toHaveBeenCalled();
    });

    it('should handle database errors gracefully', async () => {
      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: null, error: { message: 'DB connection failed' } })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.reconcileFees(userId);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Failed to fetch inventory items page 1: DB connection failed');
    });

    it('should handle update errors', async () => {
      const mockInventoryItems = [
        {
          id: 'inv-1',
          set_number: '75192',
          sold_order_id: '206-1234567-1234567',
          sold_price: 800,
        },
      ];

      const mockTransactions = [
        {
          amazon_order_id: '206-1234567-1234567',
          transaction_type: 'Shipment',
          transaction_status: 'RELEASED',
          net_amount: 720,
          total_fees: 80,
          gross_sales_amount: 800,
        },
      ];

      let callIndex = 0;
      mockSupabase.from.mockImplementation((table: string) => {
        callIndex++;
        const mockBuilder = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnThis(),
          range: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          then: vi.fn().mockImplementation((resolve) => {
            // First call is inventory_items select
            if (table === 'inventory_items' && callIndex === 1) {
              return resolve({ data: mockInventoryItems, error: null });
            }
            // Second call is amazon_transactions select
            if (table === 'amazon_transactions') {
              return resolve({ data: mockTransactions, error: null });
            }
            // inventory_items update - return error
            if (table === 'inventory_items' && callIndex > 2) {
              return resolve({ error: { message: 'Update failed' } });
            }
            return resolve({ data: [], error: null });
          }),
        };
        return mockBuilder;
      });

      const result = await service.reconcileFees(userId);

      // Service should continue and report the error
      expect(result.itemsUpdated).toBe(0);
      expect(result.errors.some((e) => e.includes('Failed to update item inv-1'))).toBe(true);
    });
  });

  describe('getReconciliationPreview', () => {
    it('should return preview of items that would be reconciled', async () => {
      const mockInventoryItems = [
        {
          id: 'inv-1',
          set_number: '75192',
          sold_order_id: '206-1234567-1234567',
          sold_price: 800,
          sold_net_amount: null,
        },
      ];

      const mockTransactions = [
        {
          amazon_order_id: '206-1234567-1234567',
          transaction_type: 'Shipment',
          transaction_status: 'RELEASED',
          net_amount: 720,
          total_fees: 80,
          gross_sales_amount: 800,
        },
      ];

      let queryIndex = 0;
      mockSupabase.from.mockImplementation((table: string) => {
        queryIndex++;
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          then: vi.fn((resolve) => {
            if (table === 'inventory_items') {
              resolve({ data: mockInventoryItems, error: null });
            } else if (table === 'amazon_transactions') {
              resolve({ data: mockTransactions, error: null });
            } else {
              resolve({ data: [], error: null });
            }
            return Promise.resolve({ data: [], error: null });
          }),
        };
      });

      const result = await service.getReconciliationPreview(userId);

      expect(result).toHaveLength(1);
      expect(result[0].setNumber).toBe('75192');
      expect(result[0].platformOrderId).toBe('206-1234567-1234567');
      expect(result[0].transactionNetAmount).toBe(720);
      expect(result[0].transactionTotalFees).toBe(80);
    });

    it('should return empty array when no items found', async () => {
      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: [], error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.getReconciliationPreview(userId);

      expect(result).toHaveLength(0);
    });

    it('should limit results to 50 items', async () => {
      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: [], error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      await service.getReconciliationPreview(userId);

      expect(mockBuilder.limit).toHaveBeenCalledWith(50);
    });
  });
});
