/**
 * Tests for /api/orders/[id]/status and /api/orders/bulk-status API Routes
 *
 * Tests order status operations:
 * - GET /api/orders/[id]/status - Get status history
 * - POST /api/orders/[id]/status - Update order status
 * - POST /api/orders/bulk-status - Bulk update statuses
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the Supabase server client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

// Mock functions for OrderStatusService
const mockGetStatusHistory = vi.fn();
const mockUpdateStatus = vi.fn();
const mockBulkUpdateStatus = vi.fn();
const mockGetEffectiveStatus = vi.fn();
const mockGetAllowedNextStatuses = vi.fn();

// Mock the OrderStatusService as a class
vi.mock('@/lib/services', () => ({
  OrderStatusService: class MockOrderStatusService {
    getStatusHistory = mockGetStatusHistory;
    updateStatus = mockUpdateStatus;
    bulkUpdateStatus = mockBulkUpdateStatus;
    getEffectiveStatus = mockGetEffectiveStatus;
    getAllowedNextStatuses = mockGetAllowedNextStatuses;
  },
}));

// Suppress console logs during tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

import { createClient } from '@/lib/supabase/server';
import { GET, POST } from '../orders/[id]/status/route';
import { POST as BulkStatus } from '../orders/bulk-status/route';

// ============================================================================
// TEST HELPERS
// ============================================================================

const VALID_UUID_1 = '550e8400-e29b-41d4-a716-446655440001';
const VALID_UUID_2 = '550e8400-e29b-41d4-a716-446655440002';

function createAuthenticatedClientWithOrder(
  orderId: string,
  userId: string = 'user-123',
  orderUserId: string = 'user-123'
) {
  const mockFrom = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: {
            id: orderId,
            user_id: orderUserId,
            status: 'Paid',
            internal_status: 'Paid',
          },
          error: null,
        }),
      }),
      in: vi.fn().mockResolvedValue({
        data: [{ id: orderId, user_id: orderUserId }],
        error: null,
      }),
    }),
  });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: userId } },
        error: null,
      }),
    },
    from: mockFrom,
  };
}

function createAuthenticatedClientWithNoOrder() {
  const mockFrom = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { code: 'PGRST116', message: 'Not found' },
        }),
      }),
    }),
  });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      }),
    },
    from: mockFrom,
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

// ============================================================================
// TESTS
// ============================================================================

describe('/api/orders status routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEffectiveStatus.mockReturnValue('Paid');
    mockGetAllowedNextStatuses.mockReturnValue(['Packed', 'Shipped', 'Cancelled']);
  });

  // ==========================================================================
  // GET /api/orders/[id]/status
  // ==========================================================================

  describe('GET /api/orders/[id]/status', () => {
    it('should return 401 when not authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue(createUnauthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/orders/order-001/status');
      const response = await GET(request, { params: Promise.resolve({ id: 'order-001' }) });

      expect(response.status).toBe(401);
    });

    it('should return 404 when order not found', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClientWithNoOrder() as never);

      const request = new NextRequest('http://localhost:3000/api/orders/nonexistent/status');
      const response = await GET(request, { params: Promise.resolve({ id: 'nonexistent' }) });

      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json.error).toBe('Order not found');
    });

    it('should return 403 when accessing another users order', async () => {
      vi.mocked(createClient).mockResolvedValue(
        createAuthenticatedClientWithOrder('order-001', 'user-123', 'other-user') as never
      );

      const request = new NextRequest('http://localhost:3000/api/orders/order-001/status');
      const response = await GET(request, { params: Promise.resolve({ id: 'order-001' }) });

      expect(response.status).toBe(403);
    });

    it('should return status history and allowed transitions', async () => {
      vi.mocked(createClient).mockResolvedValue(
        createAuthenticatedClientWithOrder('order-001') as never
      );
      mockGetStatusHistory.mockResolvedValue([
        { id: '1', status: 'Pending', created_at: '2024-01-15T10:00:00Z' },
        { id: '2', status: 'Paid', created_at: '2024-01-15T11:00:00Z' },
      ]);

      const request = new NextRequest('http://localhost:3000/api/orders/order-001/status');
      const response = await GET(request, { params: Promise.resolve({ id: 'order-001' }) });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data.currentStatus).toBe('Paid');
      expect(json.data.allowedTransitions).toContain('Packed');
      expect(json.data.history).toHaveLength(2);
    });
  });

  // ==========================================================================
  // POST /api/orders/[id]/status
  // ==========================================================================

  describe('POST /api/orders/[id]/status', () => {
    it('should return 401 when not authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue(createUnauthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/orders/order-001/status', {
        method: 'POST',
        body: JSON.stringify({ status: 'Shipped' }),
      });
      const response = await POST(request, { params: Promise.resolve({ id: 'order-001' }) });

      expect(response.status).toBe(401);
    });

    it('should return 404 when order not found', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClientWithNoOrder() as never);

      const request = new NextRequest('http://localhost:3000/api/orders/nonexistent/status', {
        method: 'POST',
        body: JSON.stringify({ status: 'Shipped' }),
      });
      const response = await POST(request, { params: Promise.resolve({ id: 'nonexistent' }) });

      expect(response.status).toBe(404);
    });

    it('should return 400 for invalid status value', async () => {
      vi.mocked(createClient).mockResolvedValue(
        createAuthenticatedClientWithOrder('order-001') as never
      );

      const request = new NextRequest('http://localhost:3000/api/orders/order-001/status', {
        method: 'POST',
        body: JSON.stringify({ status: 'InvalidStatus' }),
      });
      const response = await POST(request, { params: Promise.resolve({ id: 'order-001' }) });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe('Validation failed');
    });

    it('should update status successfully', async () => {
      vi.mocked(createClient).mockResolvedValue(
        createAuthenticatedClientWithOrder('order-001') as never
      );
      mockUpdateStatus.mockResolvedValue({
        id: 'order-001',
        internal_status: 'Shipped',
      });

      const request = new NextRequest('http://localhost:3000/api/orders/order-001/status', {
        method: 'POST',
        body: JSON.stringify({ status: 'Shipped' }),
      });
      const response = await POST(request, { params: Promise.resolve({ id: 'order-001' }) });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(mockUpdateStatus).toHaveBeenCalledWith('order-001', 'Shipped', expect.any(Object));
    });

    it('should pass shipping info when updating to Shipped', async () => {
      vi.mocked(createClient).mockResolvedValue(
        createAuthenticatedClientWithOrder('order-001') as never
      );
      mockUpdateStatus.mockResolvedValue({ id: 'order-001', internal_status: 'Shipped' });

      const request = new NextRequest('http://localhost:3000/api/orders/order-001/status', {
        method: 'POST',
        body: JSON.stringify({
          status: 'Shipped',
          shipping: {
            carrier: 'Royal Mail',
            trackingNumber: 'RM123456789GB',
          },
        }),
      });
      await POST(request, { params: Promise.resolve({ id: 'order-001' }) });

      expect(mockUpdateStatus).toHaveBeenCalledWith(
        'order-001',
        'Shipped',
        expect.objectContaining({
          shipping: {
            carrier: 'Royal Mail',
            trackingNumber: 'RM123456789GB',
          },
        })
      );
    });

    it('should return 400 for invalid status transition', async () => {
      vi.mocked(createClient).mockResolvedValue(
        createAuthenticatedClientWithOrder('order-001') as never
      );
      mockUpdateStatus.mockRejectedValue(
        new Error('Invalid status transition from Pending to Completed')
      );

      const request = new NextRequest('http://localhost:3000/api/orders/order-001/status', {
        method: 'POST',
        body: JSON.stringify({ status: 'Completed' }),
      });
      const response = await POST(request, { params: Promise.resolve({ id: 'order-001' }) });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain('Invalid status transition');
    });
  });

  // ==========================================================================
  // POST /api/orders/bulk-status
  // ==========================================================================

  describe('POST /api/orders/bulk-status', () => {
    it('should return 401 when not authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue(createUnauthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/orders/bulk-status', {
        method: 'POST',
        body: JSON.stringify({ orderIds: [VALID_UUID_1], status: 'Shipped' }),
      });
      const response = await BulkStatus(request);

      expect(response.status).toBe(401);
    });

    it('should return 400 for invalid UUID format', async () => {
      vi.mocked(createClient).mockResolvedValue(
        createAuthenticatedClientWithOrder('order-001') as never
      );

      const request = new NextRequest('http://localhost:3000/api/orders/bulk-status', {
        method: 'POST',
        body: JSON.stringify({ orderIds: ['not-a-uuid'], status: 'Shipped' }),
      });
      const response = await BulkStatus(request);

      expect(response.status).toBe(400);
    });

    it('should return 400 for empty orderIds array', async () => {
      vi.mocked(createClient).mockResolvedValue(
        createAuthenticatedClientWithOrder('order-001') as never
      );

      const request = new NextRequest('http://localhost:3000/api/orders/bulk-status', {
        method: 'POST',
        body: JSON.stringify({ orderIds: [], status: 'Shipped' }),
      });
      const response = await BulkStatus(request);

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid status value', async () => {
      vi.mocked(createClient).mockResolvedValue(
        createAuthenticatedClientWithOrder('order-001') as never
      );

      const request = new NextRequest('http://localhost:3000/api/orders/bulk-status', {
        method: 'POST',
        body: JSON.stringify({ orderIds: [VALID_UUID_1], status: 'InvalidStatus' }),
      });
      const response = await BulkStatus(request);

      expect(response.status).toBe(400);
    });

    it('should return 403 when some orders belong to other users', async () => {
      // Create a client where the order lookup returns no matching orders for user
      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({
            data: [], // No orders found for this user
            error: null,
          }),
        }),
      });

      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'user-123' } },
            error: null,
          }),
        },
        from: mockFrom,
      } as never);

      const request = new NextRequest('http://localhost:3000/api/orders/bulk-status', {
        method: 'POST',
        body: JSON.stringify({ orderIds: [VALID_UUID_1, VALID_UUID_2], status: 'Shipped' }),
      });
      const response = await BulkStatus(request);

      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json.error).toBe('Some orders not found or unauthorized');
    });

    it('should bulk update statuses successfully', async () => {
      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({
            data: [
              { id: VALID_UUID_1, user_id: 'user-123' },
              { id: VALID_UUID_2, user_id: 'user-123' },
            ],
            error: null,
          }),
        }),
      });

      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'user-123' } },
            error: null,
          }),
        },
        from: mockFrom,
      } as never);

      mockBulkUpdateStatus.mockResolvedValue({
        success: true,
        updated: 2,
        failed: 0,
      });

      const request = new NextRequest('http://localhost:3000/api/orders/bulk-status', {
        method: 'POST',
        body: JSON.stringify({ orderIds: [VALID_UUID_1, VALID_UUID_2], status: 'Shipped' }),
      });
      const response = await BulkStatus(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
    });
  });
});
