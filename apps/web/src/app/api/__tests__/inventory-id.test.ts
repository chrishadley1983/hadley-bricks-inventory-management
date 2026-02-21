/**
 * Tests for /api/inventory/[id] API Routes
 *
 * Tests the individual inventory item operations:
 * - GET /api/inventory/[id] - Get single item
 * - PUT /api/inventory/[id] - Update item
 * - DELETE /api/inventory/[id] - Delete item
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the Supabase server client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

// Mock functions for InventoryService
const mockGetById = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

// Mock the InventoryService as a class
vi.mock('@/lib/services', () => ({
  InventoryService: class MockInventoryService {
    getById = mockGetById;
    update = mockUpdate;
    delete = mockDelete;
  },
}));

// Suppress console logs during tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

import { createClient } from '@/lib/supabase/server';
import { GET, PUT, DELETE } from '../inventory/[id]/route';

// ============================================================================
// TEST HELPERS
// ============================================================================

function createMockInventoryItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-001',
    user_id: 'user-123',
    set_number: '75192',
    item_name: 'Millennium Falcon',
    condition: 'New',
    status: 'LISTED',
    cost: 599.99,
    listing_value: 799.99,
    storage_location: 'Shelf A1',
    sku: 'MF-75192-001',
    amazon_asin: 'B075192MF1',
    notes: 'Test item',
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:00:00Z',
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

// ============================================================================
// TESTS
// ============================================================================

describe('/api/inventory/[id] API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // GET /api/inventory/[id]
  // ==========================================================================

  describe('GET /api/inventory/[id]', () => {
    it('should return 401 when not authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue(createUnauthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/inventory/item-001');
      const response = await GET(request, { params: Promise.resolve({ id: 'item-001' }) });

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toBe('Unauthorized');
    });

    it('should return 404 when item not found', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetById.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/inventory/nonexistent');
      const response = await GET(request, { params: Promise.resolve({ id: 'nonexistent' }) });

      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json.error).toBe('Item not found');
    });

    it('should return inventory item when found', async () => {
      const mockItem = createMockInventoryItem();
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetById.mockResolvedValue(mockItem);

      const request = new NextRequest('http://localhost:3000/api/inventory/item-001');
      const response = await GET(request, { params: Promise.resolve({ id: 'item-001' }) });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data).toEqual(mockItem);
      expect(json.data.set_number).toBe('75192');
    });

    it('should call service with correct item ID', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetById.mockResolvedValue(createMockInventoryItem());

      const request = new NextRequest('http://localhost:3000/api/inventory/specific-id');
      await GET(request, { params: Promise.resolve({ id: 'specific-id' }) });

      expect(mockGetById).toHaveBeenCalledWith('specific-id');
    });

    it('should return 500 on service error', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetById.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest('http://localhost:3000/api/inventory/item-001');
      const response = await GET(request, { params: Promise.resolve({ id: 'item-001' }) });

      expect(response.status).toBe(500);
      const json = await response.json();
      expect(json.error).toBe('Internal server error');
    });
  });

  // ==========================================================================
  // PUT /api/inventory/[id]
  // ==========================================================================

  describe('PUT /api/inventory/[id]', () => {
    it('should return 401 when not authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue(createUnauthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/inventory/item-001', {
        method: 'PUT',
        body: JSON.stringify({ item_name: 'Updated Name' }),
      });
      const response = await PUT(request, { params: Promise.resolve({ id: 'item-001' }) });

      expect(response.status).toBe(401);
    });

    it('should return 404 when item not found', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetById.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/inventory/nonexistent', {
        method: 'PUT',
        body: JSON.stringify({ item_name: 'Updated Name' }),
      });
      const response = await PUT(request, { params: Promise.resolve({ id: 'nonexistent' }) });

      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json.error).toBe('Item not found');
    });

    it('should return 400 for invalid input', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetById.mockResolvedValue(createMockInventoryItem());

      const request = new NextRequest('http://localhost:3000/api/inventory/item-001', {
        method: 'PUT',
        body: JSON.stringify({ condition: 'InvalidCondition' }), // Must be 'New' or 'Used'
      });
      const response = await PUT(request, { params: Promise.resolve({ id: 'item-001' }) });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe('Validation failed');
    });

    it('should update inventory item with valid input', async () => {
      const existingItem = createMockInventoryItem();
      const updatedItem = { ...existingItem, item_name: 'Updated Millennium Falcon' };

      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetById.mockResolvedValue(existingItem);
      mockUpdate.mockResolvedValue(updatedItem);

      const request = new NextRequest('http://localhost:3000/api/inventory/item-001', {
        method: 'PUT',
        body: JSON.stringify({ item_name: 'Updated Millennium Falcon' }),
      });
      const response = await PUT(request, { params: Promise.resolve({ id: 'item-001' }) });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data.item_name).toBe('Updated Millennium Falcon');
    });

    it('should update multiple fields at once', async () => {
      const existingItem = createMockInventoryItem();
      const updatedItem = {
        ...existingItem,
        item_name: 'Updated Name',
        condition: 'Used',
        storage_location: 'Shelf B2',
        listing_value: 749.99,
      };

      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetById.mockResolvedValue(existingItem);
      mockUpdate.mockResolvedValue(updatedItem);

      const request = new NextRequest('http://localhost:3000/api/inventory/item-001', {
        method: 'PUT',
        body: JSON.stringify({
          item_name: 'Updated Name',
          condition: 'Used',
          storage_location: 'Shelf B2',
          listing_value: 749.99,
        }),
      });
      const response = await PUT(request, { params: Promise.resolve({ id: 'item-001' }) });

      expect(response.status).toBe(200);
      expect(mockUpdate).toHaveBeenCalledWith(
        'item-001',
        expect.objectContaining({
          item_name: 'Updated Name',
          condition: 'Used',
          storage_location: 'Shelf B2',
          listing_value: 749.99,
        })
      );
    });

    it('should handle empty strings as null for optional fields', async () => {
      const existingItem = createMockInventoryItem();
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetById.mockResolvedValue(existingItem);
      mockUpdate.mockResolvedValue({ ...existingItem, notes: null });

      const request = new NextRequest('http://localhost:3000/api/inventory/item-001', {
        method: 'PUT',
        body: JSON.stringify({ notes: '' }), // Empty string should become null
      });
      const response = await PUT(request, { params: Promise.resolve({ id: 'item-001' }) });

      expect(response.status).toBe(200);
      expect(mockUpdate).toHaveBeenCalledWith('item-001', expect.objectContaining({ notes: null }));
    });

    it('should return 500 on service error', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetById.mockResolvedValue(createMockInventoryItem());
      mockUpdate.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest('http://localhost:3000/api/inventory/item-001', {
        method: 'PUT',
        body: JSON.stringify({ item_name: 'Updated Name' }),
      });
      const response = await PUT(request, { params: Promise.resolve({ id: 'item-001' }) });

      expect(response.status).toBe(500);
    });
  });

  // ==========================================================================
  // DELETE /api/inventory/[id]
  // ==========================================================================

  describe('DELETE /api/inventory/[id]', () => {
    it('should return 401 when not authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue(createUnauthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/inventory/item-001', {
        method: 'DELETE',
      });
      const response = await DELETE(request, { params: Promise.resolve({ id: 'item-001' }) });

      expect(response.status).toBe(401);
    });

    it('should return 404 when item not found', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetById.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/inventory/nonexistent', {
        method: 'DELETE',
      });
      const response = await DELETE(request, { params: Promise.resolve({ id: 'nonexistent' }) });

      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json.error).toBe('Item not found');
    });

    it('should delete inventory item successfully', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetById.mockResolvedValue(createMockInventoryItem());
      mockDelete.mockResolvedValue(undefined);

      const request = new NextRequest('http://localhost:3000/api/inventory/item-001', {
        method: 'DELETE',
      });
      const response = await DELETE(request, { params: Promise.resolve({ id: 'item-001' }) });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.message).toBe('Item deleted successfully');
    });

    it('should call service delete with correct ID', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetById.mockResolvedValue(createMockInventoryItem());
      mockDelete.mockResolvedValue(undefined);

      const request = new NextRequest('http://localhost:3000/api/inventory/specific-id', {
        method: 'DELETE',
      });
      await DELETE(request, { params: Promise.resolve({ id: 'specific-id' }) });

      expect(mockDelete).toHaveBeenCalledWith('specific-id');
    });

    it('should return 500 on service error', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetById.mockResolvedValue(createMockInventoryItem());
      mockDelete.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest('http://localhost:3000/api/inventory/item-001', {
        method: 'DELETE',
      });
      const response = await DELETE(request, { params: Promise.resolve({ id: 'item-001' }) });

      expect(response.status).toBe(500);
    });
  });
});
