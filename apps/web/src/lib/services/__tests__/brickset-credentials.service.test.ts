import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BricksetCredentialsService } from '../brickset-credentials.service';

// Mock crypto functions
vi.mock('../../crypto', () => ({
  encryptObject: vi.fn((obj) => Promise.resolve(`encrypted:${JSON.stringify(obj)}`)),
  decryptObject: vi.fn((str) => {
    if (str.startsWith('encrypted:')) {
      return Promise.resolve(JSON.parse(str.replace('encrypted:', '')));
    }
    throw new Error('Decryption failed');
  }),
}));

// Mock BricksetApiClient
const mockBricksetClient = {
  checkKey: vi.fn(),
  getKeyUsageStats: vi.fn(),
};

vi.mock('../../brickset', () => ({
  BricksetApiClient: class MockBricksetApiClient {
    apiKey: string;
    constructor(apiKey: string) {
      this.apiKey = apiKey;
    }
    checkKey = mockBricksetClient.checkKey;
    getKeyUsageStats = mockBricksetClient.getKeyUsageStats;
  },
}));

describe('BricksetCredentialsService', () => {
  let service: BricksetCredentialsService;
  const userId = 'test-user-id';

  // Mock Supabase client
  const mockSupabase = {
    from: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new BricksetCredentialsService(mockSupabase as any);
  });

  describe('isConfigured', () => {
    it('should return true when credentials exist', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ count: 1, error: null }),
      });

      const result = await service.isConfigured(userId);

      expect(result).toBe(true);
      expect(mockSupabase.from).toHaveBeenCalledWith('brickset_api_credentials');
    });

    it('should return false when no credentials exist', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
      });

      const result = await service.isConfigured(userId);

      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ count: null, error: { message: 'DB error' } }),
      });

      const result = await service.isConfigured(userId);

      expect(result).toBe(false);
    });

    it('should return false when count is null', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ count: null, error: null }),
      });

      const result = await service.isConfigured(userId);

      expect(result).toBe(false);
    });
  });

  describe('getCredentials', () => {
    it('should return decrypted credentials when found', async () => {
      const credentials = { apiKey: 'test-api-key' };
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { api_key_encrypted: `encrypted:${JSON.stringify(credentials)}` },
          error: null,
        }),
      });

      const result = await service.getCredentials(userId);

      expect(result).toEqual(credentials);
    });

    it('should return null when not found (PGRST116)', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { code: 'PGRST116', message: 'Not found' },
        }),
      });

      const result = await service.getCredentials(userId);

      expect(result).toBeNull();
    });

    it('should throw on other database errors', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { code: 'OTHER_ERROR', message: 'Database error' },
        }),
      });

      await expect(service.getCredentials(userId)).rejects.toThrow('Failed to get credentials');
    });

    it('should return null when api_key_encrypted is null', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { api_key_encrypted: null },
          error: null,
        }),
      });

      const result = await service.getCredentials(userId);

      expect(result).toBeNull();
    });

    it('should throw on decryption error', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { api_key_encrypted: 'invalid-encrypted-data' },
          error: null,
        }),
      });

      await expect(service.getCredentials(userId)).rejects.toThrow('Failed to decrypt credentials');
    });
  });

  describe('getApiKey', () => {
    it('should return the API key from credentials', async () => {
      const credentials = { apiKey: 'test-api-key' };
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { api_key_encrypted: `encrypted:${JSON.stringify(credentials)}` },
          error: null,
        }),
      });

      const result = await service.getApiKey(userId);

      expect(result).toBe('test-api-key');
    });

    it('should return null when no credentials', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { code: 'PGRST116' },
        }),
      });

      const result = await service.getApiKey(userId);

      expect(result).toBeNull();
    });
  });

  describe('saveCredentials', () => {
    it('should encrypt and save credentials', async () => {
      const mockBuilder = {
        upsert: vi.fn().mockResolvedValue({ error: null }),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      await service.saveCredentials(userId, { apiKey: 'new-api-key' });

      expect(mockSupabase.from).toHaveBeenCalledWith('brickset_api_credentials');
      expect(mockBuilder.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: userId,
          api_key_encrypted: expect.stringContaining('encrypted:'),
        }),
        { onConflict: 'user_id' }
      );
    });

    it('should throw on save error', async () => {
      mockSupabase.from.mockReturnValue({
        upsert: vi.fn().mockResolvedValue({ error: { message: 'Save failed' } }),
      });

      await expect(service.saveCredentials(userId, { apiKey: 'key' })).rejects.toThrow(
        'Failed to save credentials'
      );
    });
  });

  describe('deleteCredentials', () => {
    it('should delete credentials', async () => {
      const mockBuilder = {
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      await service.deleteCredentials(userId);

      expect(mockSupabase.from).toHaveBeenCalledWith('brickset_api_credentials');
      expect(mockBuilder.delete).toHaveBeenCalled();
      expect(mockBuilder.eq).toHaveBeenCalledWith('user_id', userId);
    });

    it('should throw on delete error', async () => {
      const mockBuilder = {
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: { message: 'Delete failed' } }),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      await expect(service.deleteCredentials(userId)).rejects.toThrow(
        'Failed to delete credentials'
      );
    });
  });

  describe('testConnection', () => {
    it('should return true when connection is valid', async () => {
      const credentials = { apiKey: 'valid-key' };
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { api_key_encrypted: `encrypted:${JSON.stringify(credentials)}` },
          error: null,
        }),
      });
      mockBricksetClient.checkKey.mockResolvedValue(true);

      const result = await service.testConnection(userId);

      expect(result).toBe(true);
      expect(mockBricksetClient.checkKey).toHaveBeenCalled();
    });

    it('should return false when no credentials', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { code: 'PGRST116' },
        }),
      });

      const result = await service.testConnection(userId);

      expect(result).toBe(false);
      expect(mockBricksetClient.checkKey).not.toHaveBeenCalled();
    });

    it('should return false when API key is invalid', async () => {
      const credentials = { apiKey: 'invalid-key' };
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { api_key_encrypted: `encrypted:${JSON.stringify(credentials)}` },
          error: null,
        }),
      });
      mockBricksetClient.checkKey.mockResolvedValue(false);

      const result = await service.testConnection(userId);

      expect(result).toBe(false);
    });
  });

  describe('testConnectionWithCredentials', () => {
    it('should return true when credentials are valid', async () => {
      mockBricksetClient.checkKey.mockResolvedValue(true);

      const result = await service.testConnectionWithCredentials({ apiKey: 'valid-key' });

      expect(result).toBe(true);
    });

    it('should return false when credentials are invalid', async () => {
      mockBricksetClient.checkKey.mockResolvedValue(false);

      const result = await service.testConnectionWithCredentials({ apiKey: 'invalid-key' });

      expect(result).toBe(false);
    });

    it('should return false on API error', async () => {
      mockBricksetClient.checkKey.mockRejectedValue(new Error('API error'));

      const result = await service.testConnectionWithCredentials({ apiKey: 'key' });

      expect(result).toBe(false);
    });
  });

  describe('updateLastUsed', () => {
    it('should update last_used_at timestamp', async () => {
      const mockBuilder = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      await service.updateLastUsed(userId);

      expect(mockSupabase.from).toHaveBeenCalledWith('brickset_api_credentials');
      expect(mockBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          last_used_at: expect.any(String),
        })
      );
    });

    it('should not throw on update error (non-fatal)', async () => {
      const mockBuilder = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: { message: 'Update failed' } }),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      // Should not throw
      await expect(service.updateLastUsed(userId)).resolves.not.toThrow();
    });
  });

  describe('getUsageStats', () => {
    it('should return configured false when no credentials', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { code: 'PGRST116' },
        }),
      });

      const result = await service.getUsageStats(userId);

      expect(result.configured).toBe(false);
      expect(result.lastUsedAt).toBeNull();
    });

    it('should return usage stats when credentials exist', async () => {
      const credentials = { apiKey: 'test-key' };
      const usageStats = [{ dateFrom: '2025-01-01', dateTo: '2025-01-31', count: 100 }];

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            last_used_at: '2025-01-15T10:00:00Z',
            api_key_encrypted: `encrypted:${JSON.stringify(credentials)}`,
          },
          error: null,
        }),
      });
      mockBricksetClient.getKeyUsageStats.mockResolvedValue(usageStats);

      const result = await service.getUsageStats(userId);

      expect(result.configured).toBe(true);
      expect(result.lastUsedAt).toBe('2025-01-15T10:00:00Z');
      expect(result.apiUsage).toEqual(usageStats);
    });

    it('should return stats without apiUsage when API call fails', async () => {
      const credentials = { apiKey: 'test-key' };

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            last_used_at: '2025-01-15T10:00:00Z',
            api_key_encrypted: `encrypted:${JSON.stringify(credentials)}`,
          },
          error: null,
        }),
      });
      mockBricksetClient.getKeyUsageStats.mockRejectedValue(new Error('API error'));

      const result = await service.getUsageStats(userId);

      expect(result.configured).toBe(true);
      expect(result.lastUsedAt).toBe('2025-01-15T10:00:00Z');
      expect(result.apiUsage).toBeUndefined();
    });
  });
});
