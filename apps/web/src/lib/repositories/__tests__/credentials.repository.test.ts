import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CredentialsRepository } from '../credentials.repository';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';

// Mock crypto functions
vi.mock('../../crypto', () => ({
  encryptObject: vi.fn((data) => Promise.resolve(`encrypted:${JSON.stringify(data)}`)),
  decryptObject: vi.fn((encrypted: string) => {
    if (encrypted.startsWith('encrypted:')) {
      return Promise.resolve(JSON.parse(encrypted.replace('encrypted:', '')));
    }
    throw new Error('Decryption failed');
  }),
}));

describe('CredentialsRepository', () => {
  let repository: CredentialsRepository;
  let mockSupabase: ReturnType<typeof createMockSupabase>;

  // Helper to create mock Supabase client with proper method chaining
  function createMockSupabase() {
    // Track the mock responses
    let nextResponse: unknown = { data: null, error: null };

    const mockFrom = vi.fn().mockImplementation(() => {
      // Create a thenable chain that resolves to nextResponse
      const createThenable = () => {
        const thenable = {
          select: vi.fn().mockImplementation(() => createThenable()),
          insert: vi.fn().mockImplementation(() => createThenable()),
          update: vi.fn().mockImplementation(() => createThenable()),
          delete: vi.fn().mockImplementation(() => createThenable()),
          upsert: vi.fn().mockImplementation(() => Promise.resolve(nextResponse)),
          eq: vi.fn().mockImplementation(() => createThenable()),
          single: vi.fn().mockImplementation(() => Promise.resolve(nextResponse)),
          // Make the chain thenable - this allows awaiting any point in the chain
          then: (resolve: (value: unknown) => void, reject?: (error: unknown) => void) => {
            return Promise.resolve(nextResponse).then(resolve, reject);
          },
        };
        return thenable;
      };

      return createThenable();
    });

    return {
      from: mockFrom,
      setNextResponse: (response: unknown) => {
        nextResponse = response;
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = createMockSupabase();
    repository = new CredentialsRepository(mockSupabase as unknown as SupabaseClient<Database>);
  });

  describe('getCredentials', () => {
    it('should return decrypted credentials for a platform', async () => {
      const mockCredentials = {
        apiKey: 'test-api-key',
        apiSecret: 'test-api-secret',
      };

      mockSupabase.setNextResponse({
        data: {
          id: 'cred-1',
          user_id: 'user-1',
          platform: 'bricklink',
          credentials_encrypted: `encrypted:${JSON.stringify(mockCredentials)}`,
        },
        error: null,
      });

      const result = await repository.getCredentials<typeof mockCredentials>('user-1', 'bricklink');

      expect(result).toEqual(mockCredentials);
      expect(mockSupabase.from).toHaveBeenCalledWith('platform_credentials');
    });

    it('should return null when credentials not found (PGRST116 error)', async () => {
      mockSupabase.setNextResponse({
        data: null,
        error: { code: 'PGRST116', message: 'No rows found' },
      });

      const result = await repository.getCredentials('user-1', 'bricklink');

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      mockSupabase.setNextResponse({
        data: null,
        error: { code: 'DB_ERROR', message: 'Database error' },
      });

      await expect(
        repository.getCredentials('user-1', 'bricklink')
      ).rejects.toThrow('Failed to get credentials: Database error');
    });

    it('should return null when credentials_encrypted is null', async () => {
      mockSupabase.setNextResponse({
        data: {
          id: 'cred-1',
          user_id: 'user-1',
          platform: 'bricklink',
          credentials_encrypted: null,
        },
        error: null,
      });

      const result = await repository.getCredentials('user-1', 'bricklink');

      expect(result).toBeNull();
    });

    it('should throw error when decryption fails', async () => {
      mockSupabase.setNextResponse({
        data: {
          id: 'cred-1',
          user_id: 'user-1',
          platform: 'bricklink',
          credentials_encrypted: 'invalid-encrypted-data',
        },
        error: null,
      });

      await expect(
        repository.getCredentials('user-1', 'bricklink')
      ).rejects.toThrow('Failed to decrypt credentials');
    });
  });

  describe('saveCredentials', () => {
    it('should encrypt and save credentials', async () => {
      const credentials = {
        apiKey: 'new-api-key',
        apiSecret: 'new-api-secret',
      };

      mockSupabase.setNextResponse({ error: null });

      await repository.saveCredentials('user-1', 'bricklink', credentials);

      expect(mockSupabase.from).toHaveBeenCalledWith('platform_credentials');
    });

    it('should throw error on save failure', async () => {
      mockSupabase.setNextResponse({
        error: { message: 'Upsert failed' },
      });

      await expect(
        repository.saveCredentials('user-1', 'bricklink', { apiKey: 'key' })
      ).rejects.toThrow('Failed to save credentials: Upsert failed');
    });

    it('should handle complex credential objects', async () => {
      const credentials = {
        clientId: 'client-123',
        clientSecret: 'secret-456',
        accessToken: 'token-789',
        refreshToken: 'refresh-012',
        expiresAt: '2024-12-31T23:59:59Z',
        nested: {
          value: 'nested-value',
        },
      };

      mockSupabase.setNextResponse({ error: null });

      await repository.saveCredentials('user-1', 'amazon', credentials);

      // Verify encrypt was called with the credentials
      const { encryptObject } = await import('../../crypto');
      expect(encryptObject).toHaveBeenCalledWith(credentials);
    });
  });

  describe('deleteCredentials', () => {
    it('should delete credentials for a platform', async () => {
      mockSupabase.setNextResponse({ error: null });

      await repository.deleteCredentials('user-1', 'bricklink');

      expect(mockSupabase.from).toHaveBeenCalledWith('platform_credentials');
    });

    it('should throw error on delete failure', async () => {
      mockSupabase.setNextResponse({
        error: { message: 'Delete failed' },
      });

      await expect(
        repository.deleteCredentials('user-1', 'bricklink')
      ).rejects.toThrow('Failed to delete credentials: Delete failed');
    });
  });

  describe('hasCredentials', () => {
    it('should return true when credentials exist', async () => {
      mockSupabase.setNextResponse({ count: 1, error: null });

      const result = await repository.hasCredentials('user-1', 'bricklink');

      expect(result).toBe(true);
    });

    it('should return false when credentials do not exist', async () => {
      mockSupabase.setNextResponse({ count: 0, error: null });

      const result = await repository.hasCredentials('user-1', 'bricklink');

      expect(result).toBe(false);
    });

    it('should return false when count is null', async () => {
      mockSupabase.setNextResponse({ count: null, error: null });

      const result = await repository.hasCredentials('user-1', 'bricklink');

      expect(result).toBe(false);
    });

    it('should throw error on database failure', async () => {
      mockSupabase.setNextResponse({
        count: null,
        error: { message: 'Query failed' },
      });

      await expect(
        repository.hasCredentials('user-1', 'bricklink')
      ).rejects.toThrow('Failed to check credentials: Query failed');
    });
  });

  describe('getConfiguredPlatforms', () => {
    it('should return list of configured platforms', async () => {
      mockSupabase.setNextResponse({
        data: [
          { platform: 'bricklink' },
          { platform: 'amazon' },
          { platform: 'ebay' },
        ],
        error: null,
      });

      const result = await repository.getConfiguredPlatforms('user-1');

      expect(result).toEqual(['bricklink', 'amazon', 'ebay']);
    });

    it('should return empty array when no platforms configured', async () => {
      mockSupabase.setNextResponse({
        data: [],
        error: null,
      });

      const result = await repository.getConfiguredPlatforms('user-1');

      expect(result).toEqual([]);
    });

    it('should return empty array when data is null', async () => {
      mockSupabase.setNextResponse({
        data: null,
        error: null,
      });

      const result = await repository.getConfiguredPlatforms('user-1');

      expect(result).toEqual([]);
    });

    it('should throw error on database failure', async () => {
      mockSupabase.setNextResponse({
        data: null,
        error: { message: 'Query failed' },
      });

      await expect(
        repository.getConfiguredPlatforms('user-1')
      ).rejects.toThrow('Failed to get configured platforms: Query failed');
    });
  });

  describe('credential types', () => {
    it('should handle BrickLink OAuth credentials', async () => {
      interface BrickLinkCredentials {
        consumerKey: string;
        consumerSecret: string;
        tokenValue: string;
        tokenSecret: string;
      }

      const credentials: BrickLinkCredentials = {
        consumerKey: 'consumer-key',
        consumerSecret: 'consumer-secret',
        tokenValue: 'token-value',
        tokenSecret: 'token-secret',
      };

      mockSupabase.setNextResponse({
        data: {
          credentials_encrypted: `encrypted:${JSON.stringify(credentials)}`,
        },
        error: null,
      });

      const result = await repository.getCredentials<BrickLinkCredentials>('user-1', 'bricklink');

      expect(result).toEqual(credentials);
    });

    it('should handle Amazon SP-API credentials', async () => {
      interface AmazonCredentials {
        sellerId: string;
        clientId: string;
        clientSecret: string;
        refreshToken: string;
        region: string;
      }

      const credentials: AmazonCredentials = {
        sellerId: 'seller-123',
        clientId: 'client-456',
        clientSecret: 'secret-789',
        refreshToken: 'refresh-012',
        region: 'EU',
      };

      mockSupabase.setNextResponse({
        data: {
          credentials_encrypted: `encrypted:${JSON.stringify(credentials)}`,
        },
        error: null,
      });

      const result = await repository.getCredentials<AmazonCredentials>('user-1', 'amazon');

      expect(result).toEqual(credentials);
    });

    it('should handle eBay OAuth credentials', async () => {
      interface EbayCredentials {
        clientId: string;
        clientSecret: string;
        accessToken: string;
        refreshToken: string;
        tokenExpiresAt: string;
      }

      const credentials: EbayCredentials = {
        clientId: 'ebay-client',
        clientSecret: 'ebay-secret',
        accessToken: 'ebay-access',
        refreshToken: 'ebay-refresh',
        tokenExpiresAt: '2024-12-31T23:59:59Z',
      };

      mockSupabase.setNextResponse({
        data: {
          credentials_encrypted: `encrypted:${JSON.stringify(credentials)}`,
        },
        error: null,
      });

      const result = await repository.getCredentials<EbayCredentials>('user-1', 'ebay');

      expect(result).toEqual(credentials);
    });

    it('should handle Brick Owl API key credentials', async () => {
      interface BrickOwlCredentials {
        apiKey: string;
      }

      const credentials: BrickOwlCredentials = {
        apiKey: 'brickowl-api-key',
      };

      mockSupabase.setNextResponse({
        data: {
          credentials_encrypted: `encrypted:${JSON.stringify(credentials)}`,
        },
        error: null,
      });

      const result = await repository.getCredentials<BrickOwlCredentials>('user-1', 'brickowl');

      expect(result).toEqual(credentials);
    });
  });
});
