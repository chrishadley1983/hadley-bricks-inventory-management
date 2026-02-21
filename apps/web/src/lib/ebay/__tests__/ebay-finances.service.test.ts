import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EbayFinancesService } from '../ebay-finances.service';

// Use vi.hoisted to ensure mocks are defined before vi.mock runs
const { mockAuthService, mockApiAdapter } = vi.hoisted(() => ({
  mockAuthService: {
    getAccessToken: vi.fn(),
    getConnectionStatus: vi.fn(),
  },
  mockApiAdapter: {
    getTransactions: vi.fn(),
    getAllTransactions: vi.fn(),
    getPayouts: vi.fn(),
    getAllPayouts: vi.fn(),
  },
}));

vi.mock('../ebay-api.adapter', () => {
  class MockEbayApiAdapter {
    getTransactions = mockApiAdapter.getTransactions;
    getAllTransactions = mockApiAdapter.getAllTransactions;
    getPayouts = mockApiAdapter.getPayouts;
    getAllPayouts = mockApiAdapter.getAllPayouts;
    static buildTransactionDateFilter = vi
      .fn()
      .mockReturnValue('2025-01-01T00:00:00Z..2025-01-31T23:59:59Z');
  }
  return { EbayApiAdapter: MockEbayApiAdapter };
});

vi.mock('../ebay-auth.service', () => ({
  EbayAuthService: class MockEbayAuthService {
    getAccessToken = mockAuthService.getAccessToken;
    getConnectionStatus = mockAuthService.getConnectionStatus;
  },
}));

// Mock Supabase server
const mockSupabase = {
  from: vi.fn(),
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => mockSupabase),
}));

