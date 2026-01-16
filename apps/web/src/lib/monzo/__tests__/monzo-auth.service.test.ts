import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MonzoAuthService } from '../monzo-auth.service';

// Mock dependencies
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/crypto', () => ({
  encrypt: vi.fn((value: string) => Promise.resolve(`encrypted_${value}`)),
  decrypt: vi.fn((value: string) => Promise.resolve(value.replace('encrypted_', ''))),
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('MonzoAuthService', () => {
  let service: MonzoAuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MonzoAuthService({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      redirectUri: 'http://localhost:3000/api/integrations/monzo/callback',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAuthorizationUrl', () => {
    it('should generate a valid authorization URL', () => {
      const userId = 'user-123';
      const url = service.getAuthorizationUrl(userId);

      expect(url).toContain('https://auth.monzo.com');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('redirect_uri=');
      expect(url).toContain('response_type=code');
      expect(url).toContain('state=');
    });

    it('should include return URL in state when provided', () => {
      const userId = 'user-123';
      const returnUrl = '/settings/integrations';
      const url = service.getAuthorizationUrl(userId, returnUrl);

      // State should be base64url encoded
      const stateParam = new URL(url).searchParams.get('state');
      expect(stateParam).toBeTruthy();

      // Decode and verify
      const decoded = JSON.parse(Buffer.from(stateParam!, 'base64url').toString());
      expect(decoded.userId).toBe(userId);
      expect(decoded.returnUrl).toBe(returnUrl);
    });

    it('should encode user ID in state parameter', () => {
      const userId = 'user-456';
      const url = service.getAuthorizationUrl(userId);

      const stateParam = new URL(url).searchParams.get('state');
      const decoded = JSON.parse(Buffer.from(stateParam!, 'base64url').toString());
      expect(decoded.userId).toBe(userId);
    });
  });

  describe('handleCallback', () => {
    it('should return error for invalid state parameter', async () => {
      const result = await service.handleCallback('auth-code', 'invalid-state');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid state parameter');
      expect(result.requiresFullSync).toBe(false);
    });

    it('should return error when token exchange fails', async () => {
      const userId = 'user-123';
      const state = Buffer.from(JSON.stringify({ userId })).toString('base64url');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Token exchange failed'),
      });

      const result = await service.handleCallback('auth-code', state);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Token exchange failed');
    });

    it('should return error when no personal account is found', async () => {
      const userId = 'user-123';
      const state = Buffer.from(JSON.stringify({ userId })).toString('base64url');

      // Mock successful token exchange
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'test-access-token',
            refresh_token: 'test-refresh-token',
            expires_in: 3600,
            user_id: 'monzo-user-123',
          }),
      });

      // Mock accounts fetch - no personal account
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            accounts: [{ id: 'acc-1', type: 'uk_business' }],
          }),
      });

      const result = await service.handleCallback('auth-code', state);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No personal account found');
    });

    it('should complete successful callback for new connection', async () => {
      const userId = 'user-123';
      const returnUrl = '/settings';
      const state = Buffer.from(JSON.stringify({ userId, returnUrl })).toString('base64url');
      const { createClient } = await import('@/lib/supabase/server');

      // Mock successful token exchange
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'test-access-token',
            refresh_token: 'test-refresh-token',
            expires_in: 3600,
            user_id: 'monzo-user-123',
          }),
      });

      // Mock accounts fetch - personal account found
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            accounts: [{ id: 'acc-1', type: 'uk_retail' }],
          }),
      });

      const mockFrom = vi.fn();
      // Check for existing credentials - not found (new connection)
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: null,
            error: { code: 'PGRST116' },
          })
        ),
      });
      // Store credentials
      mockFrom.mockReturnValueOnce({
        upsert: vi.fn(() => Promise.resolve({ error: null })),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.handleCallback('auth-code', state);

      expect(result.success).toBe(true);
      expect(result.requiresFullSync).toBe(true);
      expect(result.returnUrl).toBe(returnUrl);
    });

    it('should complete successful callback for reconnection', async () => {
      const userId = 'user-123';
      const state = Buffer.from(JSON.stringify({ userId })).toString('base64url');
      const { createClient } = await import('@/lib/supabase/server');

      // Mock successful token exchange
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'test-access-token',
            refresh_token: 'test-refresh-token',
            expires_in: 3600,
            user_id: 'monzo-user-123',
          }),
      });

      // Mock accounts fetch - joint account found
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            accounts: [{ id: 'acc-joint', type: 'uk_retail_joint' }],
          }),
      });

      const mockFrom = vi.fn();
      // Check for existing credentials - found (reconnection)
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              access_token: 'encrypted_old-token',
              account_id: 'acc-old',
            },
            error: null,
          })
        ),
      });
      // Store new credentials
      mockFrom.mockReturnValueOnce({
        upsert: vi.fn(() => Promise.resolve({ error: null })),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.handleCallback('auth-code', state);

      expect(result.success).toBe(true);
      expect(result.requiresFullSync).toBe(false);
    });

    it('should handle fetch accounts failure', async () => {
      const userId = 'user-123';
      const state = Buffer.from(JSON.stringify({ userId })).toString('base64url');

      // Mock successful token exchange
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'test-access-token',
            refresh_token: 'test-refresh-token',
            expires_in: 3600,
            user_id: 'monzo-user-123',
          }),
      });

      // Mock accounts fetch failure
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server error'),
      });

      const result = await service.handleCallback('auth-code', state);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to fetch accounts');
    });
  });

  describe('getAccessToken', () => {
    it('should return null when no credentials exist', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      vi.mocked(createClient).mockResolvedValue({
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn(() =>
            Promise.resolve({
              data: null,
              error: { code: 'PGRST116' },
            })
          ),
        })),
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.getAccessToken('user-123');

      expect(result).toBeNull();
    });

    it('should return null when token is expired', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      vi.mocked(createClient).mockResolvedValue({
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn(() =>
            Promise.resolve({
              data: {
                access_token: 'encrypted_test-token',
                access_token_expires_at: new Date(Date.now() - 3600000).toISOString(), // Expired
              },
              error: null,
            })
          ),
        })),
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.getAccessToken('user-123');

      expect(result).toBeNull();
    });

    it('should return decrypted token when valid', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      vi.mocked(createClient).mockResolvedValue({
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn(() =>
            Promise.resolve({
              data: {
                access_token: 'encrypted_my-valid-token',
                access_token_expires_at: new Date(Date.now() + 3600000).toISOString(),
              },
              error: null,
            })
          ),
        })),
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.getAccessToken('user-123');

      expect(result).toBe('my-valid-token');
    });

    it('should return null when decrypt fails', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      const { decrypt } = await import('@/lib/crypto');

      vi.mocked(decrypt).mockRejectedValueOnce(new Error('Decrypt failed'));
      vi.mocked(createClient).mockResolvedValue({
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn(() =>
            Promise.resolve({
              data: {
                access_token: 'invalid-encrypted-token',
                access_token_expires_at: new Date(Date.now() + 3600000).toISOString(),
              },
              error: null,
            })
          ),
        })),
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.getAccessToken('user-123');

      expect(result).toBeNull();
    });
  });

  describe('getAccountId', () => {
    it('should return null when no credentials exist', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      vi.mocked(createClient).mockResolvedValue({
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn(() =>
            Promise.resolve({
              data: null,
              error: { code: 'PGRST116' },
            })
          ),
        })),
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.getAccountId('user-123');

      expect(result).toBeNull();
    });

    it('should return account ID when credentials exist', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      vi.mocked(createClient).mockResolvedValue({
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn(() =>
            Promise.resolve({
              data: {
                access_token: 'encrypted_test-token',
                access_token_expires_at: new Date(Date.now() + 3600000).toISOString(),
                account_id: 'acc-123',
              },
              error: null,
            })
          ),
        })),
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.getAccountId('user-123');

      expect(result).toBe('acc-123');
    });
  });

  describe('getConnectionStatus', () => {
    it('should return not connected when no credentials', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      vi.mocked(createClient).mockResolvedValue({
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          single: vi.fn(() =>
            Promise.resolve({
              data: null,
              error: { code: 'PGRST116' },
            })
          ),
        })),
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.getConnectionStatus('user-123');

      expect(result.isConnected).toBe(false);
    });

    it('should return not connected when token is expired', async () => {
      const mockFrom = vi.fn();
      const { createClient } = await import('@/lib/supabase/server');

      // First call for credentials
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              access_token: 'encrypted_test-token',
              access_token_expires_at: new Date(Date.now() - 3600000).toISOString(),
              account_id: 'acc-123',
              account_type: 'uk_retail',
              monzo_user_id: 'monzo-user-123',
            },
            error: null,
          })
        ),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.getConnectionStatus('user-123');

      expect(result.isConnected).toBe(false);
      expect(result.accountId).toBe('acc-123');
    });
  });

  describe('isConnected', () => {
    it('should delegate to getConnectionStatus', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      vi.mocked(createClient).mockResolvedValue({
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          single: vi.fn(() =>
            Promise.resolve({
              data: null,
              error: { code: 'PGRST116' },
            })
          ),
        })),
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.isConnected('user-123');

      expect(result).toBe(false);
    });
  });

  describe('storeManualToken', () => {
    it('should return error for invalid token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      const result = await service.storeManualToken('user-123', 'invalid-token');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to fetch accounts');
    });

    it('should return error when no personal account found', async () => {
      // Mock accounts fetch - no personal account
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            accounts: [{ id: 'acc-1', type: 'uk_business' }],
          }),
      });

      const result = await service.storeManualToken('user-123', 'valid-token');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No personal account found');
    });

    it('should return error when whoami fails', async () => {
      // Mock accounts fetch - personal account found
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            accounts: [{ id: 'acc-1', type: 'uk_retail' }],
          }),
      });

      // Mock whoami failure
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      const result = await service.storeManualToken('user-123', 'bad-token');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid access token');
    });

    it('should successfully store manual token for new connection', async () => {
      const { createClient } = await import('@/lib/supabase/server');

      // Mock accounts fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            accounts: [{ id: 'acc-1', type: 'uk_retail' }],
          }),
      });

      // Mock whoami
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            user_id: 'monzo-user-123',
          }),
      });

      const mockFrom = vi.fn();
      // Check for existing credentials - not found
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: null,
            error: { code: 'PGRST116' },
          })
        ),
      });
      // Store credentials
      mockFrom.mockReturnValueOnce({
        upsert: vi.fn(() => Promise.resolve({ error: null })),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.storeManualToken('user-123', 'valid-token');

      expect(result.success).toBe(true);
      expect(result.requiresFullSync).toBe(true);
    });

    it('should return error when upsert fails', async () => {
      const { createClient } = await import('@/lib/supabase/server');

      // Mock accounts fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            accounts: [{ id: 'acc-1', type: 'uk_retail' }],
          }),
      });

      // Mock whoami
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            user_id: 'monzo-user-123',
          }),
      });

      const mockFrom = vi.fn();
      // Check for existing credentials
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: null,
            error: { code: 'PGRST116' },
          })
        ),
      });
      // Store credentials fails
      mockFrom.mockReturnValueOnce({
        upsert: vi.fn(() =>
          Promise.resolve({ error: { message: 'Database error' } })
        ),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.storeManualToken('user-123', 'valid-token');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to store credentials');
    });
  });

  describe('disconnect', () => {
    it('should attempt to logout from Monzo API', async () => {
      const { createClient } = await import('@/lib/supabase/server');

      // Mock credentials fetch
      const mockFrom = vi.fn();
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              access_token: 'encrypted_test-token',
              access_token_expires_at: new Date(Date.now() + 3600000).toISOString(),
            },
            error: null,
          })
        ),
      });

      // Mock delete
      mockFrom.mockReturnValueOnce({
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn(() => Promise.resolve({ error: null })),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      // Mock logout request
      mockFetch.mockResolvedValueOnce({ ok: true });

      await service.disconnect('user-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.monzo.com/oauth2/logout',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should continue with cleanup even if logout fails', async () => {
      const { createClient } = await import('@/lib/supabase/server');

      const mockFrom = vi.fn();
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              access_token: 'encrypted_test-token',
              access_token_expires_at: new Date(Date.now() + 3600000).toISOString(),
            },
            error: null,
          })
        ),
      });

      mockFrom.mockReturnValueOnce({
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn(() => Promise.resolve({ error: null })),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      // Mock logout failure
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      // Should not throw
      await expect(service.disconnect('user-123')).resolves.toBeUndefined();
    });

    it('should throw error when delete fails', async () => {
      const { createClient } = await import('@/lib/supabase/server');

      const mockFrom = vi.fn();
      // Mock credentials fetch - no credentials
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: null,
            error: { code: 'PGRST116' },
          })
        ),
      });

      // Mock delete failure
      mockFrom.mockReturnValueOnce({
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn(() =>
          Promise.resolve({ error: { message: 'Database error' } })
        ),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      await expect(service.disconnect('user-123')).rejects.toThrow(
        'Failed to disconnect Monzo account'
      );
    });

    it('should disconnect without logout when no credentials', async () => {
      const { createClient } = await import('@/lib/supabase/server');

      const mockFrom = vi.fn();
      // Mock credentials fetch - no credentials
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: null,
            error: { code: 'PGRST116' },
          })
        ),
      });

      // Mock successful delete
      mockFrom.mockReturnValueOnce({
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn(() => Promise.resolve({ error: null })),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      // Should not call fetch (no logout needed)
      await service.disconnect('user-123');

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});

