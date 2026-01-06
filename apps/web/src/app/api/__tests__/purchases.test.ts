import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the Supabase server client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

// Mock the PurchaseService
const mockPurchaseService = {
  getAll: vi.fn(),
  create: vi.fn(),
};

vi.mock('@/lib/services', () => ({
  PurchaseService: function MockPurchaseService() {
    return mockPurchaseService;
  },
}));

import { createClient } from '@/lib/supabase/server';
import { GET, POST } from '../purchases/route';
import { testPurchases } from '@/test/fixtures';

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
  });
});
