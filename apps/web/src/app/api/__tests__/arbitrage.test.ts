import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock Supabase client
const mockSupabaseClient = {
  auth: {
    getUser: vi.fn(),
  },
  from: vi.fn(),
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabaseClient)),
}));

// Mock ArbitrageService
const mockServiceMethods = {
  getArbitrageData: vi.fn(),
  getArbitrageItem: vi.fn(),
  excludeAsin: vi.fn(),
  restoreAsin: vi.fn(),
  createManualMapping: vi.fn(),
};

vi.mock('@/lib/arbitrage', () => ({
  ArbitrageService: function MockArbitrageService() {
    return mockServiceMethods;
  },
  MappingService: function MockMappingService() {
    return {
      validateSetNumber: vi.fn(),
      deleteMapping: vi.fn(),
    };
  },
}));

// Import routes after mocking
import { GET as getArbitrage } from '../arbitrage/route';
import { GET as getArbitrageItem, PATCH as patchArbitrageItem } from '../arbitrage/[asin]/route';
import { POST as postMapping, DELETE as deleteMapping } from '../arbitrage/mapping/route';

describe('Arbitrage API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================
  // GET /api/arbitrage
  // ============================================

  describe('GET /api/arbitrage', () => {
    it('should return 401 when not authenticated', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'Not authenticated' },
      });

      const request = new NextRequest('http://localhost/api/arbitrage');
      const response = await getArbitrage(request);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('Unauthorized');
    });

    it('should return arbitrage data with default parameters', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
        error: null,
      });

      mockServiceMethods.getArbitrageData.mockResolvedValueOnce({
        items: [{ asin: 'B07FQ1XXYJ', name: 'LEGO 75192', marginPercent: 35 }],
        totalCount: 1,
        opportunityCount: 1,
        hasMore: false,
      });

      const request = new NextRequest('http://localhost/api/arbitrage');
      const response = await getArbitrage(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0].asin).toBe('B07FQ1XXYJ');
    });

    it('should pass filter parameters to service', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
        error: null,
      });

      mockServiceMethods.getArbitrageData.mockResolvedValueOnce({
        items: [],
        totalCount: 0,
        opportunityCount: 0,
        hasMore: false,
      });

      const url =
        'http://localhost/api/arbitrage?minMargin=40&show=opportunities&sortField=margin&sortDirection=desc&page=2&pageSize=50';
      const request = new NextRequest(url);
      await getArbitrage(request);

      expect(mockServiceMethods.getArbitrageData).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          minMargin: 40,
          show: 'opportunities',
          sortField: 'margin',
          sortDirection: 'desc',
          page: 2,
          pageSize: 50,
        })
      );
    });

    it('should return 400 for invalid filter parameters', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
        error: null,
      });

      const url = 'http://localhost/api/arbitrage?minMargin=200'; // Invalid: > 100
      const request = new NextRequest(url);
      const response = await getArbitrage(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Invalid parameters');
    });

    it('should return 400 for invalid show filter', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
        error: null,
      });

      const url = 'http://localhost/api/arbitrage?show=invalid_filter';
      const request = new NextRequest(url);
      const response = await getArbitrage(request);

      expect(response.status).toBe(400);
    });

    it('should use default values when parameters not provided', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
        error: null,
      });

      mockServiceMethods.getArbitrageData.mockResolvedValueOnce({
        items: [],
        totalCount: 0,
        opportunityCount: 0,
        hasMore: false,
      });

      const request = new NextRequest('http://localhost/api/arbitrage');
      await getArbitrage(request);

      expect(mockServiceMethods.getArbitrageData).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          minMargin: 30, // default
          show: 'all', // default
          sortField: 'margin', // default
          sortDirection: 'desc', // default
          page: 1, // default
          pageSize: 100, // default
        })
      );
    });

    it('should handle search parameter', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
        error: null,
      });

      mockServiceMethods.getArbitrageData.mockResolvedValueOnce({
        items: [],
        totalCount: 0,
        opportunityCount: 0,
        hasMore: false,
      });

      const url = 'http://localhost/api/arbitrage?search=millennium';
      const request = new NextRequest(url);
      await getArbitrage(request);

      expect(mockServiceMethods.getArbitrageData).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          search: 'millennium',
        })
      );
    });
  });

  // ============================================
  // GET /api/arbitrage/[asin]
  // ============================================

  describe('GET /api/arbitrage/[asin]', () => {
    it('should return 401 when not authenticated', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'Not authenticated' },
      });

      const request = new NextRequest('http://localhost/api/arbitrage/B07FQ1XXYJ');
      const response = await getArbitrageItem(request, {
        params: Promise.resolve({ asin: 'B07FQ1XXYJ' }),
      });

      expect(response.status).toBe(401);
    });

    it('should return 400 for invalid ASIN (too short)', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/arbitrage/SHORT');
      const response = await getArbitrageItem(request, {
        params: Promise.resolve({ asin: 'SHORT' }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Invalid ASIN');
    });

    it('should return 404 when item not found', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
        error: null,
      });

      mockServiceMethods.getArbitrageItem.mockResolvedValueOnce(null);

      const request = new NextRequest('http://localhost/api/arbitrage/B000000000');
      const response = await getArbitrageItem(request, {
        params: Promise.resolve({ asin: 'B000000000' }),
      });

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toBe('Item not found');
    });

    it('should return arbitrage item details', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
        error: null,
      });

      const mockItem = {
        asin: 'B07FQ1XXYJ',
        name: 'LEGO Star Wars 75192',
        marginPercent: 35,
        blMinPrice: 650,
        buyBoxPrice: 849,
      };
      mockServiceMethods.getArbitrageItem.mockResolvedValueOnce(mockItem);

      const request = new NextRequest('http://localhost/api/arbitrage/B07FQ1XXYJ');
      const response = await getArbitrageItem(request, {
        params: Promise.resolve({ asin: 'B07FQ1XXYJ' }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.asin).toBe('B07FQ1XXYJ');
      expect(body.data.marginPercent).toBe(35);
    });
  });

  // ============================================
  // PATCH /api/arbitrage/[asin]
  // ============================================

  describe('PATCH /api/arbitrage/[asin]', () => {
    it('should return 401 when not authenticated', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'Not authenticated' },
      });

      const request = new NextRequest('http://localhost/api/arbitrage/B07FQ1XXYJ', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'exclude' }),
      });

      const response = await patchArbitrageItem(request, {
        params: Promise.resolve({ asin: 'B07FQ1XXYJ' }),
      });

      expect(response.status).toBe(401);
    });

    it('should return 400 for invalid ASIN', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/arbitrage/SHORT', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'exclude' }),
      });

      const response = await patchArbitrageItem(request, {
        params: Promise.resolve({ asin: 'SHORT' }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Invalid ASIN');
    });

    it('should return 400 for invalid action', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/arbitrage/B07FQ1XXYJ', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'invalid' }),
      });

      const response = await patchArbitrageItem(request, {
        params: Promise.resolve({ asin: 'B07FQ1XXYJ' }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Invalid request body');
    });

    it('should exclude ASIN successfully', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
        error: null,
      });

      mockServiceMethods.excludeAsin.mockResolvedValueOnce(undefined);

      const request = new NextRequest('http://localhost/api/arbitrage/B07FQ1XXYJ', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'exclude', reason: 'Not relevant' }),
      });

      const response = await patchArbitrageItem(request, {
        params: Promise.resolve({ asin: 'B07FQ1XXYJ' }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.success).toBe(true);
      expect(body.message).toBe('ASIN excluded successfully');

      expect(mockServiceMethods.excludeAsin).toHaveBeenCalledWith(
        'user-123',
        'B07FQ1XXYJ',
        'Not relevant'
      );
    });

    it('should restore ASIN successfully', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
        error: null,
      });

      mockServiceMethods.restoreAsin.mockResolvedValueOnce(undefined);

      const request = new NextRequest('http://localhost/api/arbitrage/B07FQ1XXYJ', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'restore' }),
      });

      const response = await patchArbitrageItem(request, {
        params: Promise.resolve({ asin: 'B07FQ1XXYJ' }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.success).toBe(true);
      expect(body.message).toBe('ASIN restored successfully');

      expect(mockServiceMethods.restoreAsin).toHaveBeenCalledWith('user-123', 'B07FQ1XXYJ');
    });

    it('should exclude ASIN without reason', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
        error: null,
      });

      mockServiceMethods.excludeAsin.mockResolvedValueOnce(undefined);

      const request = new NextRequest('http://localhost/api/arbitrage/B07FQ1XXYJ', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'exclude' }),
      });

      const response = await patchArbitrageItem(request, {
        params: Promise.resolve({ asin: 'B07FQ1XXYJ' }),
      });

      expect(response.status).toBe(200);
      expect(mockServiceMethods.excludeAsin).toHaveBeenCalledWith(
        'user-123',
        'B07FQ1XXYJ',
        undefined
      );
    });
  });

  // ============================================
  // POST /api/arbitrage/mapping
  // ============================================

  describe('POST /api/arbitrage/mapping', () => {
    it('should return 401 when not authenticated', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'Not authenticated' },
      });

      const request = new NextRequest('http://localhost/api/arbitrage/mapping', {
        method: 'POST',
        body: JSON.stringify({
          asin: 'B07FQ1XXYJ',
          bricklinkSetNumber: '75192-1',
        }),
      });

      const response = await postMapping(request);

      expect(response.status).toBe(401);
    });

    it('should return 400 for invalid ASIN length', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/arbitrage/mapping', {
        method: 'POST',
        body: JSON.stringify({
          asin: 'SHORT',
          bricklinkSetNumber: '75192-1',
        }),
      });

      const response = await postMapping(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Invalid request body');
    });

    it('should return 400 for invalid set number format', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/arbitrage/mapping', {
        method: 'POST',
        body: JSON.stringify({
          asin: 'B07FQ1XXYJ',
          bricklinkSetNumber: '75192', // Missing -1 suffix
        }),
      });

      const response = await postMapping(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Invalid request body');
    });
  });

  // ============================================
  // DELETE /api/arbitrage/mapping
  // ============================================

  describe('DELETE /api/arbitrage/mapping', () => {
    it('should return 401 when not authenticated', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'Not authenticated' },
      });

      const request = new NextRequest('http://localhost/api/arbitrage/mapping', {
        method: 'DELETE',
        body: JSON.stringify({ asin: 'B07FQ1XXYJ' }),
      });

      const response = await deleteMapping(request);

      expect(response.status).toBe(401);
    });

    it('should return 400 for invalid ASIN length', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/arbitrage/mapping', {
        method: 'DELETE',
        body: JSON.stringify({ asin: 'SHORT' }),
      });

      const response = await deleteMapping(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Invalid request body');
    });
  });
});
