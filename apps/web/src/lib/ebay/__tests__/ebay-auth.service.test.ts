/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EbayAuthService, ebayAuthService, type EbayAuthConfig } from '../ebay-auth.service';

// Create a properly chained mock Supabase client
// The Supabase query builder returns thenable objects that can be awaited
function createMockSupabaseClient() {
  // Create mock result holders that can be modified per-test
  let singleResult = { data: null, error: null };
  let chainResult = { error: null };

  // Create a thenable (promise-like) object that supports chaining
  const createChainableThenable = () => {
    const thenable: Record<string, any> = {};

    // All chainable methods return the same thenable
    thenable.select = vi.fn(() => thenable);
    thenable.insert = vi.fn(() => thenable);
    thenable.update = vi.fn(() => thenable);
    thenable.upsert = vi.fn(() => thenable);
    thenable.delete = vi.fn(() => thenable);
    thenable.eq = vi.fn(() => thenable);

    // Methods that end the chain
    thenable.single = vi.fn(() => Promise.resolve(singleResult));

    // Make the object thenable (awaitable) for operations like delete().eq()
    thenable.then = function (
      onFulfilled?: (value: any) => any,
      onRejected?: (reason: any) => any
    ) {
      return Promise.resolve(chainResult).then(onFulfilled, onRejected);
    };
    thenable.catch = function (onRejected: (reason: any) => any) {
      return Promise.resolve(chainResult).catch(onRejected);
    };

    return thenable;
  };

  const queryBuilder = createChainableThenable();

  return {
    from: vi.fn(() => queryBuilder),
    _queryBuilder: queryBuilder,
    // Setters for test configuration
    setSingleResult: (result: { data: any; error: any }) => {
      singleResult = result;
    },
    setChainResult: (result: { error: any }) => {
      chainResult = result;
    },
  };
}

