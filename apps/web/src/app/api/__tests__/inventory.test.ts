import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the Supabase server client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

// Mock the InventoryService as a class
vi.mock('@/lib/services', () => ({
  InventoryService: class MockInventoryService {
    getAll = vi.fn().mockResolvedValue({
      data: [{ id: '1', set_number: '75192' }],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    });
    getById = vi.fn().mockResolvedValue({ id: '1', set_number: '75192' });
    create = vi.fn().mockResolvedValue({ id: '1', set_number: '75192' });
    createMany = vi.fn().mockResolvedValue([{ id: '1', set_number: '75192' }]);
    update = vi.fn().mockResolvedValue({ id: '1', set_number: '75192' });
    delete = vi.fn().mockResolvedValue(undefined);
  },
}));

import { createClient } from '@/lib/supabase/server';
import { GET, POST } from '../inventory/route';

describe('Inventory API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/inventory', () => {
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

      const request = new NextRequest('http://localhost:3000/api/inventory');
      const response = await GET(request);

      expect(response.status).toBe(401);
    });

    it('should return inventory items when authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'user-123' } },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const request = new NextRequest('http://localhost:3000/api/inventory');
      const response = await GET(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data).toBeDefined();
    });

    it('should handle query parameters', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'user-123' } },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const request = new NextRequest(
        'http://localhost:3000/api/inventory?status=IN%20STOCK&page=1&pageSize=20'
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
    });
  });

  describe('POST /api/inventory', () => {
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

      const request = new NextRequest('http://localhost:3000/api/inventory', {
        method: 'POST',
        body: JSON.stringify({ set_number: '75192' }),
      });
      const response = await POST(request);

      expect(response.status).toBe(401);
    });

    it('should return 400 for invalid input', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'user-123' } },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const request = new NextRequest('http://localhost:3000/api/inventory', {
        method: 'POST',
        body: JSON.stringify({ set_number: '' }), // Invalid - empty string
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    it('should create inventory item with valid input', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'user-123' } },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const request = new NextRequest('http://localhost:3000/api/inventory', {
        method: 'POST',
        body: JSON.stringify({
          set_number: '75192',
          item_name: 'Millennium Falcon',
          condition: 'New',
        }),
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
    });
  });
});
