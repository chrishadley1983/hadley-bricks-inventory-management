import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ArbitrageService } from '../arbitrage.service';

// Create mock Supabase client
const createMockSupabase = () => {
  const mockFrom = vi.fn();

  return {
    from: mockFrom,
    _mockFrom: mockFrom,
  };
};

describe('ArbitrageService', () => {
  let service: ArbitrageService;
  let mockSupabase: ReturnType<typeof createMockSupabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = createMockSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new ArbitrageService(mockSupabase as any);
  });

  describe('getArbitrageData', () => {
    it('should fetch arbitrage data with default options', async () => {
      const userId = 'user-123';

      // Mock excluded eBay listings query
      mockSupabase._mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn(() =>
          Promise.resolve({
            data: [],
            error: null,
          })
        ),
      });

      // Mock main arbitrage query
      mockSupabase._mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        gt: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn(() =>
          Promise.resolve({
            data: [
              {
                asin: 'B001234567',
                user_id: userId,
                name: 'Test LEGO Set',
                margin_percent: 35,
              },
            ],
            count: 1,
            error: null,
          })
        ),
      });

      // Mock opportunity count query
      mockSupabase._mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn(() =>
          Promise.resolve({
            count: 1,
            error: null,
          })
        ),
      });

      const result = await service.getArbitrageData(userId);

      expect(result.items).toHaveLength(1);
      expect(result.totalCount).toBe(1);
      expect(result.items[0].asin).toBe('B001234567');
    });

    it('should apply show filter for opportunities', async () => {
      const userId = 'user-123';

      // Mock excluded eBay listings query
      mockSupabase._mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn(() =>
          Promise.resolve({
            data: [],
            error: null,
          })
        ),
      });

      // Mock main query with gte filter
      const mockGte = vi.fn().mockReturnThis();
      mockSupabase._mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: mockGte,
        not: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        gt: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn(() =>
          Promise.resolve({
            data: [],
            count: 0,
            error: null,
          })
        ),
      });

      // Mock opportunity count
      mockSupabase._mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn(() =>
          Promise.resolve({
            count: 0,
            error: null,
          })
        ),
      });

      await service.getArbitrageData(userId, { show: 'opportunities', minMargin: 30 });

      expect(mockGte).toHaveBeenCalledWith('margin_percent', 30);
    });

    it('should handle errors gracefully', async () => {
      const userId = 'user-123';

      mockSupabase._mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn(() =>
          Promise.resolve({
            data: [],
            error: null,
          })
        ),
      });

      mockSupabase._mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn(() =>
          Promise.resolve({
            data: null,
            count: null,
            error: { message: 'Database error' },
          })
        ),
      });

      await expect(service.getArbitrageData(userId)).rejects.toThrow(
        'Failed to fetch arbitrage data'
      );
    });
  });

  describe('getArbitrageItem', () => {
    it('should fetch a single arbitrage item by ASIN', async () => {
      const userId = 'user-123';
      const asin = 'B001234567';

      mockSupabase._mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(() =>
          Promise.resolve({
            data: {
              asin,
              user_id: userId,
              name: 'Test Set',
              margin_percent: 40,
            },
            error: null,
          })
        ),
      });

      const result = await service.getArbitrageItem(userId, asin);

      expect(result).not.toBeNull();
      expect(result!.asin).toBe(asin);
    });

    it('should return null when item not found', async () => {
      mockSupabase._mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(() =>
          Promise.resolve({
            data: null,
            error: null,
          })
        ),
      });

      const result = await service.getArbitrageItem('user-123', 'non-existent');

      expect(result).toBeNull();
    });
  });

  describe('excludeAsin', () => {
    it('should update ASIN status to excluded', async () => {
      const mockUpdate = vi.fn().mockReturnThis();
      // Chain: update().eq().eq() - need nested eq mock
      const mockEq2 = vi.fn(() => Promise.resolve({ error: null }));
      const mockEq1 = vi.fn(() => ({ eq: mockEq2 }));

      mockSupabase._mockFrom.mockReturnValueOnce({
        update: mockUpdate,
        eq: mockEq1,
      });

      await service.excludeAsin('user-123', 'B001234567', 'Not relevant');

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'excluded',
          exclusion_reason: 'Not relevant',
        })
      );
    });

    it('should handle exclusion without reason', async () => {
      const mockUpdate = vi.fn().mockReturnThis();
      const mockEq2 = vi.fn(() => Promise.resolve({ error: null }));
      const mockEq1 = vi.fn(() => ({ eq: mockEq2 }));

      mockSupabase._mockFrom.mockReturnValueOnce({
        update: mockUpdate,
        eq: mockEq1,
      });

      await service.excludeAsin('user-123', 'B001234567');

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          exclusion_reason: null,
        })
      );
    });
  });

  describe('restoreAsin', () => {
    it('should update ASIN status to active', async () => {
      const mockUpdate = vi.fn().mockReturnThis();
      const mockEq2 = vi.fn(() => Promise.resolve({ error: null }));
      const mockEq1 = vi.fn(() => ({ eq: mockEq2 }));

      mockSupabase._mockFrom.mockReturnValueOnce({
        update: mockUpdate,
        eq: mockEq1,
      });

      await service.restoreAsin('user-123', 'B001234567');

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'active',
          excluded_at: null,
          exclusion_reason: null,
        })
      );
    });
  });

  describe('getExcludedAsins', () => {
    it('should return excluded ASINs with mappings', async () => {
      const userId = 'user-123';

      // Mock excluded ASINs query
      mockSupabase._mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn(() =>
          Promise.resolve({
            data: [
              {
                asin: 'B001234567',
                name: 'Excluded Set',
                excluded_at: '2025-01-01T00:00:00Z',
                exclusion_reason: 'Too expensive',
              },
            ],
            error: null,
          })
        ),
      });

      // Mock mappings query
      mockSupabase._mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn(() =>
          Promise.resolve({
            data: [{ asin: 'B001234567', bricklink_set_number: '75192-1' }],
            error: null,
          })
        ),
      });

      const result = await service.getExcludedAsins(userId);

      expect(result).toHaveLength(1);
      expect(result[0].asin).toBe('B001234567');
      expect(result[0].bricklinkSetNumber).toBe('75192-1');
    });

    it('should return empty array when no excluded ASINs', async () => {
      mockSupabase._mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn(() =>
          Promise.resolve({
            data: [],
            error: null,
          })
        ),
      });

      const result = await service.getExcludedAsins('user-123');

      expect(result).toHaveLength(0);
    });
  });

  describe('getUnmappedAsins', () => {
    it('should return ASINs without BrickLink mappings', async () => {
      const userId = 'user-123';

      // Mock all ASINs query
      mockSupabase._mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn(() =>
          Promise.resolve({
            data: [
              {
                asin: 'B001234567',
                name: 'LEGO 75192 Millennium Falcon',
                image_url: null,
                added_at: '2025-01-01',
              },
              {
                asin: 'B009876543',
                name: 'Some Other Product',
                image_url: null,
                added_at: '2025-01-02',
              },
            ],
            error: null,
          })
        ),
      });

      // Mock mappings query
      mockSupabase._mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn(() =>
          Promise.resolve({
            data: [{ asin: 'B001234567' }],
            error: null,
          })
        ),
      });

      const result = await service.getUnmappedAsins(userId);

      expect(result).toHaveLength(1);
      expect(result[0].asin).toBe('B009876543');
    });
  });

  describe('getUnmappedCount', () => {
    it('should return count of unmapped ASINs', async () => {
      // Mock total count (tracked_asins) - uses .eq().eq() chain
      const mockEq2Total = vi.fn(() =>
        Promise.resolve({
          count: 10,
          error: null,
        })
      );
      mockSupabase._mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn(() => ({ eq: mockEq2Total })),
      });

      // Mock mapped count (asin_bricklink_mapping) - uses single .eq()
      mockSupabase._mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn(() =>
          Promise.resolve({
            count: 7,
            error: null,
          })
        ),
      });

      const result = await service.getUnmappedCount('user-123');

      expect(result).toBe(3); // 10 - 7
    });
  });

  describe('createManualMapping', () => {
    it('should create a manual ASIN to BrickLink mapping', async () => {
      const mockUpsert = vi.fn(() => Promise.resolve({ error: null }));

      mockSupabase._mockFrom.mockReturnValueOnce({
        upsert: mockUpsert,
      });

      await service.createManualMapping('user-123', 'B001234567', '75192-1');

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          asin: 'B001234567',
          bricklink_set_number: '75192-1',
          match_confidence: 'manual',
          match_method: 'user_manual_entry',
        })
      );
    });
  });

  describe('getSyncStatus', () => {
    it('should return sync status for all job types', async () => {
      mockSupabase._mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn(() =>
          Promise.resolve({
            data: [
              {
                id: 'status-1',
                user_id: 'user-123',
                job_type: 'amazon_pricing',
                status: 'completed',
                last_run_at: '2025-01-01T12:00:00Z',
                items_processed: 100,
                items_failed: 2,
              },
            ],
            error: null,
          })
        ),
      });

      const result = await service.getSyncStatus('user-123');

      expect(result.amazon_pricing).not.toBeNull();
      expect(result.amazon_pricing!.itemsProcessed).toBe(100);
      expect(result.bricklink_pricing).toBeNull();
    });
  });

  describe('getSummaryStats', () => {
    it('should return summary statistics', async () => {
      // Mock total items count (tracked_asins) - .eq().eq() chain
      const mockEq2Total = vi.fn(() =>
        Promise.resolve({
          count: 100,
          error: null,
        })
      );
      mockSupabase._mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn(() => ({ eq: mockEq2Total })),
      });

      // Mock opportunities count (arbitrage_current_view) - .eq().gte() chain
      mockSupabase._mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn(() => ({
          gte: vi.fn(() =>
            Promise.resolve({
              count: 25,
              error: null,
            })
          ),
        })),
      });

      // Mock eBay opportunities count (arbitrage_current_view) - .eq().gte() chain
      mockSupabase._mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn(() => ({
          gte: vi.fn(() =>
            Promise.resolve({
              count: 15,
              error: null,
            })
          ),
        })),
      });

      // Mock excluded count (tracked_asins) - .eq().eq() chain
      const mockEq2Excluded = vi.fn(() =>
        Promise.resolve({
          count: 5,
          error: null,
        })
      );
      mockSupabase._mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn(() => ({ eq: mockEq2Excluded })),
      });

      // Mock for getUnmappedCount - total (tracked_asins) - .eq().eq() chain
      const mockEq2UnmappedTotal = vi.fn(() =>
        Promise.resolve({
          count: 100,
          error: null,
        })
      );
      mockSupabase._mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn(() => ({ eq: mockEq2UnmappedTotal })),
      });

      // Mock for getUnmappedCount - mapped (asin_bricklink_mapping) - single .eq()
      mockSupabase._mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn(() =>
          Promise.resolve({
            count: 90,
            error: null,
          })
        ),
      });

      const result = await service.getSummaryStats('user-123');

      expect(result.totalItems).toBe(100);
      expect(result.opportunities).toBe(25);
      expect(result.ebayOpportunities).toBe(15);
      expect(result.excluded).toBe(5);
      expect(result.unmapped).toBe(10);
    });
  });
});
