import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BrickLinkUploadService } from '../bricklink-upload.service';

describe('BrickLinkUploadService', () => {
  let service: BrickLinkUploadService;
  const userId = 'test-user-id';

  // Mock Supabase client
  const mockSupabase = {
    from: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new BrickLinkUploadService(mockSupabase as any, userId);
  });

  describe('getById', () => {
    it('should return upload by ID', async () => {
      const mockUpload = {
        id: 'upload-1',
        user_id: userId,
        upload_date: '2025-01-15',
        total_quantity: 100,
        selling_price: 500,
      };

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockUpload, error: null }),
      });

      const result = await service.getById('upload-1');

      expect(result).toEqual(mockUpload);
      expect(mockSupabase.from).toHaveBeenCalledWith('bricklink_uploads');
    });

    it('should return null when not found', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
      });

      const result = await service.getById('non-existent');

      expect(result).toBeNull();
    });

    it('should throw on other errors', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
      });

      await expect(service.getById('upload-1')).rejects.toThrow();
    });
  });

  describe('getAll', () => {
    it('should return paginated uploads', async () => {
      const mockUploads = [
        { id: 'upload-1', upload_date: '2025-01-15', total_quantity: 100 },
        { id: 'upload-2', upload_date: '2025-01-16', total_quantity: 50 },
      ];

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockUploads, count: 2, error: null })),
      });

      const result = await service.getAll();

      expect(result.data).toHaveLength(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(25);
      expect(result.total).toBe(2);
    });

    it('should apply date filters', async () => {
      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: [], count: 0, error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      await service.getAll({
        dateFrom: '2025-01-01',
        dateTo: '2025-01-31',
      });

      expect(mockBuilder.gte).toHaveBeenCalledWith('upload_date', '2025-01-01');
      expect(mockBuilder.lte).toHaveBeenCalledWith('upload_date', '2025-01-31');
    });

    it('should apply source filter', async () => {
      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: [], count: 0, error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      await service.getAll({ source: 'Bricqer' });

      expect(mockBuilder.eq).toHaveBeenCalledWith('source', 'Bricqer');
    });

    it('should apply syncedFromBricqer filter', async () => {
      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: [], count: 0, error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      await service.getAll({ syncedFromBricqer: true });

      expect(mockBuilder.eq).toHaveBeenCalledWith('synced_from_bricqer', true);
    });

    it('should apply search filter', async () => {
      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: [], count: 0, error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      await service.getAll({ searchTerm: 'test' });

      expect(mockBuilder.or).toHaveBeenCalledWith(
        'source.ilike.%test%,notes.ilike.%test%,reference.ilike.%test%'
      );
    });

    it('should apply pagination', async () => {
      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: [], count: 100, error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.getAll(undefined, { page: 3, pageSize: 10 });

      expect(mockBuilder.range).toHaveBeenCalledWith(20, 29); // (3-1)*10 to (3-1)*10+10-1
      expect(result.page).toBe(3);
      expect(result.pageSize).toBe(10);
    });
  });

  describe('create', () => {
    it('should create a new upload', async () => {
      const input = {
        upload_date: '2025-01-15',
        total_quantity: 100,
        selling_price: 500,
        cost: 300,
        source: 'Manual',
      };

      const mockCreated = {
        id: 'upload-new',
        user_id: userId,
        ...input,
        synced_from_bricqer: false,
      };

      mockSupabase.from.mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockCreated, error: null }),
      });

      const result = await service.create(input);

      expect(result.id).toBe('upload-new');
      expect(result.synced_from_bricqer).toBe(false);
    });

    it('should handle optional fields', async () => {
      const input = {
        upload_date: '2025-01-15',
        total_quantity: 50,
        selling_price: 250,
      };

      const mockBuilder = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'upload-1', ...input }, error: null }),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      await service.create(input);

      expect(mockBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: userId,
          upload_date: '2025-01-15',
          total_quantity: 50,
          selling_price: 250,
          cost: null,
          source: null,
          notes: null,
        })
      );
    });

    it('should throw on error', async () => {
      mockSupabase.from.mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Insert failed' } }),
      });

      await expect(
        service.create({
          upload_date: '2025-01-15',
          total_quantity: 100,
          selling_price: 500,
        })
      ).rejects.toThrow();
    });
  });

  describe('update', () => {
    it('should update an upload', async () => {
      const mockUpdated = {
        id: 'upload-1',
        user_id: userId,
        upload_date: '2025-01-20',
        total_quantity: 150,
        selling_price: 750,
      };

      mockSupabase.from.mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockUpdated, error: null }),
      });

      const result = await service.update('upload-1', {
        total_quantity: 150,
        selling_price: 750,
      });

      expect(result.total_quantity).toBe(150);
      expect(result.selling_price).toBe(750);
    });

    it('should only update user-owned uploads', async () => {
      const mockBuilder = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'upload-1' }, error: null }),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      await service.update('upload-1', { total_quantity: 100 });

      expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'upload-1');
      expect(mockBuilder.eq).toHaveBeenCalledWith('user_id', userId);
    });
  });

  describe('delete', () => {
    it('should delete an upload', async () => {
      const mockBuilder = {
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };
      // Make the chain return a promise on the last call
      mockBuilder.eq.mockReturnValueOnce(mockBuilder).mockResolvedValueOnce({ error: null });
      mockSupabase.from.mockReturnValue(mockBuilder);

      await expect(service.delete('upload-1')).resolves.not.toThrow();
    });

    it('should only delete user-owned uploads', async () => {
      const mockBuilder = {
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };
      mockBuilder.eq.mockReturnValueOnce(mockBuilder).mockResolvedValueOnce({ error: null });
      mockSupabase.from.mockReturnValue(mockBuilder);

      await service.delete('upload-1');

      expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'upload-1');
      expect(mockBuilder.eq).toHaveBeenCalledWith('user_id', userId);
    });

    it('should throw on error', async () => {
      const mockBuilder = {
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };
      mockBuilder.eq.mockReturnValueOnce(mockBuilder).mockResolvedValueOnce({ error: { message: 'Delete failed' } });
      mockSupabase.from.mockReturnValue(mockBuilder);

      await expect(service.delete('upload-1')).rejects.toThrow();
    });
  });

  describe('getRecent', () => {
    it('should return recent uploads', async () => {
      const mockUploads = [
        { id: 'upload-2', upload_date: '2025-01-16' },
        { id: 'upload-1', upload_date: '2025-01-15' },
      ];

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockUploads, error: null })),
      });

      const result = await service.getRecent(10);

      expect(result).toHaveLength(2);
    });

    it('should use default limit of 10', async () => {
      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: [], error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      await service.getRecent();

      expect(mockBuilder.limit).toHaveBeenCalledWith(10);
    });
  });

  describe('getSummary', () => {
    it('should calculate summary statistics', async () => {
      const mockUploads = [
        { id: 'upload-1', upload_date: '2025-01-15', total_quantity: 100, selling_price: 500, cost: 300 },
        { id: 'upload-2', upload_date: '2025-01-16', total_quantity: 50, selling_price: 250, cost: 150 },
        { id: 'upload-3', upload_date: '2025-01-14', total_quantity: 75, selling_price: 375, cost: 225 },
      ];

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockUploads, error: null })),
      });

      const result = await service.getSummary();

      expect(result.totalUploads).toBe(3);
      expect(result.totalQuantity).toBe(225); // 100 + 50 + 75
      expect(result.totalSellingPrice).toBe(1125); // 500 + 250 + 375
      expect(result.totalCost).toBe(675); // 300 + 150 + 225
      expect(result.totalMargin).toBe(450); // 1125 - 675
      expect(result.recentUploads).toHaveLength(3);
    });

    it('should return recent uploads sorted by date descending', async () => {
      const mockUploads = [
        { id: 'upload-1', upload_date: '2025-01-14', total_quantity: 100, selling_price: 500, cost: 300 },
        { id: 'upload-2', upload_date: '2025-01-16', total_quantity: 50, selling_price: 250, cost: 150 },
        { id: 'upload-3', upload_date: '2025-01-15', total_quantity: 75, selling_price: 375, cost: 225 },
      ];

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockUploads, error: null })),
      });

      const result = await service.getSummary();

      // Should be sorted by date descending
      expect(result.recentUploads[0].upload_date).toBe('2025-01-16');
      expect(result.recentUploads[1].upload_date).toBe('2025-01-15');
      expect(result.recentUploads[2].upload_date).toBe('2025-01-14');
    });

    it('should limit recent uploads to 5', async () => {
      const mockUploads = Array.from({ length: 10 }, (_, i) => ({
        id: `upload-${i}`,
        upload_date: `2025-01-${15 + i}`,
        total_quantity: 100,
        selling_price: 500,
        cost: 300,
      }));

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockUploads, error: null })),
      });

      const result = await service.getSummary();

      expect(result.recentUploads).toHaveLength(5);
    });

    it('should handle null cost values', async () => {
      const mockUploads = [
        { id: 'upload-1', upload_date: '2025-01-15', total_quantity: 100, selling_price: 500, cost: null },
      ];

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockUploads, error: null })),
      });

      const result = await service.getSummary();

      expect(result.totalCost).toBe(0);
      expect(result.totalMargin).toBe(500);
    });
  });

  describe('getDistinctSources', () => {
    it('should return unique source values', async () => {
      const mockSources = [
        { source: 'Bricqer' },
        { source: 'Manual' },
        { source: 'Bricqer' },
        { source: 'eBay' },
      ];

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockSources, error: null })),
      });

      const result = await service.getDistinctSources();

      expect(result).toHaveLength(3);
      expect(result).toContain('Bricqer');
      expect(result).toContain('Manual');
      expect(result).toContain('eBay');
    });

    it('should exclude null sources', async () => {
      const mockSources = [
        { source: 'Bricqer' },
        { source: null },
        { source: 'Manual' },
      ];

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockSources, error: null })),
      });

      const result = await service.getDistinctSources();

      expect(result).toHaveLength(2);
      expect(result).not.toContain(null);
    });

    it('should throw on error', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: null, error: { message: 'Query failed' } })),
      });

      await expect(service.getDistinctSources()).rejects.toThrow();
    });
  });
});