describe('EbayFinancesService', () => {
  let service: EbayFinancesService;
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EbayFinancesService(
      mockAuthService as unknown as import('../ebay-auth.service').EbayAuthService
    );
  });

  describe('syncTransactions', () => {
    it('should return error when not connected to eBay', async () => {
      mockAuthService.getAccessToken.mockResolvedValue(null);

      const result = await service.syncTransactions(userId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not connected to eBay');
      expect(result.transactionsProcessed).toBe(0);
    });

    it('should fetch transactions from eBay API when authenticated', async () => {
      mockAuthService.getAccessToken.mockResolvedValue('test-token');
      mockAuthService.getConnectionStatus.mockResolvedValue({ marketplaceId: 'EBAY_GB' });

      // Empty transactions to simplify the test
      mockApiAdapter.getAllTransactions.mockResolvedValue([]);

      // Mock sync log creation
      const mockSyncLogBuilder = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'log-1' }, error: null }),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      };
      mockSupabase.from.mockReturnValue(mockSyncLogBuilder);

      const result = await service.syncTransactions(userId);

      expect(result.success).toBe(true);
      expect(result.transactionsProcessed).toBe(0);
      expect(mockApiAdapter.getAllTransactions).toHaveBeenCalled();
    });

    it('should use limited fetch when limit option is provided', async () => {
      mockAuthService.getAccessToken.mockResolvedValue('test-token');
      mockAuthService.getConnectionStatus.mockResolvedValue({ marketplaceId: 'EBAY_GB' });
      mockApiAdapter.getTransactions.mockResolvedValue({ transactions: [] });

      const mockSyncLogBuilder = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'log-1' }, error: null }),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      };
      mockSupabase.from.mockReturnValue(mockSyncLogBuilder);

      await service.syncTransactions(userId, { limit: 10 });

      expect(mockApiAdapter.getTransactions).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10 })
      );
    });

    it('should handle API errors', async () => {
      mockAuthService.getAccessToken.mockResolvedValue('test-token');
      mockAuthService.getConnectionStatus.mockResolvedValue({ marketplaceId: 'EBAY_GB' });
      mockApiAdapter.getAllTransactions.mockRejectedValue(new Error('API rate limit'));

      const result = await service.syncTransactions(userId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('API rate limit');
    });
  });

  describe('syncPayouts', () => {
    it('should return error when not connected', async () => {
      mockAuthService.getAccessToken.mockResolvedValue(null);

      const result = await service.syncPayouts(userId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not connected to eBay');
    });

    it('should fetch payouts from eBay API when authenticated', async () => {
      mockAuthService.getAccessToken.mockResolvedValue('test-token');
      mockAuthService.getConnectionStatus.mockResolvedValue({ marketplaceId: 'EBAY_GB' });

      // Empty payouts to simplify the test
      mockApiAdapter.getAllPayouts.mockResolvedValue([]);

      const mockSyncLogBuilder = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'log-1' }, error: null }),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      };
      mockSupabase.from.mockReturnValue(mockSyncLogBuilder);

      const result = await service.syncPayouts(userId);

      expect(result.success).toBe(true);
      expect(result.payoutsProcessed).toBe(0);
      expect(mockApiAdapter.getAllPayouts).toHaveBeenCalled();
    });
  });

  describe('getFinancialSummary', () => {
    it('should calculate financial summary correctly', async () => {
      const mockTransactions = [
        {
          transaction_type: 'SALE',
          booking_entry: 'CREDIT',
          amount: '100',
          total_fee_amount: '10',
          currency: 'GBP',
        },
        {
          transaction_type: 'SALE',
          booking_entry: 'CREDIT',
          amount: '200',
          total_fee_amount: '20',
          currency: 'GBP',
        },
        { transaction_type: 'REFUND', booking_entry: 'DEBIT', amount: '50', currency: 'GBP' },
      ];

      const mockPayouts = [
        { payout_status: 'SUCCEEDED', amount: '200' },
        { payout_status: 'PENDING', amount: '50' },
      ];

      mockSupabase.from.mockImplementation((table: string) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => {
          if (table === 'ebay_transactions') {
            resolve({ data: mockTransactions, error: null });
          } else {
            resolve({ data: mockPayouts, error: null });
          }
          return Promise.resolve({
            data: table === 'ebay_transactions' ? mockTransactions : mockPayouts,
            error: null,
          });
        }),
      }));

      const result = await service.getFinancialSummary(
        userId,
        new Date('2025-01-01'),
        new Date('2025-01-31')
      );

      expect(result).not.toBeNull();
      expect(result!.totalSales).toBe(300); // 100 + 200
      expect(result!.totalRefunds).toBe(50);
      expect(result!.totalFees).toBe(30); // 10 + 20
      expect(result!.totalPayouts).toBe(200);
      expect(result!.pendingPayouts).toBe(50);
      expect(result!.currency).toBe('GBP');
    });

    it('should return null on error', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: null, error: { message: 'Error' } })),
      });

      const result = await service.getFinancialSummary(
        userId,
        new Date('2025-01-01'),
        new Date('2025-01-31')
      );

      expect(result).toBeNull();
    });
  });

  describe('getTransactionBreakdown', () => {
    it('should group transactions by type', async () => {
      const mockTransactions = [
        { transaction_type: 'SALE', amount: '100', currency: 'GBP' },
        { transaction_type: 'SALE', amount: '150', currency: 'GBP' },
        { transaction_type: 'REFUND', amount: '50', currency: 'GBP' },
        { transaction_type: 'SHIPPING_LABEL', amount: '5', currency: 'GBP' },
      ];

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockTransactions, error: null })),
      });

      const result = await service.getTransactionBreakdown(
        userId,
        new Date('2025-01-01'),
        new Date('2025-01-31')
      );

      expect(result).toHaveLength(3);

      const sales = result.find((b) => b.type === 'SALE');
      expect(sales?.count).toBe(2);
      expect(sales?.totalAmount).toBe(250);

      const refunds = result.find((b) => b.type === 'REFUND');
      expect(refunds?.count).toBe(1);
      expect(refunds?.totalAmount).toBe(50);
    });

    it('should return empty array on error', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: null, error: { message: 'Error' } })),
      });

      const result = await service.getTransactionBreakdown(
        userId,
        new Date('2025-01-01'),
        new Date('2025-01-31')
      );

      expect(result).toHaveLength(0);
    });
  });

  describe('getTransactions', () => {
    it('should fetch transactions with pagination', async () => {
      const mockTransactions = [
        { id: 'tx-1', transaction_type: 'SALE' },
        { id: 'tx-2', transaction_type: 'SALE' },
      ];

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockTransactions, count: 100, error: null })),
      });

      const result = await service.getTransactions(userId, { limit: 50, offset: 0 });

      expect(result.transactions).toHaveLength(2);
      expect(result.total).toBe(100);
    });

    it('should filter by transaction type', async () => {
      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: [], count: 0, error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      await service.getTransactions(userId, { type: 'SALE' });

      expect(mockBuilder.eq).toHaveBeenCalledWith('transaction_type', 'SALE');
    });

    it('should throw on error', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: null, error: { message: 'Error' } })),
      });

      await expect(service.getTransactions(userId)).rejects.toThrow('Failed to fetch transactions');
    });
  });

  describe('getPayouts', () => {
    it('should fetch payouts with pagination', async () => {
      const mockPayouts = [{ id: 'payout-1', payout_status: 'SUCCEEDED' }];

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockPayouts, count: 10, error: null })),
      });

      const result = await service.getPayouts(userId, { limit: 50 });

      expect(result.payouts).toHaveLength(1);
      expect(result.total).toBe(10);
    });

    it('should filter by status', async () => {
      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: [], count: 0, error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      await service.getPayouts(userId, { status: 'SUCCEEDED' });

      expect(mockBuilder.eq).toHaveBeenCalledWith('payout_status', 'SUCCEEDED');
    });

    it('should throw on database error', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: null, error: { message: 'DB Error' } })),
      });

      await expect(service.getPayouts(userId)).rejects.toThrow('Failed to fetch payouts');
    });
  });

  describe('syncTransactions with upsert', () => {
    it('should create new transactions', async () => {
      mockAuthService.getAccessToken.mockResolvedValue('test-token');
      mockAuthService.getConnectionStatus.mockResolvedValue({ marketplaceId: 'EBAY_GB' });

      const mockTransaction = {
        transactionId: 'tx-123',
        orderId: 'order-123',
        transactionType: 'SALE',
        transactionStatus: 'FUNDS_AVAILABLE',
        transactionDate: '2025-01-15T10:00:00Z',
        amount: { value: '100.00', currency: 'GBP' },
        bookingEntry: 'CREDIT',
        buyer: { username: 'buyer123' },
        totalFeeAmount: { value: '10.00', currency: 'GBP' },
      };

      mockApiAdapter.getAllTransactions.mockResolvedValue([mockTransaction]);

      // Mock sync log creation
      const mockSyncLogBuilder = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'log-1' }, error: null }),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      };

      let callCount = 0;
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'ebay_sync_log') {
          return mockSyncLogBuilder;
        }
        if (table === 'ebay_transactions') {
          callCount++;
          if (callCount === 1) {
            // First call - check if exists
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          } else {
            // Second call - insert
            return {
              insert: vi.fn().mockReturnThis(),
              select: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: { id: 'new-tx-1' }, error: null }),
            };
          }
        }
        return mockSyncLogBuilder;
      });

      const result = await service.syncTransactions(userId);

      expect(result.success).toBe(true);
      expect(result.transactionsCreated).toBe(1);
    });

    it('should update existing transactions', async () => {
      mockAuthService.getAccessToken.mockResolvedValue('test-token');
      mockAuthService.getConnectionStatus.mockResolvedValue({ marketplaceId: 'EBAY_GB' });

      const mockTransaction = {
        transactionId: 'tx-existing',
        orderId: 'order-123',
        transactionType: 'SALE',
        transactionStatus: 'FUNDS_AVAILABLE',
        transactionDate: '2025-01-15T10:00:00Z',
        amount: { value: '100.00', currency: 'GBP' },
        bookingEntry: 'CREDIT',
      };

      mockApiAdapter.getAllTransactions.mockResolvedValue([mockTransaction]);

      const mockSyncLogBuilder = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'log-1' }, error: null }),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      };

      let txCallCount = 0;
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'ebay_sync_log') {
          return mockSyncLogBuilder;
        }
        if (table === 'ebay_transactions') {
          txCallCount++;
          if (txCallCount === 1) {
            // Check if exists - returns existing
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: { id: 'existing-tx-id' }, error: null }),
            };
          } else {
            // Update
            return {
              update: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              select: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: { id: 'existing-tx-id' }, error: null }),
            };
          }
        }
        return mockSyncLogBuilder;
      });

      const result = await service.syncTransactions(userId);

      expect(result.success).toBe(true);
      expect(result.transactionsUpdated).toBe(1);
    });
  });

  describe('syncPayouts with upsert', () => {
    it('should create new payouts', async () => {
      mockAuthService.getAccessToken.mockResolvedValue('test-token');
      mockAuthService.getConnectionStatus.mockResolvedValue({ marketplaceId: 'EBAY_GB' });

      const mockPayout = {
        payoutId: 'payout-123',
        payoutStatus: 'SUCCEEDED',
        payoutDate: '2025-01-15T10:00:00Z',
        amount: { value: '500.00', currency: 'GBP' },
        transactionCount: 5,
      };

      mockApiAdapter.getAllPayouts.mockResolvedValue([mockPayout]);

      const mockSyncLogBuilder = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'log-1' }, error: null }),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      };

      let payoutCallCount = 0;
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'ebay_sync_log') {
          return mockSyncLogBuilder;
        }
        if (table === 'ebay_payouts') {
          payoutCallCount++;
          if (payoutCallCount === 1) {
            // Check if exists - not found
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          } else {
            // Insert
            return {
              insert: vi.fn().mockReturnThis(),
              select: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: { id: 'new-payout-1' }, error: null }),
            };
          }
        }
        return mockSyncLogBuilder;
      });

      const result = await service.syncPayouts(userId);

      expect(result.success).toBe(true);
      expect(result.payoutsCreated).toBe(1);
    });

    it('should use limited fetch when limit option is provided for payouts', async () => {
      mockAuthService.getAccessToken.mockResolvedValue('test-token');
      mockAuthService.getConnectionStatus.mockResolvedValue({ marketplaceId: 'EBAY_GB' });
      mockApiAdapter.getPayouts.mockResolvedValue({ payouts: [] });

      const mockSyncLogBuilder = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'log-1' }, error: null }),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      };
      mockSupabase.from.mockReturnValue(mockSyncLogBuilder);

      await service.syncPayouts(userId, { limit: 10 });

      expect(mockApiAdapter.getPayouts).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10 })
      );
    });

    it('should handle API errors for payouts', async () => {
      mockAuthService.getAccessToken.mockResolvedValue('test-token');
      mockAuthService.getConnectionStatus.mockResolvedValue({ marketplaceId: 'EBAY_GB' });
      mockApiAdapter.getAllPayouts.mockRejectedValue(new Error('Payout API error'));

      const result = await service.syncPayouts(userId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Payout API error');
    });
  });

  describe('financial summary edge cases', () => {
    it('should handle payouts with INITIATED status', async () => {
      const mockTransactions: unknown[] = [];
      const mockPayouts = [
        { payout_status: 'SUCCEEDED', amount: '200' },
        { payout_status: 'INITIATED', amount: '100' },
        { payout_status: 'PENDING', amount: '50' },
        { payout_status: 'FAILED', amount: '75' }, // Should not be counted
      ];

      mockSupabase.from.mockImplementation((table: string) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => {
          if (table === 'ebay_transactions') {
            resolve({ data: mockTransactions, error: null });
          } else {
            resolve({ data: mockPayouts, error: null });
          }
          return Promise.resolve({
            data: table === 'ebay_transactions' ? mockTransactions : mockPayouts,
            error: null,
          });
        }),
      }));

      const result = await service.getFinancialSummary(
        userId,
        new Date('2025-01-01'),
        new Date('2025-01-31')
      );

      expect(result).not.toBeNull();
      expect(result!.totalPayouts).toBe(200); // Only SUCCEEDED
      expect(result!.pendingPayouts).toBe(150); // INITIATED + PENDING
    });

    it('should return null when payout fetch fails', async () => {
      const mockTransactions = [
        { transaction_type: 'SALE', booking_entry: 'CREDIT', amount: '100', currency: 'GBP' },
      ];

      let callCount = 0;
      mockSupabase.from.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => {
          callCount++;
          if (callCount === 1) {
            resolve({ data: mockTransactions, error: null });
          } else {
            resolve({ data: null, error: { message: 'Payout fetch error' } });
          }
          return Promise.resolve({ data: null, error: null });
        }),
      }));

      const result = await service.getFinancialSummary(
        userId,
        new Date('2025-01-01'),
        new Date('2025-01-31')
      );

      expect(result).toBeNull();
    });

    it('should handle transactions without fee amounts', async () => {
      const mockTransactions = [
        { transaction_type: 'SALE', booking_entry: 'CREDIT', amount: '100', currency: 'GBP' },
        {
          transaction_type: 'SALE',
          booking_entry: 'CREDIT',
          amount: '200',
          total_fee_amount: null,
          currency: 'GBP',
        },
      ];

      mockSupabase.from.mockImplementation((table: string) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => {
          if (table === 'ebay_transactions') {
            resolve({ data: mockTransactions, error: null });
          } else {
            resolve({ data: [], error: null });
          }
          return Promise.resolve({ data: mockTransactions, error: null });
        }),
      }));

      const result = await service.getFinancialSummary(
        userId,
        new Date('2025-01-01'),
        new Date('2025-01-31')
      );

      expect(result).not.toBeNull();
      expect(result!.totalFees).toBe(0);
    });
  });

  describe('default auth service', () => {
    it('should use default EbayAuthService when not provided', () => {
      // Create service without passing auth service
      const defaultService = new EbayFinancesService();
      expect(defaultService).toBeInstanceOf(EbayFinancesService);
    });
  });

  describe('transaction type filtering in sync', () => {
    it('should pass transaction type filter to API', async () => {
      mockAuthService.getAccessToken.mockResolvedValue('test-token');
      mockAuthService.getConnectionStatus.mockResolvedValue({ marketplaceId: 'EBAY_GB' });
      mockApiAdapter.getTransactions.mockResolvedValue({ transactions: [] });

      const mockSyncLogBuilder = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'log-1' }, error: null }),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      };
      mockSupabase.from.mockReturnValue(mockSyncLogBuilder);

      await service.syncTransactions(userId, {
        limit: 10,
        transactionTypes: ['SALE'],
      });

      expect(mockApiAdapter.getTransactions).toHaveBeenCalledWith(
        expect.objectContaining({ transactionType: 'SALE' })
      );
    });
  });

  describe('payout status filtering in sync', () => {
    it('should pass payout status filter to API', async () => {
      mockAuthService.getAccessToken.mockResolvedValue('test-token');
      mockAuthService.getConnectionStatus.mockResolvedValue({ marketplaceId: 'EBAY_GB' });
      mockApiAdapter.getPayouts.mockResolvedValue({ payouts: [] });

      const mockSyncLogBuilder = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'log-1' }, error: null }),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      };
      mockSupabase.from.mockReturnValue(mockSyncLogBuilder);

      await service.syncPayouts(userId, {
        limit: 10,
        payoutStatuses: ['SUCCEEDED'],
      });

      expect(mockApiAdapter.getPayouts).toHaveBeenCalledWith(
        expect.objectContaining({ payoutStatus: 'SUCCEEDED' })
      );
    });
  });
});