let mockSupabaseClient: ReturnType<typeof createMockSupabaseClient>;

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabaseClient),
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('EbayAuthService', () => {
  const validConfig: EbayAuthConfig = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'http://localhost:3000/api/integrations/ebay/callback',
    sandbox: false,
  };

  const testUserId = 'user-123';

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabaseClient = createMockSupabaseClient();
    // Reset environment variables
    process.env.EBAY_CLIENT_ID = 'env-client-id';
    process.env.EBAY_CLIENT_SECRET = 'env-client-secret';
    process.env.EBAY_REDIRECT_URI = 'http://localhost:3000/callback';
    process.env.EBAY_SANDBOX = 'false';
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('constructor', () => {
    it('should create instance with provided config', () => {
      const service = new EbayAuthService(validConfig);
      expect(service).toBeInstanceOf(EbayAuthService);
    });

    it('should use environment variables when config not provided', () => {
      const service = new EbayAuthService();
      // The service should be created without throwing
      expect(service).toBeInstanceOf(EbayAuthService);
    });

    it('should warn when missing configuration', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      delete process.env.EBAY_CLIENT_ID;
      delete process.env.EBAY_CLIENT_SECRET;
      delete process.env.EBAY_REDIRECT_URI;

      new EbayAuthService({});

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Missing eBay OAuth configuration')
      );
    });
  });

  describe('getAuthorizationUrl', () => {
    it('should generate authorization URL with required parameters', () => {
      const service = new EbayAuthService(validConfig);

      const url = service.getAuthorizationUrl(testUserId);

      expect(url).toContain('https://auth.ebay.com/oauth2/authorize');
      expect(url).toContain(`client_id=${validConfig.clientId}`);
      expect(url).toContain('response_type=code');
      expect(url).toContain(`redirect_uri=${encodeURIComponent(validConfig.redirectUri)}`);
      expect(url).toContain('scope=');
      expect(url).toContain('state=');
    });

    it('should use sandbox URL when configured', () => {
      const service = new EbayAuthService({ ...validConfig, sandbox: true });

      const url = service.getAuthorizationUrl(testUserId);

      expect(url).toContain('https://auth.sandbox.ebay.com/oauth2/authorize');
    });

    it('should include required scopes in URL', () => {
      const service = new EbayAuthService(validConfig);

      const url = service.getAuthorizationUrl(testUserId);

      expect(url).toContain('sell.fulfillment.readonly');
      expect(url).toContain('sell.finances');
      expect(url).toContain('sell.inventory');
      expect(url).toContain('sell.account');
      expect(url).toContain('sell.analytics.readonly');
    });

    it('should encode state with user ID', () => {
      const service = new EbayAuthService(validConfig);

      const url = service.getAuthorizationUrl(testUserId);
      const urlObj = new URL(url);
      const state = urlObj.searchParams.get('state');

      expect(state).toBeTruthy();
      const decoded = JSON.parse(Buffer.from(state!, 'base64url').toString());
      expect(decoded.userId).toBe(testUserId);
    });

    it('should include return URL in state when provided', () => {
      const service = new EbayAuthService(validConfig);
      const returnUrl = '/settings/integrations';

      const url = service.getAuthorizationUrl(testUserId, returnUrl);
      const urlObj = new URL(url);
      const state = urlObj.searchParams.get('state');

      const decoded = JSON.parse(Buffer.from(state!, 'base64url').toString());
      expect(decoded.returnUrl).toBe(returnUrl);
    });

    it('should include marketplace ID in state', () => {
      const service = new EbayAuthService(validConfig);

      const url = service.getAuthorizationUrl(testUserId, undefined, 'EBAY_DE');
      const urlObj = new URL(url);
      const state = urlObj.searchParams.get('state');

      const decoded = JSON.parse(Buffer.from(state!, 'base64url').toString());
      expect(decoded.marketplaceId).toBe('EBAY_DE');
    });

    it('should default to EBAY_GB marketplace', () => {
      const service = new EbayAuthService(validConfig);

      const url = service.getAuthorizationUrl(testUserId);
      const urlObj = new URL(url);
      const state = urlObj.searchParams.get('state');

      const decoded = JSON.parse(Buffer.from(state!, 'base64url').toString());
      expect(decoded.marketplaceId).toBe('EBAY_GB');
    });
  });

  describe('handleCallback', () => {
    it('should exchange code for tokens and store credentials', async () => {
      const service = new EbayAuthService(validConfig);
      const code = 'auth-code-123';
      const state = Buffer.from(
        JSON.stringify({ userId: testUserId, marketplaceId: 'EBAY_GB' })
      ).toString('base64url');

      // Mock token exchange
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'access-token-123',
          refresh_token: 'refresh-token-123',
          expires_in: 7200,
          refresh_token_expires_in: 47304000,
        }),
      });

      // Mock credentials upsert
      mockSupabaseClient._queryBuilder.upsert.mockResolvedValueOnce({ error: null });

      const result = await service.handleCallback(code, state);

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.ebay.com/identity/v1/oauth2/token',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded',
          }),
        })
      );
    });

    it('should return error for invalid state', async () => {
      const service = new EbayAuthService(validConfig);

      const result = await service.handleCallback('code', 'invalid-state');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid state parameter');
    });

    it('should return error when token exchange fails', async () => {
      const service = new EbayAuthService(validConfig);
      const state = Buffer.from(
        JSON.stringify({ userId: testUserId })
      ).toString('base64url');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Invalid authorization code',
      });

      const result = await service.handleCallback('invalid-code', state);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Token exchange failed');
    });

    it('should return returnUrl from state on success', async () => {
      const service = new EbayAuthService(validConfig);
      const returnUrl = '/settings';
      const state = Buffer.from(
        JSON.stringify({ userId: testUserId, returnUrl, marketplaceId: 'EBAY_GB' })
      ).toString('base64url');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'token',
          refresh_token: 'refresh',
          expires_in: 7200,
        }),
      });
      mockSupabaseClient._queryBuilder.upsert.mockResolvedValueOnce({ error: null });

      const result = await service.handleCallback('code', state);

      expect(result.returnUrl).toBe(returnUrl);
    });
  });

  describe('getAccessToken', () => {
    it('should return cached token when not expired', async () => {
      const service = new EbayAuthService(validConfig);
      const futureDate = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

      mockSupabaseClient._queryBuilder.single.mockResolvedValueOnce({
        data: {
          access_token: 'cached-token',
          refresh_token: 'refresh-token',
          access_token_expires_at: futureDate.toISOString(),
        },
        error: null,
      });

      const token = await service.getAccessToken(testUserId);

      expect(token).toBe('cached-token');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return null when no credentials found', async () => {
      const service = new EbayAuthService(validConfig);

      mockSupabaseClient._queryBuilder.single.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST116' },
      });

      const token = await service.getAccessToken(testUserId);

      expect(token).toBeNull();
    });

    it('should refresh token when about to expire', async () => {
      const service = new EbayAuthService(validConfig);
      const nearExpiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now (within buffer)

      mockSupabaseClient._queryBuilder.single.mockResolvedValueOnce({
        data: {
          access_token: 'old-token',
          refresh_token: 'refresh-token',
          access_token_expires_at: nearExpiry.toISOString(),
        },
        error: null,
      });

      // Mock token refresh
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-token',
          expires_in: 7200,
        }),
      });

      // Mock update
      mockSupabaseClient._queryBuilder.single.mockResolvedValueOnce({
        data: { access_token: 'new-token' },
        error: null,
      });

      const token = await service.getAccessToken(testUserId);

      expect(token).toBe('new-token');
    });
  });

  describe('refreshAccessToken', () => {
    it('should refresh and update credentials', async () => {
      const service = new EbayAuthService(validConfig);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          expires_in: 7200,
        }),
      });

      mockSupabaseClient._queryBuilder.single.mockResolvedValueOnce({
        data: {
          access_token: 'new-access-token',
          refresh_token: 'refresh-token',
        },
        error: null,
      });

      const result = await service.refreshAccessToken(testUserId, 'refresh-token');

      expect(result).toBeTruthy();
      expect(result?.access_token).toBe('new-access-token');
    });

    it('should update refresh token when provided', async () => {
      const service = new EbayAuthService(validConfig);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 7200,
          refresh_token_expires_in: 47304000,
        }),
      });

      mockSupabaseClient._queryBuilder.single.mockResolvedValueOnce({
        data: { access_token: 'new-access-token' },
        error: null,
      });

      await service.refreshAccessToken(testUserId, 'old-refresh-token');

      // Verify update was called with refresh_token
      expect(mockSupabaseClient._queryBuilder.update).toHaveBeenCalled();
    });

    it('should disconnect user on 401 error', async () => {
      const service = new EbayAuthService(validConfig);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Invalid refresh token',
      });

      mockSupabaseClient._queryBuilder.delete.mockResolvedValueOnce({ error: null });

      const result = await service.refreshAccessToken(testUserId, 'invalid-refresh');

      expect(result).toBeNull();
      expect(mockSupabaseClient._queryBuilder.delete).toHaveBeenCalled();
    });

    it('should return null on network error', async () => {
      const service = new EbayAuthService(validConfig);

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await service.refreshAccessToken(testUserId, 'refresh-token');

      expect(result).toBeNull();
    });
  });

  describe('getConnectionStatus', () => {
    it('should return isConnected: false when no credentials', async () => {
      const service = new EbayAuthService(validConfig);

      mockSupabaseClient._queryBuilder.single.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST116' },
      });

      const status = await service.getConnectionStatus(testUserId);

      expect(status.isConnected).toBe(false);
    });

    it('should return connection details when connected', async () => {
      const service = new EbayAuthService(validConfig);
      const futureDate = new Date(Date.now() + 60 * 60 * 1000);
      const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

      mockSupabaseClient._queryBuilder.single.mockResolvedValueOnce({
        data: {
          ebay_user_id: 'ebay-seller-123',
          marketplace_id: 'EBAY_GB',
          access_token_expires_at: futureDate.toISOString(),
          refresh_token_expires_at: farFuture.toISOString(),
          scopes: ['scope1', 'scope2'],
        },
        error: null,
      });

      const status = await service.getConnectionStatus(testUserId);

      expect(status.isConnected).toBe(true);
      expect(status.ebayUsername).toBe('ebay-seller-123');
      expect(status.marketplaceId).toBe('EBAY_GB');
      expect(status.scopes).toEqual(['scope1', 'scope2']);
    });

    it('should indicate needsRefresh when token near expiry', async () => {
      const service = new EbayAuthService(validConfig);
      const nearExpiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
      const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

      mockSupabaseClient._queryBuilder.single.mockResolvedValueOnce({
        data: {
          access_token_expires_at: nearExpiry.toISOString(),
          refresh_token_expires_at: farFuture.toISOString(),
        },
        error: null,
      });

      const status = await service.getConnectionStatus(testUserId);

      expect(status.needsRefresh).toBe(true);
    });

    it('should disconnect when refresh token expired', async () => {
      const service = new EbayAuthService(validConfig);
      const pastDate = new Date(Date.now() - 60 * 60 * 1000);

      mockSupabaseClient._queryBuilder.single.mockResolvedValueOnce({
        data: {
          access_token_expires_at: pastDate.toISOString(),
          refresh_token_expires_at: pastDate.toISOString(), // Expired
        },
        error: null,
      });

      // Set the chain result for the delete operation
      mockSupabaseClient.setChainResult({ error: null });

      const status = await service.getConnectionStatus(testUserId);

      expect(status.isConnected).toBe(false);
      expect(mockSupabaseClient._queryBuilder.delete).toHaveBeenCalled();
    });
  });

  describe('isConnected', () => {
    it('should return true when connected', async () => {
      const service = new EbayAuthService(validConfig);
      const futureDate = new Date(Date.now() + 60 * 60 * 1000);
      const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

      mockSupabaseClient._queryBuilder.single.mockResolvedValueOnce({
        data: {
          access_token_expires_at: futureDate.toISOString(),
          refresh_token_expires_at: farFuture.toISOString(),
        },
        error: null,
      });

      const connected = await service.isConnected(testUserId);

      expect(connected).toBe(true);
    });

    it('should return false when not connected', async () => {
      const service = new EbayAuthService(validConfig);

      mockSupabaseClient._queryBuilder.single.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST116' },
      });

      const connected = await service.isConnected(testUserId);

      expect(connected).toBe(false);
    });
  });

  describe('hasListingManagementScopes', () => {
    it('should return hasScopes: true when all scopes present', async () => {
      const service = new EbayAuthService(validConfig);

      mockSupabaseClient._queryBuilder.single.mockResolvedValueOnce({
        data: {
          scopes: [
            'https://api.ebay.com/oauth/api_scope/sell.inventory',
            'https://api.ebay.com/oauth/api_scope/sell.account',
            'https://api.ebay.com/oauth/api_scope/sell.analytics.readonly',
          ],
        },
        error: null,
      });

      const result = await service.hasListingManagementScopes(testUserId);

      expect(result.hasScopes).toBe(true);
      expect(result.missingScopes).toHaveLength(0);
    });

    it('should return missing scopes when not all present', async () => {
      const service = new EbayAuthService(validConfig);

      mockSupabaseClient._queryBuilder.single.mockResolvedValueOnce({
        data: {
          scopes: ['https://api.ebay.com/oauth/api_scope/sell.inventory'],
        },
        error: null,
      });

      const result = await service.hasListingManagementScopes(testUserId);

      expect(result.hasScopes).toBe(false);
      expect(result.missingScopes.length).toBeGreaterThan(0);
    });

    it('should return all required scopes as missing when no credentials', async () => {
      const service = new EbayAuthService(validConfig);

      mockSupabaseClient._queryBuilder.single.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST116' },
      });

      const result = await service.hasListingManagementScopes(testUserId);

      expect(result.hasScopes).toBe(false);
      expect(result.currentScopes).toHaveLength(0);
    });
  });

  describe('hasAnalyticsScope', () => {
    it('should return true when analytics scope present', async () => {
      const service = new EbayAuthService(validConfig);

      mockSupabaseClient._queryBuilder.single.mockResolvedValueOnce({
        data: {
          scopes: ['https://api.ebay.com/oauth/api_scope/sell.analytics.readonly'],
        },
        error: null,
      });

      const result = await service.hasAnalyticsScope(testUserId);

      expect(result).toBe(true);
    });

    it('should return false when analytics scope missing', async () => {
      const service = new EbayAuthService(validConfig);

      mockSupabaseClient._queryBuilder.single.mockResolvedValueOnce({
        data: {
          scopes: ['https://api.ebay.com/oauth/api_scope/sell.inventory'],
        },
        error: null,
      });

      const result = await service.hasAnalyticsScope(testUserId);

      expect(result).toBe(false);
    });

    it('should return false when no credentials', async () => {
      const service = new EbayAuthService(validConfig);

      mockSupabaseClient._queryBuilder.single.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST116' },
      });

      const result = await service.hasAnalyticsScope(testUserId);

      expect(result).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('should delete credentials from database', async () => {
      const service = new EbayAuthService(validConfig);

      // Set the chain result for the delete operation
      mockSupabaseClient.setChainResult({ error: null });

      await service.disconnect(testUserId);

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('ebay_credentials');
      expect(mockSupabaseClient._queryBuilder.delete).toHaveBeenCalled();
      expect(mockSupabaseClient._queryBuilder.eq).toHaveBeenCalledWith('user_id', testUserId);
    });

    it('should throw error when delete fails', async () => {
      const service = new EbayAuthService(validConfig);

      // Set the chain result with an error
      mockSupabaseClient.setChainResult({
        error: { message: 'Database error' },
      });

      await expect(service.disconnect(testUserId)).rejects.toThrow(
        'Failed to disconnect eBay account'
      );
    });
  });

  describe('default export', () => {
    it('should export a default service instance', () => {
      expect(ebayAuthService).toBeInstanceOf(EbayAuthService);
    });
  });
});
