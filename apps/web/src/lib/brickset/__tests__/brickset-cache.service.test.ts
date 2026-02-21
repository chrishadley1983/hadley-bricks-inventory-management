/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BricksetCacheService } from '../brickset-cache.service';
import type { SupabaseClient } from '@supabase/supabase-js';

// Mock the Supabase server module
vi.mock('../../supabase/server', () => ({
  createServiceRoleClient: vi.fn(() => createMockSupabaseClient()),
}));

// Mock the BricksetApiClient
vi.mock('../brickset-api', () => ({
  BricksetApiClient: vi.fn().mockImplementation(() => ({
    getSetByNumber: vi.fn(),
    searchSets: vi.fn(),
  })),
}));

// Helper to create mock Supabase client with proper chainable promise support
function createMockSupabaseClient() {
  // Default results that can be configured per-test
  let queryResult = { data: null as any, error: null as any, count: null as number | null };

  // Create a chainable that returns Promise when awaited
  const createChainable = () => {
    const chainable: Record<string, any> = {
      select: vi.fn(() => chainable),
      insert: vi.fn(() => chainable),
      upsert: vi.fn(() => chainable),
      update: vi.fn(() => chainable),
      delete: vi.fn(() => chainable),
      eq: vi.fn(() => chainable),
      in: vi.fn(() => chainable),
      or: vi.fn(() => chainable),
      not: vi.fn(() => chainable),
      is: vi.fn(() => chainable),
      order: vi.fn(() => chainable),
      limit: vi.fn(() => chainable),
      single: vi.fn(() => Promise.resolve({ data: queryResult.data, error: queryResult.error })),
      // Make this awaitable
      then: (resolve: (v: any) => void) => Promise.resolve(queryResult).then(resolve),
      catch: (reject: (e: any) => void) => Promise.resolve(queryResult).catch(reject),
    };
    return chainable;
  };

  const mockQueryBuilder = createChainable();

  return {
    from: vi.fn(() => mockQueryBuilder),
    _queryBuilder: mockQueryBuilder,
    setQueryResult: (result: { data?: any; error?: any; count?: number | null }) => {
      queryResult = {
        data: result.data ?? null,
        error: result.error ?? null,
        count: result.count ?? null,
      };
    },
    setSingleResult: (result: { data?: any; error?: any }) => {
      queryResult = { ...queryResult, data: result.data ?? null, error: result.error ?? null };
    },
  } as unknown as SupabaseClient & {
    _queryBuilder: typeof mockQueryBuilder;
    setQueryResult: (result: { data?: any; error?: any; count?: number | null }) => void;
    setSingleResult: (result: { data?: any; error?: any }) => void;
  };
}

