import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the Supabase server client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

// Mock the InventoryService
const mockInventoryService = {
  getById: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('@/lib/services', () => ({
  InventoryService: function MockInventoryService() {
    return mockInventoryService;
  },
}));

import { createClient } from '@/lib/supabase/server';
import { GET, PUT, DELETE } from '../inventory/[id]/route';
import { testInventoryItems } from '@/test/fixtures';

describe('Inventory Item API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createParams = (id: string) => Promise.resolve({ id });

  describe('GET /api/inventory/[id]', () => {
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

      const request = new NextRequest('http://localhost:3000/api/inventory/inv-001');
      const response = await GET(request, { params: createParams('inv-001') });

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toBe('Unauthorized');
    });

    it('should return inventory item when found', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'test-user-id' } },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const item = testInventoryItems.newMillenniumFalcon;
      mockInventoryService.getById.mockResolvedValue(item);

      const request = new NextRequest('http://localhost:3000/api/inventory/inv-001');
      const response = await GET(request, { params: createParams('inv-001') });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data).toEqual(item);
    });

    it('should return 404 when item not found', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'test-user-id' } },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      mockInventoryService.getById.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/inventory/invalid-id');
      const response = await GET(request, { params: createParams('invalid-id') });

      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json.error).toBe('Item not found');
    });
  });

  describe('PUT /api/inventory/[id]', () => {
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

      const request = new NextRequest('http://localhost:3000/api/inventory/inv-001', {
        method: 'PUT',
        body: JSON.stringify({ condition: 'Used' }),
      });
      const response = await PUT(request, { params: createParams('inv-001') });

      expect(response.status).toBe(401);
    });

    it('should update inventory item with valid data', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'test-user-id' } },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const existingItem = testInventoryItems.newMillenniumFalcon;
      const updatedItem = { ...existingItem, condition: 'Used' };

      mockInventoryService.getById.mockResolvedValue(existingItem);
      mockInventoryService.update.mockResolvedValue(updatedItem);

      const request = new NextRequest('http://localhost:3000/api/inventory/inv-001', {
        method: 'PUT',
        body: JSON.stringify({ condition: 'Used' }),
      });
      const response = await PUT(request, { params: createParams('inv-001') });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data.condition).toBe('Used');
    });

    it('should return 404 when item not found', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'test-user-id' } },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      mockInventoryService.getById.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/inventory/invalid-id', {
        method: 'PUT',
        body: JSON.stringify({ condition: 'Used' }),
      });
      const response = await PUT(request, { params: createParams('invalid-id') });

      expect(response.status).toBe(404);
      expect(mockInventoryService.update).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid condition value', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'test-user-id' } },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const request = new NextRequest('http://localhost:3000/api/inventory/inv-001', {
        method: 'PUT',
        body: JSON.stringify({ condition: 'InvalidCondition' }),
      });
      const response = await PUT(request, { params: createParams('inv-001') });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe('Validation failed');
    });

    it('should update multiple fields', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'test-user-id' } },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const existingItem = testInventoryItems.newMillenniumFalcon;
      const updateData = {
        status: 'LISTED',
        listing_value: 899.99,
        storage_location: 'Shelf A1',
      };
      const updatedItem = { ...existingItem, ...updateData };

      mockInventoryService.getById.mockResolvedValue(existingItem);
      mockInventoryService.update.mockResolvedValue(updatedItem);

      const request = new NextRequest('http://localhost:3000/api/inventory/inv-001', {
        method: 'PUT',
        body: JSON.stringify(updateData),
      });
      const response = await PUT(request, { params: createParams('inv-001') });

      expect(response.status).toBe(200);
      expect(mockInventoryService.update).toHaveBeenCalledWith('inv-001', updateData);
    });
  });

  describe('DELETE /api/inventory/[id]', () => {
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

      const request = new NextRequest('http://localhost:3000/api/inventory/inv-001', {
        method: 'DELETE',
      });
      const response = await DELETE(request, { params: createParams('inv-001') });

      expect(response.status).toBe(401);
    });

    it('should delete inventory item', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'test-user-id' } },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      mockInventoryService.getById.mockResolvedValue(testInventoryItems.newMillenniumFalcon);
      mockInventoryService.delete.mockResolvedValue(undefined);

      const request = new NextRequest('http://localhost:3000/api/inventory/inv-001', {
        method: 'DELETE',
      });
      const response = await DELETE(request, { params: createParams('inv-001') });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.message).toBe('Item deleted successfully');
      expect(mockInventoryService.delete).toHaveBeenCalledWith('inv-001');
    });

    it('should return 404 when item not found', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'test-user-id' } },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      mockInventoryService.getById.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/inventory/invalid-id', {
        method: 'DELETE',
      });
      const response = await DELETE(request, { params: createParams('invalid-id') });

      expect(response.status).toBe(404);
      expect(mockInventoryService.delete).not.toHaveBeenCalled();
    });
  });
});
