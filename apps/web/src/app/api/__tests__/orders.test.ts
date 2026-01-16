/**
 * Tests for /api/orders API Routes
 *
 * Tests the orders operations:
 * - GET /api/orders - List orders with filters
 * - GET /api/orders/[id] - Get single order
 * - DELETE /api/orders/[id] - Delete order
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the Supabase server client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

// Mock the OrderRepository
const mockOrderRepo = {
  findByUser: vi.fn(),
  findById: vi.fn(),
  findByIdWithItems: vi.fn(),
  delete: vi.fn(),
};

vi.mock('@/lib/repositories', () => ({
  OrderRepository: class MockOrderRepository {
    findByUser = mockOrderRepo.findByUser;
    findById = mockOrderRepo.findById;
    findByIdWithItems = mockOrderRepo.findByIdWithItems;
    delete = mockOrderRepo.delete;
  },
}));

// Suppress console logs during tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

import { createClient } from '@/lib/supabase/server';
import { GET } from '../orders/route';
import { GET as GetOrder, DELETE as DeleteOrder } from '../orders/[id]/route';
import { testBrickLinkOrders, testBrickOwlOrders } from '@/test/fixtures';

// ============================================================================
// TEST HELPERS
// ============================================================================

function createMockOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-001',
    user_id: 'test-user-id',
    platform: 'ebay',
    platform_order_id: 'ebay-12345',
    buyer_name: 'Test Buyer',
    status: 'Paid',
    total_amount: 99.99,
    currency: 'GBP',
    order_date: '2024-01-15T10:00:00Z',
    created_at: '2024-01-15T10:00:00Z',
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

describe('Orders API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/orders', () => {
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

      const request = new NextRequest('http://localhost:3000/api/orders');
      const response = await GET(request);

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toBe('Unauthorized');
    });

    it('should return paginated orders when authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'test-user-id' } },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      mockOrderRepo.findByUser.mockResolvedValue({
        data: testBrickLinkOrders,
        page: 1,
        pageSize: 50,
        total: 2,
        totalPages: 1,
      });

      const request = new NextRequest('http://localhost:3000/api/orders');
      const response = await GET(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data).toBeDefined();
      expect(json.data).toHaveLength(2);
      expect(json.pagination).toBeDefined();
      expect(json.pagination.total).toBe(2);
    });

    it('should filter orders by platform', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'test-user-id' } },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      mockOrderRepo.findByUser.mockResolvedValue({
        data: testBrickLinkOrders,
        page: 1,
        pageSize: 50,
        total: 2,
        totalPages: 1,
      });

      const request = new NextRequest(
        'http://localhost:3000/api/orders?platform=bricklink'
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockOrderRepo.findByUser).toHaveBeenCalledWith(
        'test-user-id',
        expect.objectContaining({ platform: 'bricklink' }),
        expect.any(Object)
      );
    });

    it('should filter orders by status', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'test-user-id' } },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const paidOrders = testBrickLinkOrders.filter((o) => o.status === 'Paid');
      mockOrderRepo.findByUser.mockResolvedValue({
        data: paidOrders,
        page: 1,
        pageSize: 50,
        total: paidOrders.length,
        totalPages: 1,
      });

      const request = new NextRequest('http://localhost:3000/api/orders?status=Paid');
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockOrderRepo.findByUser).toHaveBeenCalledWith(
        'test-user-id',
        expect.objectContaining({ status: 'Paid' }),
        expect.any(Object)
      );
    });

    it('should filter orders by date range', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'test-user-id' } },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      mockOrderRepo.findByUser.mockResolvedValue({
        data: testBrickLinkOrders,
        page: 1,
        pageSize: 50,
        total: 2,
        totalPages: 1,
      });

      const startDate = '2024-12-01T00:00:00Z';
      const endDate = '2024-12-31T23:59:59Z';
      const request = new NextRequest(
        `http://localhost:3000/api/orders?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockOrderRepo.findByUser).toHaveBeenCalledWith(
        'test-user-id',
        expect.objectContaining({
          startDate: expect.any(Date),
          endDate: expect.any(Date),
        }),
        expect.any(Object)
      );
    });

    it('should handle pagination parameters', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'test-user-id' } },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      mockOrderRepo.findByUser.mockResolvedValue({
        data: [],
        page: 2,
        pageSize: 20,
        total: 50,
        totalPages: 3,
      });

      const request = new NextRequest(
        'http://localhost:3000/api/orders?page=2&pageSize=20'
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockOrderRepo.findByUser).toHaveBeenCalledWith(
        'test-user-id',
        expect.any(Object),
        { page: 2, pageSize: 20 }
      );

      const json = await response.json();
      expect(json.pagination.page).toBe(2);
      expect(json.pagination.pageSize).toBe(20);
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
        'http://localhost:3000/api/orders?page=-1'
      );
      const response = await GET(request);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe('Invalid query parameters');
    });

    it('should combine multiple filters', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'test-user-id' } },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      mockOrderRepo.findByUser.mockResolvedValue({
        data: [testBrickOwlOrders[0]],
        page: 1,
        pageSize: 50,
        total: 1,
        totalPages: 1,
      });

      const request = new NextRequest(
        'http://localhost:3000/api/orders?platform=brickowl&status=Processing'
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockOrderRepo.findByUser).toHaveBeenCalledWith(
        'test-user-id',
        expect.objectContaining({
          platform: 'brickowl',
          status: 'Processing',
        }),
        expect.any(Object)
      );
    });

    it('should return 500 on service error', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockOrderRepo.findByUser.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest('http://localhost:3000/api/orders');
      const response = await GET(request);

      expect(response.status).toBe(500);
    });
  });

  // ==========================================================================
  // GET /api/orders/[id]
  // ==========================================================================

  describe('GET /api/orders/[id]', () => {
    it('should return 401 when not authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue(createUnauthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/orders/order-001');
      const response = await GetOrder(request, { params: Promise.resolve({ id: 'order-001' }) });

      expect(response.status).toBe(401);
    });

    it('should return 404 when order not found', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockOrderRepo.findByIdWithItems.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/orders/nonexistent');
      const response = await GetOrder(request, { params: Promise.resolve({ id: 'nonexistent' }) });

      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json.error).toBe('Order not found');
    });

    it('should return 403 when accessing another users order', async () => {
      const otherUserOrder = createMockOrder({ user_id: 'other-user-456' });
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockOrderRepo.findByIdWithItems.mockResolvedValue(otherUserOrder);

      const request = new NextRequest('http://localhost:3000/api/orders/order-001');
      const response = await GetOrder(request, { params: Promise.resolve({ id: 'order-001' }) });

      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json.error).toBe('Forbidden');
    });

    it('should return order with items when found', async () => {
      const orderWithItems = {
        ...createMockOrder(),
        order_items: [
          { id: 'item-1', quantity: 1, unit_price: 49.99 },
          { id: 'item-2', quantity: 2, unit_price: 25.0 },
        ],
      };
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockOrderRepo.findByIdWithItems.mockResolvedValue(orderWithItems);

      const request = new NextRequest('http://localhost:3000/api/orders/order-001');
      const response = await GetOrder(request, { params: Promise.resolve({ id: 'order-001' }) });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data.id).toBe('order-001');
      expect(json.data.order_items).toHaveLength(2);
    });

    it('should return 500 on service error', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockOrderRepo.findByIdWithItems.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest('http://localhost:3000/api/orders/order-001');
      const response = await GetOrder(request, { params: Promise.resolve({ id: 'order-001' }) });

      expect(response.status).toBe(500);
    });
  });

  // ==========================================================================
  // DELETE /api/orders/[id]
  // ==========================================================================

  describe('DELETE /api/orders/[id]', () => {
    it('should return 401 when not authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue(createUnauthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/orders/order-001', {
        method: 'DELETE',
      });
      const response = await DeleteOrder(request, { params: Promise.resolve({ id: 'order-001' }) });

      expect(response.status).toBe(401);
    });

    it('should return 404 when order not found', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockOrderRepo.findById.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/orders/nonexistent', {
        method: 'DELETE',
      });
      const response = await DeleteOrder(request, {
        params: Promise.resolve({ id: 'nonexistent' }),
      });

      expect(response.status).toBe(404);
    });

    it('should return 403 when deleting another users order', async () => {
      const otherUserOrder = createMockOrder({ user_id: 'other-user-456' });
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockOrderRepo.findById.mockResolvedValue(otherUserOrder);

      const request = new NextRequest('http://localhost:3000/api/orders/order-001', {
        method: 'DELETE',
      });
      const response = await DeleteOrder(request, { params: Promise.resolve({ id: 'order-001' }) });

      expect(response.status).toBe(403);
    });

    it('should delete order successfully', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockOrderRepo.findById.mockResolvedValue(createMockOrder());
      mockOrderRepo.delete.mockResolvedValue(undefined);

      const request = new NextRequest('http://localhost:3000/api/orders/order-001', {
        method: 'DELETE',
      });
      const response = await DeleteOrder(request, { params: Promise.resolve({ id: 'order-001' }) });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(mockOrderRepo.delete).toHaveBeenCalledWith('order-001');
    });

    it('should return 500 on service error', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockOrderRepo.findById.mockResolvedValue(createMockOrder());
      mockOrderRepo.delete.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest('http://localhost:3000/api/orders/order-001', {
        method: 'DELETE',
      });
      const response = await DeleteOrder(request, { params: Promise.resolve({ id: 'order-001' }) });

      expect(response.status).toBe(500);
    });
  });
});
