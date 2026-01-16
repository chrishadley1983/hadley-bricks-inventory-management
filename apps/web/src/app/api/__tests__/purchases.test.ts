/**
 * Tests for /api/purchases API Routes
 *
 * Tests the purchases operations:
 * - GET /api/purchases - List purchases with filters
 * - POST /api/purchases - Create a purchase
 * - GET /api/purchases/[id] - Get single purchase
 * - PUT /api/purchases/[id] - Update purchase
 * - DELETE /api/purchases/[id] - Delete purchase
 * - PATCH /api/purchases/bulk - Bulk update purchases
 * - DELETE /api/purchases/bulk - Bulk delete purchases
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the Supabase server client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

// Mock the PurchaseService
const mockPurchaseService = {
  getAll: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  updateBulk: vi.fn(),
  deleteBulk: vi.fn(),
};

vi.mock('@/lib/services', () => ({
  PurchaseService: function MockPurchaseService() {
    return mockPurchaseService;
  },
}));

// Suppress console logs during tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

import { createClient } from '@/lib/supabase/server';
import { GET, POST } from '../purchases/route';
import {
  GET as GetPurchase,
  PUT as UpdatePurchase,
  DELETE as DeletePurchase,
} from '../purchases/[id]/route';
import { PATCH as BulkUpdate, DELETE as BulkDelete } from '../purchases/bulk/route';
import { testPurchases } from '@/test/fixtures';

// ============================================================================
// TEST HELPERS
// ============================================================================

function createMockPurchase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'purchase-001',
    user_id: 'test-user-id',
    purchase_date: '2024-01-15',
    short_description: 'LEGO Collection',
    cost: 199.99,
    source: 'eBay',
    payment_method: 'PayPal',
    description: 'Lot of 5 LEGO sets',
    reference: 'INV-12345',
    image_url: null,
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:00:00Z',
    ...overrides,
  };
}

function createAuthenticatedClient() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'test-user-id' } },
        error: null,
      }),
    },
  };
}

function createUnauthenticatedClient() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: null },
        error: { message: 'Not authenticated' },
      }),
    },
  };
}

const VALID_UUID_1 = '550e8400-e29b-41d4-a716-446655440001';
const VALID_UUID_2 = '550e8400-e29b-41d4-a716-446655440002';

describe('Purchases API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/purchases', () => {
    it('should return 401 when not authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: null },
            error: { message: 'Not authenticated' },
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const request = new NextRequest('http://localhost:3000/api/purchases');
      const response = await GET(request);

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toBe('Unauthorized');
    });

    it('should return purchases when authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'test-user-id' } },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const purchases = Object.values(testPurchases);
      mockPurchaseService.getAll.mockResolvedValue({
        data: purchases,
        total: purchases.length,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      });

      const request = new NextRequest('http://localhost:3000/api/purchases');
      const response = await GET(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data).toBeDefined();
    });

    it('should filter by source', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'test-user-id' } },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      mockPurchaseService.getAll.mockResolvedValue({
        data: [testPurchases.onlinePurchase],
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      });

      const request = new NextRequest(
        'http://localhost:3000/api/purchases?source=eBay'
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockPurchaseService.getAll).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'eBay' }),
        expect.any(Object)
      );
    });

    it('should filter by date range', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'test-user-id' } },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      mockPurchaseService.getAll.mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        pageSize: 50,
        totalPages: 0,
      });

      const request = new NextRequest(
        'http://localhost:3000/api/purchases?dateFrom=2024-01-01&dateTo=2024-12-31'
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockPurchaseService.getAll).toHaveBeenCalledWith(
        expect.objectContaining({
          dateFrom: '2024-01-01',
          dateTo: '2024-12-31',
        }),
        expect.any(Object)
      );
    });

    it('should handle search parameter', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'test-user-id' } },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      mockPurchaseService.getAll.mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        pageSize: 50,
        totalPages: 0,
      });

      const request = new NextRequest(
        'http://localhost:3000/api/purchases?search=Millennium'
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockPurchaseService.getAll).toHaveBeenCalledWith(
        expect.objectContaining({ searchTerm: 'Millennium' }),
        expect.any(Object)
      );
    });

    it('should handle pagination', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'test-user-id' } },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      mockPurchaseService.getAll.mockResolvedValue({
        data: [],
        total: 100,
        page: 2,
        pageSize: 20,
        totalPages: 5,
      });

      const request = new NextRequest(
        'http://localhost:3000/api/purchases?page=2&pageSize=20'
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockPurchaseService.getAll).toHaveBeenCalledWith(
        expect.any(Object),
        { page: 2, pageSize: 20 }
      );
    });

    it('should return 400 for invalid query parameters', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'test-user-id' } },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const request = new NextRequest(
        'http://localhost:3000/api/purchases?pageSize=500' // Max is 100
      );
      const response = await GET(request);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe('Invalid query parameters');
    });
  });

  describe('POST /api/purchases', () => {
    it('should return 401 when not authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: null },
            error: { message: 'Not authenticated' },
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const request = new NextRequest('http://localhost:3000/api/purchases', {
        method: 'POST',
        body: JSON.stringify({ purchase_date: '2024-12-20' }),
      });
      const response = await POST(request);

      expect(response.status).toBe(401);
    });

    it('should return 400 for invalid input', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'test-user-id' } },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const request = new NextRequest('http://localhost:3000/api/purchases', {
        method: 'POST',
        body: JSON.stringify({
          purchase_date: '', // Invalid - empty
          short_description: '', // Invalid - empty
          cost: -10, // Invalid - negative
        }),
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe('Validation failed');
    });

    it('should create purchase with valid input', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'test-user-id' } },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const newPurchase = {
        purchase_date: '2024-12-20',
        short_description: 'Car Boot Sale Haul',
        cost: 150.0,
        source: 'Car Boot Sale',
        payment_method: 'cash',
      };

      mockPurchaseService.create.mockResolvedValue({
        id: 'new-purchase-id',
        user_id: 'test-user-id',
        ...newPurchase,
      });

      const request = new NextRequest('http://localhost:3000/api/purchases', {
        method: 'POST',
        body: JSON.stringify(newPurchase),
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
      const json = await response.json();
      expect(json.data.id).toBe('new-purchase-id');
    });

    it('should handle optional image_url', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'test-user-id' } },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const newPurchase = {
        purchase_date: '2024-12-20',
        short_description: 'LEGO Store Purchase',
        cost: 400.0,
        image_url: 'https://example.com/receipt.jpg',
      };

      mockPurchaseService.create.mockResolvedValue({
        id: 'new-purchase-id',
        ...newPurchase,
      });

      const request = new NextRequest('http://localhost:3000/api/purchases', {
        method: 'POST',
        body: JSON.stringify(newPurchase),
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockPurchaseService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          image_url: 'https://example.com/receipt.jpg',
        })
      );
    });

    it('should handle empty image_url as undefined', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'test-user-id' } },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const newPurchase = {
        purchase_date: '2024-12-20',
        short_description: 'Test Purchase',
        cost: 100.0,
        image_url: '',
      };

      mockPurchaseService.create.mockResolvedValue({
        id: 'new-purchase-id',
        ...newPurchase,
        image_url: undefined,
      });

      const request = new NextRequest('http://localhost:3000/api/purchases', {
        method: 'POST',
        body: JSON.stringify(newPurchase),
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockPurchaseService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          image_url: undefined,
        })
      );
    });

    it('should return 500 on service error', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockPurchaseService.create.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest('http://localhost:3000/api/purchases', {
        method: 'POST',
        body: JSON.stringify({
          purchase_date: '2024-01-15',
          short_description: 'Test',
          cost: 100,
        }),
      });
      const response = await POST(request);

      expect(response.status).toBe(500);
    });
  });

  // ==========================================================================
  // GET /api/purchases/[id]
  // ==========================================================================

  describe('GET /api/purchases/[id]', () => {
    it('should return 401 when not authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue(createUnauthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/purchases/purchase-001');
      const response = await GetPurchase(request, {
        params: Promise.resolve({ id: 'purchase-001' }),
      });

      expect(response.status).toBe(401);
    });

    it('should return 404 when purchase not found', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockPurchaseService.getById.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/purchases/nonexistent');
      const response = await GetPurchase(request, {
        params: Promise.resolve({ id: 'nonexistent' }),
      });

      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json.error).toBe('Purchase not found');
    });

    it('should return purchase when found', async () => {
      const purchase = createMockPurchase();
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockPurchaseService.getById.mockResolvedValue(purchase);

      const request = new NextRequest('http://localhost:3000/api/purchases/purchase-001');
      const response = await GetPurchase(request, {
        params: Promise.resolve({ id: 'purchase-001' }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data.id).toBe('purchase-001');
    });

    it('should return 500 on service error', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockPurchaseService.getById.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest('http://localhost:3000/api/purchases/purchase-001');
      const response = await GetPurchase(request, {
        params: Promise.resolve({ id: 'purchase-001' }),
      });

      expect(response.status).toBe(500);
    });
  });

  // ==========================================================================
  // PUT /api/purchases/[id]
  // ==========================================================================

  describe('PUT /api/purchases/[id]', () => {
    it('should return 401 when not authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue(createUnauthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/purchases/purchase-001', {
        method: 'PUT',
        body: JSON.stringify({ cost: 250 }),
      });
      const response = await UpdatePurchase(request, {
        params: Promise.resolve({ id: 'purchase-001' }),
      });

      expect(response.status).toBe(401);
    });

    it('should return 404 when purchase not found', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockPurchaseService.getById.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/purchases/nonexistent', {
        method: 'PUT',
        body: JSON.stringify({ cost: 250 }),
      });
      const response = await UpdatePurchase(request, {
        params: Promise.resolve({ id: 'nonexistent' }),
      });

      expect(response.status).toBe(404);
    });

    it('should return 400 for invalid cost', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockPurchaseService.getById.mockResolvedValue(createMockPurchase());

      const request = new NextRequest('http://localhost:3000/api/purchases/purchase-001', {
        method: 'PUT',
        body: JSON.stringify({ cost: -50 }), // Negative cost
      });
      const response = await UpdatePurchase(request, {
        params: Promise.resolve({ id: 'purchase-001' }),
      });

      expect(response.status).toBe(400);
    });

    it('should update purchase successfully', async () => {
      const updatedPurchase = createMockPurchase({ cost: 250 });
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockPurchaseService.getById.mockResolvedValue(createMockPurchase());
      mockPurchaseService.update.mockResolvedValue(updatedPurchase);

      const request = new NextRequest('http://localhost:3000/api/purchases/purchase-001', {
        method: 'PUT',
        body: JSON.stringify({ cost: 250 }),
      });
      const response = await UpdatePurchase(request, {
        params: Promise.resolve({ id: 'purchase-001' }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data.cost).toBe(250);
    });

    it('should return 500 on service error', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockPurchaseService.getById.mockResolvedValue(createMockPurchase());
      mockPurchaseService.update.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest('http://localhost:3000/api/purchases/purchase-001', {
        method: 'PUT',
        body: JSON.stringify({ cost: 250 }),
      });
      const response = await UpdatePurchase(request, {
        params: Promise.resolve({ id: 'purchase-001' }),
      });

      expect(response.status).toBe(500);
    });
  });

  // ==========================================================================
  // DELETE /api/purchases/[id]
  // ==========================================================================

  describe('DELETE /api/purchases/[id]', () => {
    it('should return 401 when not authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue(createUnauthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/purchases/purchase-001', {
        method: 'DELETE',
      });
      const response = await DeletePurchase(request, {
        params: Promise.resolve({ id: 'purchase-001' }),
      });

      expect(response.status).toBe(401);
    });

    it('should return 404 when purchase not found', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockPurchaseService.getById.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/purchases/nonexistent', {
        method: 'DELETE',
      });
      const response = await DeletePurchase(request, {
        params: Promise.resolve({ id: 'nonexistent' }),
      });

      expect(response.status).toBe(404);
    });

    it('should delete purchase successfully', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockPurchaseService.getById.mockResolvedValue(createMockPurchase());
      mockPurchaseService.delete.mockResolvedValue(undefined);

      const request = new NextRequest('http://localhost:3000/api/purchases/purchase-001', {
        method: 'DELETE',
      });
      const response = await DeletePurchase(request, {
        params: Promise.resolve({ id: 'purchase-001' }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.message).toBe('Purchase deleted successfully');
    });

    it('should return 500 on service error', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockPurchaseService.getById.mockResolvedValue(createMockPurchase());
      mockPurchaseService.delete.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest('http://localhost:3000/api/purchases/purchase-001', {
        method: 'DELETE',
      });
      const response = await DeletePurchase(request, {
        params: Promise.resolve({ id: 'purchase-001' }),
      });

      expect(response.status).toBe(500);
    });
  });

  // ==========================================================================
  // PATCH /api/purchases/bulk
  // ==========================================================================

  describe('PATCH /api/purchases/bulk', () => {
    it('should return 401 when not authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue(createUnauthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/purchases/bulk', {
        method: 'PATCH',
        body: JSON.stringify({
          ids: [VALID_UUID_1],
          updates: { source: 'Amazon' },
        }),
      });
      const response = await BulkUpdate(request);

      expect(response.status).toBe(401);
    });

    it('should return 400 for invalid UUID format', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/purchases/bulk', {
        method: 'PATCH',
        body: JSON.stringify({
          ids: ['not-a-uuid'],
          updates: { source: 'Amazon' },
        }),
      });
      const response = await BulkUpdate(request);

      expect(response.status).toBe(400);
    });

    it('should return 400 for empty ids array', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/purchases/bulk', {
        method: 'PATCH',
        body: JSON.stringify({
          ids: [],
          updates: { source: 'Amazon' },
        }),
      });
      const response = await BulkUpdate(request);

      expect(response.status).toBe(400);
    });

    it('should return 400 when no updates provided', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/purchases/bulk', {
        method: 'PATCH',
        body: JSON.stringify({
          ids: [VALID_UUID_1],
          updates: {},
        }),
      });
      const response = await BulkUpdate(request);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe('No updates provided');
    });

    it('should bulk update purchases successfully', async () => {
      const updatedPurchases = [
        createMockPurchase({ id: VALID_UUID_1, source: 'Amazon' }),
        createMockPurchase({ id: VALID_UUID_2, source: 'Amazon' }),
      ];
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockPurchaseService.updateBulk.mockResolvedValue(updatedPurchases);

      const request = new NextRequest('http://localhost:3000/api/purchases/bulk', {
        method: 'PATCH',
        body: JSON.stringify({
          ids: [VALID_UUID_1, VALID_UUID_2],
          updates: { source: 'Amazon' },
        }),
      });
      const response = await BulkUpdate(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.updated).toBe(2);
    });

    it('should return 500 on service error', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockPurchaseService.updateBulk.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest('http://localhost:3000/api/purchases/bulk', {
        method: 'PATCH',
        body: JSON.stringify({
          ids: [VALID_UUID_1],
          updates: { source: 'Amazon' },
        }),
      });
      const response = await BulkUpdate(request);

      expect(response.status).toBe(500);
    });
  });

  // ==========================================================================
  // DELETE /api/purchases/bulk
  // ==========================================================================

  describe('DELETE /api/purchases/bulk', () => {
    it('should return 401 when not authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue(createUnauthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/purchases/bulk', {
        method: 'DELETE',
        body: JSON.stringify({ ids: [VALID_UUID_1] }),
      });
      const response = await BulkDelete(request);

      expect(response.status).toBe(401);
    });

    it('should return 400 for invalid UUID format', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/purchases/bulk', {
        method: 'DELETE',
        body: JSON.stringify({ ids: ['not-a-uuid'] }),
      });
      const response = await BulkDelete(request);

      expect(response.status).toBe(400);
    });

    it('should return 400 for empty ids array', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/purchases/bulk', {
        method: 'DELETE',
        body: JSON.stringify({ ids: [] }),
      });
      const response = await BulkDelete(request);

      expect(response.status).toBe(400);
    });

    it('should bulk delete purchases successfully', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockPurchaseService.deleteBulk.mockResolvedValue(undefined);

      const request = new NextRequest('http://localhost:3000/api/purchases/bulk', {
        method: 'DELETE',
        body: JSON.stringify({ ids: [VALID_UUID_1, VALID_UUID_2] }),
      });
      const response = await BulkDelete(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.deleted).toBe(2);
    });

    it('should return 500 on service error', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockPurchaseService.deleteBulk.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest('http://localhost:3000/api/purchases/bulk', {
        method: 'DELETE',
        body: JSON.stringify({ ids: [VALID_UUID_1] }),
      });
      const response = await BulkDelete(request);

      expect(response.status).toBe(500);
    });
  });
});
