import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the Supabase server client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

// Mock the OrderRepository
const mockOrderRepo = {
  findByUser: vi.fn(),
};

vi.mock('@/lib/repositories', () => ({
  OrderRepository: class MockOrderRepository {
    findByUser = mockOrderRepo.findByUser;
  },
}));

import { createClient } from '@/lib/supabase/server';
import { GET } from '../orders/route';
import { testBrickLinkOrders, testBrickOwlOrders } from '@/test/fixtures';

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
  });
});
