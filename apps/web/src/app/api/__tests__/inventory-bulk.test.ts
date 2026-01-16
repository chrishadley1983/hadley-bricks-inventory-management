/**
 * Tests for /api/inventory/bulk API Routes
 *
 * Tests bulk inventory operations:
 * - PATCH /api/inventory/bulk - Bulk update items
 * - DELETE /api/inventory/bulk - Bulk delete items
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the Supabase server client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

// Mock functions for InventoryService
const mockUpdateBulk = vi.fn();
const mockDeleteBulk = vi.fn();

// Mock the InventoryService as a class
vi.mock('@/lib/services', () => ({
  InventoryService: class MockInventoryService {
    updateBulk = mockUpdateBulk;
    deleteBulk = mockDeleteBulk;
  },
}));

// Suppress console logs during tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

import { createClient } from '@/lib/supabase/server';
import { PATCH, DELETE } from '../inventory/bulk/route';

// ============================================================================
// TEST HELPERS
// ============================================================================

function createMockInventoryItem(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    user_id: 'user-123',
    set_number: '75192',
    item_name: 'Millennium Falcon',
    condition: 'New',
    status: 'LISTED',
    cost: 599.99,
    listing_value: 799.99,
    storage_location: 'Shelf A1',
    ...overrides,
  };
}

function createAuthenticatedClient() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-123' } },
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

// Valid UUIDs for testing
const VALID_UUID_1 = '550e8400-e29b-41d4-a716-446655440001';
const VALID_UUID_2 = '550e8400-e29b-41d4-a716-446655440002';
const VALID_UUID_3 = '550e8400-e29b-41d4-a716-446655440003';

// ============================================================================
// TESTS
// ============================================================================

describe('/api/inventory/bulk API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // PATCH /api/inventory/bulk
  // ==========================================================================

  describe('PATCH /api/inventory/bulk', () => {
    it('should return 401 when not authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue(createUnauthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/inventory/bulk', {
        method: 'PATCH',
        body: JSON.stringify({
          ids: [VALID_UUID_1],
          updates: { storage_location: 'Shelf B1' },
        }),
      });
      const response = await PATCH(request);

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toBe('Unauthorized');
    });

    it('should return 400 for invalid UUID format', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/inventory/bulk', {
        method: 'PATCH',
        body: JSON.stringify({
          ids: ['not-a-uuid'],
          updates: { storage_location: 'Shelf B1' },
        }),
      });
      const response = await PATCH(request);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe('Validation failed');
    });

    it('should return 400 for empty ids array', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/inventory/bulk', {
        method: 'PATCH',
        body: JSON.stringify({
          ids: [],
          updates: { storage_location: 'Shelf B1' },
        }),
      });
      const response = await PATCH(request);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe('Validation failed');
    });

    it('should return 400 when no updates provided', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/inventory/bulk', {
        method: 'PATCH',
        body: JSON.stringify({
          ids: [VALID_UUID_1],
          updates: {},
        }),
      });
      const response = await PATCH(request);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe('No updates provided');
    });

    it('should return 400 for invalid condition value', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/inventory/bulk', {
        method: 'PATCH',
        body: JSON.stringify({
          ids: [VALID_UUID_1],
          updates: { condition: 'InvalidCondition' },
        }),
      });
      const response = await PATCH(request);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe('Validation failed');
    });

    it('should bulk update items successfully', async () => {
      const updatedItems = [
        createMockInventoryItem(VALID_UUID_1, { storage_location: 'Shelf B1' }),
        createMockInventoryItem(VALID_UUID_2, { storage_location: 'Shelf B1' }),
      ];

      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockUpdateBulk.mockResolvedValue(updatedItems);

      const request = new NextRequest('http://localhost:3000/api/inventory/bulk', {
        method: 'PATCH',
        body: JSON.stringify({
          ids: [VALID_UUID_1, VALID_UUID_2],
          updates: { storage_location: 'Shelf B1' },
        }),
      });
      const response = await PATCH(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data).toHaveLength(2);
      expect(json.updated).toBe(2);
    });

    it('should call service with cleaned updates (no undefined values)', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockUpdateBulk.mockResolvedValue([createMockInventoryItem(VALID_UUID_1)]);

      const request = new NextRequest('http://localhost:3000/api/inventory/bulk', {
        method: 'PATCH',
        body: JSON.stringify({
          ids: [VALID_UUID_1],
          updates: {
            storage_location: 'Shelf B1',
            condition: 'Used',
          },
        }),
      });
      await PATCH(request);

      expect(mockUpdateBulk).toHaveBeenCalledWith(
        [VALID_UUID_1],
        expect.objectContaining({
          storage_location: 'Shelf B1',
          condition: 'Used',
        })
      );
    });

    it('should handle null values for clearing fields', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockUpdateBulk.mockResolvedValue([createMockInventoryItem(VALID_UUID_1, { notes: null })]);

      const request = new NextRequest('http://localhost:3000/api/inventory/bulk', {
        method: 'PATCH',
        body: JSON.stringify({
          ids: [VALID_UUID_1],
          updates: { notes: null },
        }),
      });
      const response = await PATCH(request);

      expect(response.status).toBe(200);
      expect(mockUpdateBulk).toHaveBeenCalledWith([VALID_UUID_1], { notes: null });
    });

    it('should return 500 on service error', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockUpdateBulk.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest('http://localhost:3000/api/inventory/bulk', {
        method: 'PATCH',
        body: JSON.stringify({
          ids: [VALID_UUID_1],
          updates: { storage_location: 'Shelf B1' },
        }),
      });
      const response = await PATCH(request);

      expect(response.status).toBe(500);
      const json = await response.json();
      expect(json.error).toBe('Internal server error');
    });
  });

  // ==========================================================================
  // DELETE /api/inventory/bulk
  // ==========================================================================

  describe('DELETE /api/inventory/bulk', () => {
    it('should return 401 when not authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue(createUnauthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/inventory/bulk', {
        method: 'DELETE',
        body: JSON.stringify({ ids: [VALID_UUID_1] }),
      });
      const response = await DELETE(request);

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toBe('Unauthorized');
    });

    it('should return 400 for invalid UUID format', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/inventory/bulk', {
        method: 'DELETE',
        body: JSON.stringify({ ids: ['not-a-uuid', 'also-not-uuid'] }),
      });
      const response = await DELETE(request);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe('Validation failed');
    });

    it('should return 400 for empty ids array', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/inventory/bulk', {
        method: 'DELETE',
        body: JSON.stringify({ ids: [] }),
      });
      const response = await DELETE(request);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe('Validation failed');
    });

    it('should bulk delete items successfully', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockDeleteBulk.mockResolvedValue({ count: 3 });

      const request = new NextRequest('http://localhost:3000/api/inventory/bulk', {
        method: 'DELETE',
        body: JSON.stringify({ ids: [VALID_UUID_1, VALID_UUID_2, VALID_UUID_3] }),
      });
      const response = await DELETE(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.deleted).toBe(3);
    });

    it('should call service with correct IDs', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockDeleteBulk.mockResolvedValue({ count: 2 });

      const request = new NextRequest('http://localhost:3000/api/inventory/bulk', {
        method: 'DELETE',
        body: JSON.stringify({ ids: [VALID_UUID_1, VALID_UUID_2] }),
      });
      await DELETE(request);

      expect(mockDeleteBulk).toHaveBeenCalledWith([VALID_UUID_1, VALID_UUID_2]);
    });

    it('should return 500 on service error', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockDeleteBulk.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest('http://localhost:3000/api/inventory/bulk', {
        method: 'DELETE',
        body: JSON.stringify({ ids: [VALID_UUID_1] }),
      });
      const response = await DELETE(request);

      expect(response.status).toBe(500);
      const json = await response.json();
      expect(json.error).toBe('Internal server error');
    });
  });
});