describe('BricksetCacheService', () => {
  let mockSupabase: ReturnType<typeof createMockSupabaseClient>;
  let service: BricksetCacheService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
    service = new BricksetCacheService(mockSupabase as unknown as SupabaseClient);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getCachedSet', () => {
    it('should return cached set when found', async () => {
      const mockDbRow = {
        id: 'uuid-123',
        set_number: '75192-1',
        set_name: 'Millennium Falcon',
        theme: 'Star Wars',
        year_from: 2017,
        year_to: 2017,
        pieces: 7541,
        uk_rrp: 649.99,
        image_url: 'https://example.com/75192.jpg',
        last_fetched_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockSupabase.setSingleResult({
        data: mockDbRow,
        error: null,
      });

      const result = await service.getCachedSet('75192-1');

      expect(mockSupabase.from).toHaveBeenCalledWith('brickset_sets');
      expect(mockSupabase._queryBuilder.eq).toHaveBeenCalledWith('set_number', '75192-1');
      expect(result).not.toBeNull();
      expect(result?.setNumber).toBe('75192-1');
      expect(result?.setName).toBe('Millennium Falcon');
    });

    it('should return null when set not found', async () => {
      mockSupabase.setSingleResult({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });

      const result = await service.getCachedSet('99999-1');

      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      mockSupabase.setSingleResult({
        data: null,
        error: { code: 'UNKNOWN', message: 'Database error' },
      });

      const result = await service.getCachedSet('75192-1');

      expect(result).toBeNull();
    });
  });

  describe('isCached', () => {
    it('should return true when set exists in cache', async () => {
      // Mock the query chain for count
      mockSupabase._queryBuilder.select.mockReturnValueOnce({
        eq: vi.fn().mockResolvedValueOnce({ count: 1, error: null }),
      });

      const result = await service.isCached('75192-1');

      expect(result).toBe(true);
    });

    it('should return false when set not in cache', async () => {
      mockSupabase._queryBuilder.select.mockReturnValueOnce({
        eq: vi.fn().mockResolvedValueOnce({ count: 0, error: null }),
      });

      const result = await service.isCached('99999-1');

      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      mockSupabase._queryBuilder.select.mockReturnValueOnce({
        eq: vi.fn().mockResolvedValueOnce({
          count: null,
          error: { message: 'Error' },
        }),
      });

      const result = await service.isCached('75192-1');

      expect(result).toBe(false);
    });
  });

  describe('isFresh', () => {
    it('should return false when set not cached', async () => {
      mockSupabase.setSingleResult({
        data: null,
        error: { code: 'PGRST116' },
      });

      const result = await service.isFresh('99999-1');

      expect(result).toBe(false);
    });

    it('should return true when set was fetched recently', async () => {
      const recentDate = new Date().toISOString();
      mockSupabase.setSingleResult({
        data: {
          set_number: '75192-1',
          set_name: 'Test',
          last_fetched_at: recentDate,
        },
        error: null,
      });

      const result = await service.isFresh('75192-1');

      expect(result).toBe(true);
    });

    it('should return false when set was fetched over 30 days ago', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 31);
      mockSupabase.setSingleResult({
        data: {
          set_number: '75192-1',
          set_name: 'Test',
          last_fetched_at: oldDate.toISOString(),
        },
        error: null,
      });

      const result = await service.isFresh('75192-1');

      expect(result).toBe(false);
    });

    it('should return false when last_fetched_at is null', async () => {
      mockSupabase.setSingleResult({
        data: {
          set_number: '75192-1',
          set_name: 'Test',
          last_fetched_at: null,
        },
        error: null,
      });

      const result = await service.isFresh('75192-1');

      expect(result).toBe(false);
    });
  });

  describe('searchSetsLocal', () => {
    it('should search sets in local cache', async () => {
      const mockResults = [
        { set_number: '75192-1', set_name: 'Millennium Falcon', theme: 'Star Wars' },
        { set_number: '10179-1', set_name: 'Millennium Falcon UCS', theme: 'Star Wars' },
      ];

      mockSupabase.setQueryResult({ data: mockResults, error: null });

      const result = await service.searchSetsLocal('Millennium');

      expect(mockSupabase.from).toHaveBeenCalledWith('brickset_sets');
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('should filter by theme when provided', async () => {
      mockSupabase.setQueryResult({ data: [], error: null });

      await service.searchSetsLocal('Falcon', { theme: 'Star Wars' });

      expect(mockSupabase._queryBuilder.eq).toHaveBeenCalledWith('theme', 'Star Wars');
    });

    it('should filter by year when provided', async () => {
      mockSupabase.setQueryResult({ data: [], error: null });

      await service.searchSetsLocal('Falcon', { year: 2017 });

      expect(mockSupabase._queryBuilder.eq).toHaveBeenCalledWith('year_from', 2017);
    });

    it('should respect limit parameter', async () => {
      mockSupabase.setQueryResult({ data: [], error: null });

      await service.searchSetsLocal('test', { limit: 10 });

      expect(mockSupabase._queryBuilder.limit).toHaveBeenCalledWith(10);
    });

    it('should use default limit of 50', async () => {
      mockSupabase.setQueryResult({ data: [], error: null });

      await service.searchSetsLocal('test');

      expect(mockSupabase._queryBuilder.limit).toHaveBeenCalledWith(50);
    });

    it('should return empty array on error', async () => {
      mockSupabase.setQueryResult({
        data: null,
        error: { message: 'Search error' },
      });

      const result = await service.searchSetsLocal('test');

      expect(result).toEqual([]);
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', async () => {
      // Mock total count
      const selectMock1 = {
        select: vi.fn().mockResolvedValueOnce({ count: 1000, error: null }),
      };

      // Mock stale count
      const selectMock2 = {
        select: vi.fn().mockReturnValueOnce({
          or: vi.fn().mockResolvedValueOnce({ count: 100, error: null }),
        }),
      };

      // Mock oldest
      const selectMock3 = {
        select: vi.fn().mockReturnValueOnce({
          not: vi.fn().mockReturnValueOnce({
            order: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockReturnValueOnce({
                single: vi
                  .fn()
                  .mockResolvedValueOnce({ data: { last_fetched_at: '2024-01-01' }, error: null }),
              }),
            }),
          }),
        }),
      };

      // Mock newest
      const selectMock4 = {
        select: vi.fn().mockReturnValueOnce({
          not: vi.fn().mockReturnValueOnce({
            order: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockReturnValueOnce({
                single: vi
                  .fn()
                  .mockResolvedValueOnce({ data: { last_fetched_at: '2024-01-15' }, error: null }),
              }),
            }),
          }),
        }),
      };

      (mockSupabase.from as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(selectMock1)
        .mockReturnValueOnce(selectMock2)
        .mockReturnValueOnce(selectMock3)
        .mockReturnValueOnce(selectMock4);

      const result = await service.getCacheStats();

      expect(result).toHaveProperty('totalSets');
      expect(result).toHaveProperty('freshCount');
      expect(result).toHaveProperty('staleCount');
      expect(result).toHaveProperty('oldestFetch');
      expect(result).toHaveProperty('newestFetch');
    });
  });

  describe('getRecentLookups', () => {
    it('should return recently looked up sets', async () => {
      const mockSets = [
        { set_number: '75192-1', set_name: 'Set 1', last_fetched_at: '2024-01-15' },
        { set_number: '10179-1', set_name: 'Set 2', last_fetched_at: '2024-01-14' },
      ];

      mockSupabase.setQueryResult({ data: mockSets, error: null });

      const result = await service.getRecentLookups(10);

      expect(mockSupabase.from).toHaveBeenCalledWith('brickset_sets');
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('should use default limit of 10', async () => {
      mockSupabase.setQueryResult({ data: [], error: null });

      await service.getRecentLookups();

      expect(mockSupabase._queryBuilder.limit).toHaveBeenCalledWith(10);
    });

    it('should return empty array on error', async () => {
      mockSupabase.setQueryResult({
        data: null,
        error: { message: 'Error' },
      });

      const result = await service.getRecentLookups();

      expect(result).toEqual([]);
    });
  });

  describe('getSet', () => {
    it('should normalize set number without variant suffix', async () => {
      mockSupabase.setSingleResult({
        data: {
          set_number: '75192-1',
          set_name: 'Test',
          last_fetched_at: new Date().toISOString(),
        },
        error: null,
      });

      await service.getSet('75192');

      expect(mockSupabase._queryBuilder.eq).toHaveBeenCalledWith('set_number', '75192-1');
    });

    it('should return cached fresh data without API key', async () => {
      const freshDate = new Date().toISOString();
      mockSupabase.setSingleResult({
        data: { set_number: '75192-1', set_name: 'Test', last_fetched_at: freshDate },
        error: null,
      });

      const result = await service.getSet('75192-1');

      expect(result).not.toBeNull();
      expect(result?.setNumber).toBe('75192-1');
    });

    it('should return stale cached data when no API key provided', async () => {
      const staleDate = new Date();
      staleDate.setDate(staleDate.getDate() - 45);
      mockSupabase.setSingleResult({
        data: {
          set_number: '75192-1',
          set_name: 'Stale Test',
          last_fetched_at: staleDate.toISOString(),
        },
        error: null,
      });

      const result = await service.getSet('75192-1');

      expect(result).not.toBeNull();
      expect(result?.setName).toBe('Stale Test');
    });

    it('should return null when not cached and no API key', async () => {
      mockSupabase.setSingleResult({
        data: null,
        error: { code: 'PGRST116' },
      });

      const result = await service.getSet('99999-1');

      expect(result).toBeNull();
    });
  });

  describe('batchInsertSets', () => {
    it('should batch insert sets', async () => {
      const sets = [
        { setNumber: '75192-1', name: 'Set 1' },
        { setNumber: '10179-1', name: 'Set 2' },
      ];

      // Mock the service role client upsert
      const { createServiceRoleClient } = await import('../../supabase/server');
      const mockServiceClient = createMockSupabaseClient();
      mockServiceClient._queryBuilder.upsert.mockResolvedValueOnce({ error: null });
      vi.mocked(createServiceRoleClient).mockReturnValueOnce(
        mockServiceClient as unknown as SupabaseClient
      );

      const result = await service.batchInsertSets(sets as any);

      expect(result).toHaveProperty('inserted');
      expect(result).toHaveProperty('errors');
    });

    it('should process in batches of 100', async () => {
      const sets = Array.from({ length: 250 }, (_, i) => ({
        setNumber: `${i}-1`,
        name: `Set ${i}`,
      }));

      const { createServiceRoleClient } = await import('../../supabase/server');
      const mockServiceClient = createMockSupabaseClient();
      mockServiceClient._queryBuilder.upsert.mockResolvedValue({ error: null });
      vi.mocked(createServiceRoleClient).mockReturnValue(
        mockServiceClient as unknown as SupabaseClient
      );

      const result = await service.batchInsertSets(sets as any);

      // Should make 3 batches: 100, 100, 50
      expect(mockServiceClient._queryBuilder.upsert).toHaveBeenCalledTimes(3);
      expect(result.inserted).toBe(250);
    });

    it('should track errors during batch insert', async () => {
      const sets = [
        { setNumber: '75192-1', name: 'Set 1' },
        { setNumber: '10179-1', name: 'Set 2' },
      ];

      const { createServiceRoleClient } = await import('../../supabase/server');
      const mockServiceClient = createMockSupabaseClient();
      mockServiceClient._queryBuilder.upsert.mockResolvedValueOnce({
        error: { message: 'Insert error' },
      });
      vi.mocked(createServiceRoleClient).mockReturnValueOnce(
        mockServiceClient as unknown as SupabaseClient
      );

      const result = await service.batchInsertSets(sets as any);

      expect(result.errors).toBe(2);
      expect(result.inserted).toBe(0);
    });
  });
});
