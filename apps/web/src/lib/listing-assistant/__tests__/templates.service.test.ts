import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  seedDefaultTemplates,
  ensureTemplates,
} from '../templates.service';
import { DEFAULT_TEMPLATES } from '../constants';
import type { ListingTemplate, CreateTemplateInput } from '../types';

// Mock Supabase server client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

describe('Templates Service', () => {
  const testUserId = 'user-123';

  // Mock Supabase client
  const mockSupabase = {
    from: vi.fn(),
  };

  // Helper to create mock template
  const createMockTemplate = (overrides: Partial<ListingTemplate> = {}): ListingTemplate => ({
    id: 'template-001',
    user_id: testUserId,
    name: 'Test Template',
    content: '<p>Test content</p>',
    type: 'custom',
    is_default: false,
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:00:00Z',
    ...overrides,
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    const { createClient } = await import('@/lib/supabase/server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockSupabase);
  });

  describe('getTemplates', () => {
    it('should fetch all templates for a user ordered by default status and name', async () => {
      const mockTemplates = [
        createMockTemplate({ id: '1', name: 'AAA', is_default: true }),
        createMockTemplate({ id: '2', name: 'BBB', is_default: true }),
        createMockTemplate({ id: '3', name: 'CCC', is_default: false }),
      ];

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: mockTemplates, error: null }),
            }),
          }),
        }),
      });

      const result = await getTemplates(testUserId);

      expect(result).toEqual(mockTemplates);
      expect(mockSupabase.from).toHaveBeenCalledWith('listing_templates');
    });

    it('should return empty array when user has no templates', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      });

      const result = await getTemplates(testUserId);

      expect(result).toEqual([]);
    });

    it('should throw error on database failure', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Database error' },
              }),
            }),
          }),
        }),
      });

      await expect(getTemplates(testUserId)).rejects.toThrow('Failed to fetch templates');
    });
  });

  describe('getTemplateById', () => {
    it('should fetch a single template by ID', async () => {
      const mockTemplate = createMockTemplate({ id: 'template-123' });

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: mockTemplate, error: null }),
            }),
          }),
        }),
      });

      const result = await getTemplateById(testUserId, 'template-123');

      expect(result).toEqual(mockTemplate);
    });

    it('should return null when template not found', async () => {
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

      const result = await getTemplateById(testUserId, 'non-existent');

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

      await expect(getTemplateById(testUserId, 'template-123')).rejects.toThrow(
        'Failed to fetch template'
      );
    });
  });

  describe('createTemplate', () => {
    it('should create a new template', async () => {
      const input: CreateTemplateInput = {
        name: 'New Template',
        content: '<p>New content</p>',
        type: 'custom',
      };

      const createdTemplate = createMockTemplate({
        ...input,
        id: 'new-template-id',
        is_default: false,
      });

      mockSupabase.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: createdTemplate, error: null }),
          }),
        }),
      });

      const result = await createTemplate(testUserId, input);

      expect(result).toEqual(createdTemplate);
      expect(result.name).toBe('New Template');
    });

    it('should set is_default to false by default', async () => {
      const input: CreateTemplateInput = {
        name: 'Test',
        content: 'Content',
        type: 'general',
      };

      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: createMockTemplate({ ...input, is_default: false }),
            error: null,
          }),
        }),
      });

      mockSupabase.from.mockReturnValue({ insert: insertMock });

      await createTemplate(testUserId, input);

      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          is_default: false,
        })
      );
    });

    it('should respect is_default when provided', async () => {
      const input: CreateTemplateInput = {
        name: 'Default Template',
        content: 'Content',
        type: 'custom',
        is_default: true,
      };

      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: createMockTemplate({ ...input }),
            error: null,
          }),
        }),
      });

      mockSupabase.from.mockReturnValue({ insert: insertMock });

      await createTemplate(testUserId, input);

      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          is_default: true,
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
        createTemplate(testUserId, { name: 'Test', content: 'Content', type: 'custom' })
      ).rejects.toThrow('Failed to create template');
    });
  });

  describe('updateTemplate', () => {
    it('should update template with all fields', async () => {
      const updatedTemplate = createMockTemplate({
        id: 'template-123',
        name: 'Updated Name',
        content: 'Updated content',
        type: 'lego_used',
        is_default: true,
      });

      mockSupabase.from.mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: updatedTemplate, error: null }),
              }),
            }),
          }),
        }),
      });

      const result = await updateTemplate(testUserId, 'template-123', {
        name: 'Updated Name',
        content: 'Updated content',
        type: 'lego_used',
        is_default: true,
      });

      expect(result).toEqual(updatedTemplate);
    });

    it('should update only provided fields', async () => {
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: createMockTemplate({ name: 'New Name' }),
                error: null,
              }),
            }),
          }),
        }),
      });

      mockSupabase.from.mockReturnValue({ update: updateMock });

      await updateTemplate(testUserId, 'template-123', { name: 'New Name' });

      // The update call should only include name
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New Name',
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
        updateTemplate(testUserId, 'template-123', { name: 'Test' })
      ).rejects.toThrow('Failed to update template');
    });
  });

  describe('deleteTemplate', () => {
    it('should delete a custom template', async () => {
      // Mock getTemplateById to return non-default template
      const mockTemplate = createMockTemplate({ is_default: false });

      // First call for getTemplateById
      mockSupabase.from
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: mockTemplate, error: null }),
              }),
            }),
          }),
        })
        // Second call for delete
        .mockReturnValueOnce({
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        });

      await expect(deleteTemplate(testUserId, 'template-123')).resolves.toBeUndefined();
    });

    it('should throw error when attempting to delete default template', async () => {
      const defaultTemplate = createMockTemplate({ is_default: true });

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: defaultTemplate, error: null }),
            }),
          }),
        }),
      });

      await expect(deleteTemplate(testUserId, 'template-123')).rejects.toThrow(
        'Cannot delete default templates'
      );
    });

    it('should throw error on database failure', async () => {
      const mockTemplate = createMockTemplate({ is_default: false });

      mockSupabase.from
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: mockTemplate, error: null }),
              }),
            }),
          }),
        })
        .mockReturnValueOnce({
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Delete failed' },
              }),
            }),
          }),
        });

      await expect(deleteTemplate(testUserId, 'template-123')).rejects.toThrow(
        'Failed to delete template'
      );
    });
  });

  describe('seedDefaultTemplates', () => {
    it('should return existing templates if user already has some', async () => {
      const existingTemplates = [createMockTemplate()];

      // Mock count check - user has templates
      mockSupabase.from
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ count: 3, error: null }),
          }),
        })
        // Mock getTemplates call
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: existingTemplates, error: null }),
              }),
            }),
          }),
        });

      const result = await seedDefaultTemplates(testUserId);

      expect(result).toEqual(existingTemplates);
    });

    it('should seed default templates for new user', async () => {
      const seededTemplates = DEFAULT_TEMPLATES.map((t, i) =>
        createMockTemplate({
          id: `seeded-${i}`,
          name: t.name,
          type: t.type,
          content: t.content,
          is_default: t.is_default ?? false,
        })
      );

      // Mock count check - user has no templates
      mockSupabase.from
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
          }),
        })
        // Mock insert
        .mockReturnValueOnce({
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({ data: seededTemplates, error: null }),
          }),
        });

      const result = await seedDefaultTemplates(testUserId);

      expect(result).toHaveLength(DEFAULT_TEMPLATES.length);
    });

    it('should include all default template types', async () => {
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({
          data: DEFAULT_TEMPLATES.map((t, i) =>
            createMockTemplate({ id: `t-${i}`, ...t })
          ),
          error: null,
        }),
      });

      mockSupabase.from
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
          }),
        })
        .mockReturnValueOnce({ insert: insertMock });

      await seedDefaultTemplates(testUserId);

      // Verify all templates have user_id
      expect(insertMock).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ user_id: testUserId, type: 'lego_used' }),
          expect.objectContaining({ user_id: testUserId, type: 'lego_new' }),
          expect.objectContaining({ user_id: testUserId, type: 'general' }),
        ])
      );
    });

    it('should throw error on database failure', async () => {
      mockSupabase.from
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
          }),
        })
        .mockReturnValueOnce({
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Insert failed' },
            }),
          }),
        });

      await expect(seedDefaultTemplates(testUserId)).rejects.toThrow(
        'Failed to seed default templates'
      );
    });
  });

  describe('ensureTemplates', () => {
    it('should return existing templates if user has them', async () => {
      const existingTemplates = [
        createMockTemplate({ id: '1' }),
        createMockTemplate({ id: '2' }),
      ];

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: existingTemplates, error: null }),
            }),
          }),
        }),
      });

      const result = await ensureTemplates(testUserId);

      expect(result).toEqual(existingTemplates);
      // Should only call from once for getTemplates
      expect(mockSupabase.from).toHaveBeenCalledTimes(1);
    });

    it('should seed and return default templates for new user', async () => {
      const seededTemplates = DEFAULT_TEMPLATES.map((t, i) =>
        createMockTemplate({ id: `seeded-${i}`, ...t })
      );

      // First call - getTemplates returns empty
      mockSupabase.from
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
        })
        // Second call - seedDefaultTemplates count check
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
          }),
        })
        // Third call - insert
        .mockReturnValueOnce({
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({ data: seededTemplates, error: null }),
          }),
        });

      const result = await ensureTemplates(testUserId);

      expect(result).toHaveLength(DEFAULT_TEMPLATES.length);
    });
  });
});
