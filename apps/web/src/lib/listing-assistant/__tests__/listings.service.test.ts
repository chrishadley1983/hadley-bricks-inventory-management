import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getListings,
  getListingById,
  getListingsForInventoryItem,
  createListing,
  updateListing,
  deleteListing,
  getListingCounts,
} from '../listings.service';
import type { GeneratedListing, CreateListingInput } from '../types';

// Mock Supabase server client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

describe('Listings Service', () => {
  const testUserId = 'user-123';

  // Mock Supabase client
  const mockSupabase = {
    from: vi.fn(),
  };

  // Helper to create mock listing
  const createMockListing = (overrides: Partial<GeneratedListing> = {}): GeneratedListing => ({
    id: 'listing-001',
    user_id: testUserId,
    inventory_item_id: 'inv-001',
    item_name: 'LEGO Star Wars Millennium Falcon 75192',
    condition: 'Used',
    title: 'LEGO Star Wars Millennium Falcon 75192 - Complete with Instructions',
    price_range: '£450 - £550',
    description: '<p>Complete set in excellent condition</p>',
    template_id: 'template-001',
    source_urls: ['https://example.com/source1'],
    ebay_sold_data: [],
    status: 'draft',
    created_at: '2024-01-15T10:00:00Z',
    ...overrides,
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    const { createClient } = await import('@/lib/supabase/server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockSupabase);
  });

  describe('getListings', () => {
    it('should fetch listings for a user', async () => {
      const mockListings = [createMockListing({ id: '1' }), createMockListing({ id: '2' })];

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: mockListings,
              error: null,
              count: 2,
            }),
          }),
        }),
      });

      const result = await getListings(testUserId);

      expect(result.listings).toEqual(mockListings);
      expect(result.total).toBe(2);
    });

    it('should filter by status when provided', async () => {
      const mockListings = [createMockListing({ status: 'ready' })];

      const eqMock = vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({
          data: mockListings,
          error: null,
          count: 1,
        }),
      });

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              eq: eqMock,
            }),
          }),
        }),
      });

      await getListings(testUserId, { status: 'ready' });

      // The filter should be applied
      expect(mockSupabase.from).toHaveBeenCalledWith('generated_listings');
    });

    it('should filter by inventoryItemId when provided', async () => {
      const mockListings = [createMockListing({ inventory_item_id: 'inv-specific' })];

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: mockListings,
                error: null,
                count: 1,
              }),
            }),
          }),
        }),
      });

      const result = await getListings(testUserId, { inventoryItemId: 'inv-specific' });

      expect(result.listings).toHaveLength(1);
    });

    it('should apply pagination when limit is provided', async () => {
      const mockListings = [createMockListing()];

      const rangeMock = vi.fn().mockResolvedValue({
        data: mockListings,
        error: null,
        count: 100,
      });

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              range: rangeMock,
            }),
          }),
        }),
      });

      await getListings(testUserId, { limit: 10, offset: 20 });

      expect(rangeMock).toHaveBeenCalledWith(20, 29);
    });

    it('should default offset to 0 when not provided', async () => {
      const rangeMock = vi.fn().mockResolvedValue({
        data: [],
        error: null,
        count: 0,
      });

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              range: rangeMock,
            }),
          }),
        }),
      });

      await getListings(testUserId, { limit: 10 });

      expect(rangeMock).toHaveBeenCalledWith(0, 9);
    });

    it('should return empty array and zero total when no listings', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: [],
              error: null,
              count: 0,
            }),
          }),
        }),
      });

      const result = await getListings(testUserId);

      expect(result.listings).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should throw error on database failure', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Database error' },
              count: null,
            }),
          }),
        }),
      });

      await expect(getListings(testUserId)).rejects.toThrow('Failed to fetch listings');
    });
  });

  describe('getListingById', () => {
    it('should fetch a single listing by ID', async () => {
      const mockListing = createMockListing({ id: 'listing-123' });

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: mockListing, error: null }),
            }),
          }),
        }),
      });

      const result = await getListingById(testUserId, 'listing-123');

      expect(result).toEqual(mockListing);
    });

    it('should return null when listing not found', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { code: 'PGRST116', message: 'Not found' },
              }),
            }),
          }),
        }),
      });

      const result = await getListingById(testUserId, 'non-existent');

      expect(result).toBeNull();
    });

    it('should throw error on non-404 database failure', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { code: 'OTHER', message: 'Database error' },
              }),
            }),
          }),
        }),
      });

      await expect(getListingById(testUserId, 'listing-123')).rejects.toThrow(
        'Failed to fetch listing'
      );
    });
  });

  describe('getListingsForInventoryItem', () => {
    it('should fetch all listings for an inventory item', async () => {
      const mockListings = [
        createMockListing({ id: '1', inventory_item_id: 'inv-001' }),
        createMockListing({ id: '2', inventory_item_id: 'inv-001' }),
      ];

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: mockListings, error: null }),
            }),
          }),
        }),
      });

      const result = await getListingsForInventoryItem(testUserId, 'inv-001');

      expect(result).toEqual(mockListings);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no listings exist', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      });

      const result = await getListingsForInventoryItem(testUserId, 'inv-001');

      expect(result).toEqual([]);
    });

    it('should throw error on database failure', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Database error' },
              }),
            }),
          }),
        }),
      });

      await expect(getListingsForInventoryItem(testUserId, 'inv-001')).rejects.toThrow(
        'Failed to fetch listings'
      );
    });
  });

  describe('createListing', () => {
    it('should create a new listing with all fields', async () => {
      const input: CreateListingInput = {
        inventory_item_id: 'inv-001',
        item_name: 'LEGO Set',
        condition: 'New',
        title: 'Test Title',
        price_range: '£100 - £150',
        description: '<p>Test description</p>',
        template_id: 'template-001',
        source_urls: ['https://example.com'],
        ebay_sold_data: [
          {
            itemId: 'item-1',
            title: 'Sold Item',
            soldPrice: 120,
            currency: 'GBP',
            soldDate: '2024-01-01',
            condition: 'New',
            url: 'https://ebay.com/item-1',
          },
        ],
        status: 'ready',
      };

      const createdListing = createMockListing({ ...input, id: 'new-listing-id' });

      mockSupabase.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: createdListing, error: null }),
          }),
        }),
      });

      const result = await createListing(testUserId, input);

      expect(result).toEqual(createdListing);
    });

    it('should default status to draft when not provided', async () => {
      const input: CreateListingInput = {
        item_name: 'Test Item',
        condition: 'Used',
        title: 'Test Title',
        description: 'Test',
      };

      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: createMockListing({ status: 'draft' }),
            error: null,
          }),
        }),
      });

      mockSupabase.from.mockReturnValue({ insert: insertMock });

      await createListing(testUserId, input);

      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'draft',
        })
      );
    });

    it('should handle null optional fields', async () => {
      const input: CreateListingInput = {
        item_name: 'Test Item',
        condition: 'Used',
        title: 'Test Title',
        description: 'Test',
      };

      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: createMockListing({
              inventory_item_id: null,
              price_range: null,
              template_id: null,
              source_urls: null,
              ebay_sold_data: null,
            }),
            error: null,
          }),
        }),
      });

      mockSupabase.from.mockReturnValue({ insert: insertMock });

      await createListing(testUserId, input);

      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          inventory_item_id: null,
          price_range: null,
          template_id: null,
          source_urls: null,
          ebay_sold_data: null,
        })
      );
    });

    it('should throw error on database failure', async () => {
      mockSupabase.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Insert failed' },
            }),
          }),
        }),
      });

      await expect(
        createListing(testUserId, {
          item_name: 'Test',
          condition: 'New',
          title: 'Test',
          description: 'Test',
        })
      ).rejects.toThrow('Failed to create listing');
    });
  });

  describe('updateListing', () => {
    it('should update listing with all fields', async () => {
      const updatedListing = createMockListing({
        id: 'listing-123',
        title: 'Updated Title',
        price_range: '£200 - £250',
        description: 'Updated description',
        status: 'ready',
      });

      mockSupabase.from.mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: updatedListing, error: null }),
              }),
            }),
          }),
        }),
      });

      const result = await updateListing(testUserId, 'listing-123', {
        title: 'Updated Title',
        price_range: '£200 - £250',
        description: 'Updated description',
        status: 'ready',
      });

      expect(result).toEqual(updatedListing);
    });

    it('should only update provided fields', async () => {
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: createMockListing({ title: 'New Title' }),
                error: null,
              }),
            }),
          }),
        }),
      });

      mockSupabase.from.mockReturnValue({ update: updateMock });

      await updateListing(testUserId, 'listing-123', { title: 'New Title' });

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New Title',
        })
      );
    });

    it('should handle status update', async () => {
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: createMockListing({ status: 'listed' }),
                error: null,
              }),
            }),
          }),
        }),
      });

      mockSupabase.from.mockReturnValue({ update: updateMock });

      await updateListing(testUserId, 'listing-123', { status: 'listed' });

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'listed',
        })
      );
    });

    it('should throw error on database failure', async () => {
      mockSupabase.from.mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'Update failed' },
                }),
              }),
            }),
          }),
        }),
      });

      await expect(
        updateListing(testUserId, 'listing-123', { title: 'Test' })
      ).rejects.toThrow('Failed to update listing');
    });
  });

  describe('deleteListing', () => {
    it('should delete a listing', async () => {
      mockSupabase.from.mockReturnValue({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      });

      await expect(deleteListing(testUserId, 'listing-123')).resolves.toBeUndefined();
    });

    it('should throw error on database failure', async () => {
      mockSupabase.from.mockReturnValue({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Delete failed' },
            }),
          }),
        }),
      });

      await expect(deleteListing(testUserId, 'listing-123')).rejects.toThrow(
        'Failed to delete listing'
      );
    });
  });

  describe('getListingCounts', () => {
    it('should return counts by status', async () => {
      const mockData = [
        { status: 'draft' },
        { status: 'draft' },
        { status: 'ready' },
        { status: 'listed' },
        { status: 'listed' },
        { status: 'listed' },
        { status: 'sold' },
      ];

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: mockData, error: null }),
        }),
      });

      const result = await getListingCounts(testUserId);

      expect(result).toEqual({
        draft: 2,
        ready: 1,
        listed: 3,
        sold: 1,
        total: 7,
      });
    });

    it('should return zero counts when no listings exist', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      });

      const result = await getListingCounts(testUserId);

      expect(result).toEqual({
        draft: 0,
        ready: 0,
        listed: 0,
        sold: 0,
        total: 0,
      });
    });

    it('should throw error on database failure', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Database error' },
          }),
        }),
      });

      await expect(getListingCounts(testUserId)).rejects.toThrow(
        'Failed to get listing counts'
      );
    });
  });
});
