/**
 * eBay Auth Service
 *
 * Handles OAuth 2.0 Authorization Code Grant flow for eBay API access.
 * Manages token storage, refresh, and connection status.
 */

import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EbayTokenResponse } from './types';
import type {
  EbayCredentials,
  EbayCredentialsUpdate,
  EbayCredentialsInsert,
  EbayMarketplaceId,
} from '@hadley-bricks/database';

// ============================================================================
// Constants
// ============================================================================

const EBAY_AUTH_URL = 'https://auth.ebay.com/oauth2/authorize';
const EBAY_SANDBOX_AUTH_URL = 'https://auth.sandbox.ebay.com/oauth2/authorize';
const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_SANDBOX_TOKEN_URL = 'https://api.sandbox.ebay.com/identity/v1/oauth2/token';

// Token refresh buffer - refresh 10 minutes before expiry
const TOKEN_REFRESH_BUFFER_MS = 10 * 60 * 1000;

// ============================================================================
// Types
// ============================================================================

export interface EbayAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  sandbox?: boolean;
}

export interface EbayConnectionStatus {
  isConnected: boolean;
  ebayUsername?: string;
  marketplaceId?: string;
  expiresAt?: Date;
  scopes?: string[];
  needsRefresh?: boolean;
}

interface EbayAuthState {
  userId: string;
  returnUrl?: string;
  marketplaceId?: EbayMarketplaceId;
}

// ============================================================================
// Required OAuth Scopes
// ============================================================================

/**
 * Base scopes required for order sync and finances
 */
const BASE_SCOPES = [
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.finances',
];

/**
 * Additional scopes required for listing management (end/create listings)
 */
const LISTING_MANAGEMENT_SCOPES = [
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account',
];

/**
 * Scope required for analytics/traffic data (views)
 */
const ANALYTICS_SCOPES = ['https://api.ebay.com/oauth/api_scope/sell.analytics.readonly'];

/**
 * All required scopes for full functionality
 */
const REQUIRED_SCOPES = [...BASE_SCOPES, ...LISTING_MANAGEMENT_SCOPES, ...ANALYTICS_SCOPES];

// ============================================================================
// EbayAuthService Class
// ============================================================================

export class EbayAuthService {
  private config: EbayAuthConfig;
  private injectedSupabase: SupabaseClient | null = null;

  /**
   * Create a new EbayAuthService
   * @param config Optional OAuth configuration overrides
   * @param supabase Optional Supabase client (for cron/background jobs that need service role access)
   */
  constructor(config?: Partial<EbayAuthConfig>, supabase?: SupabaseClient) {
    this.injectedSupabase = supabase || null;
    this.config = {
      clientId: config?.clientId || process.env.EBAY_CLIENT_ID || '',
      clientSecret: config?.clientSecret || process.env.EBAY_CLIENT_SECRET || '',
      redirectUri: config?.redirectUri || process.env.EBAY_REDIRECT_URI || '',
      sandbox: config?.sandbox ?? process.env.EBAY_SANDBOX === 'true',
    };

    if (!this.config.clientId || !this.config.clientSecret || !this.config.redirectUri) {
      console.warn('[EbayAuthService] Missing eBay OAuth configuration');
    }
  }

  /**
   * Get the Supabase client - uses injected client if available, otherwise creates cookie-based client
   */
  private async getSupabase(): Promise<SupabaseClient> {
    if (this.injectedSupabase) {
      return this.injectedSupabase;
    }
    return createClient();
  }

  // ============================================================================
  // OAuth Flow Methods
  // ============================================================================

  /**
   * Generate the eBay OAuth authorization URL
   * @param userId The user ID to associate with the connection
   * @param returnUrl Optional URL to return to after OAuth
   * @param marketplaceId The eBay marketplace to connect to
   */
  getAuthorizationUrl(
    userId: string,
    returnUrl?: string,
    marketplaceId: EbayMarketplaceId = 'EBAY_GB'
  ): string {
    const state = this.encodeState({ userId, returnUrl, marketplaceId });
    const baseUrl = this.config.sandbox ? EBAY_SANDBOX_AUTH_URL : EBAY_AUTH_URL;

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: this.config.redirectUri,
      scope: REQUIRED_SCOPES.join(' '),
      state,
    });

    return `${baseUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens and store credentials
   * @param code The authorization code from eBay callback
   * @param state The state parameter from the callback
   */
  async handleCallback(
    code: string,
    state: string
  ): Promise<{ success: boolean; error?: string; returnUrl?: string }> {
    try {
      // Decode and validate state
      const stateData = this.decodeState(state);
      if (!stateData?.userId) {
        return { success: false, error: 'Invalid state parameter' };
      }

      // Exchange code for tokens
      const tokens = await this.exchangeCodeForTokens(code);

      // Store credentials
      await this.storeCredentials(stateData.userId, tokens, stateData.marketplaceId || 'EBAY_GB');

      return { success: true, returnUrl: stateData.returnUrl };
    } catch (error) {
      console.error('[EbayAuthService] Callback error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to complete eBay connection',
      };
    }
  }

  /**
   * Exchange authorization code for tokens
   */
  private async exchangeCodeForTokens(code: string): Promise<EbayTokenResponse> {
    const tokenUrl = this.config.sandbox ? EBAY_SANDBOX_TOKEN_URL : EBAY_TOKEN_URL;

    const credentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString(
      'base64'
    );

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.config.redirectUri,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[EbayAuthService] Token exchange failed:', errorText);
      throw new Error(`Token exchange failed: ${response.status}`);
    }

    return response.json();
  }

  // ============================================================================
  // Token Management
  // ============================================================================

  /**
   * Get a valid access token for a user, refreshing if necessary
   */
  async getAccessToken(userId: string): Promise<string | null> {
    const credentials = await this.getCredentials(userId);
    if (!credentials) {
      return null;
    }

    // Check if token needs refresh
    const expiresAt = new Date(credentials.access_token_expires_at);
    const now = new Date();

    if (expiresAt.getTime() - now.getTime() < TOKEN_REFRESH_BUFFER_MS) {
      // Token expired or about to expire, refresh it
      const refreshed = await this.refreshAccessToken(userId, credentials.refresh_token);
      return refreshed ? refreshed.access_token : null;
    }

    return credentials.access_token;
  }

  /**
   * Refresh the access token using the refresh token
   */
  async refreshAccessToken(userId: string, refreshToken: string): Promise<EbayCredentials | null> {
    try {
      const tokenUrl = this.config.sandbox ? EBAY_SANDBOX_TOKEN_URL : EBAY_TOKEN_URL;

      const credentials = Buffer.from(
        `${this.config.clientId}:${this.config.clientSecret}`
      ).toString('base64');

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${credentials}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[EbayAuthService] Token refresh failed:', errorText);

        // If refresh token is invalid, disconnect the user
        if (response.status === 400 || response.status === 401) {
          await this.disconnect(userId);
        }

        return null;
      }

      const tokens: EbayTokenResponse = await response.json();

      // Update stored credentials
      const supabase = await this.getSupabase();
      const now = new Date();

      const updateData: EbayCredentialsUpdate = {
        access_token: tokens.access_token,
        access_token_expires_at: new Date(now.getTime() + tokens.expires_in * 1000).toISOString(),
      };

      // Update refresh token if a new one was provided
      if (tokens.refresh_token) {
        updateData.refresh_token = tokens.refresh_token;
        if (tokens.refresh_token_expires_in) {
          updateData.refresh_token_expires_at = new Date(
            now.getTime() + tokens.refresh_token_expires_in * 1000
          ).toISOString();
        }
      }

      // Note: Type assertion needed until migration is pushed and types regenerated
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('ebay_credentials')
        .update(updateData)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        console.error('[EbayAuthService] Failed to update credentials:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('[EbayAuthService] Token refresh error:', error);
      return null;
    }
  }

  // ============================================================================
  // Connection Status
  // ============================================================================

  /**
   * Get the connection status for a user
   */
  async getConnectionStatus(userId: string): Promise<EbayConnectionStatus> {
    const credentials = await this.getCredentials(userId);

    if (!credentials) {
      return { isConnected: false };
    }

    const expiresAt = new Date(credentials.access_token_expires_at);
    const refreshExpiresAt = new Date(credentials.refresh_token_expires_at);
    const now = new Date();

    // Check if refresh token is expired (connection is truly dead)
    if (refreshExpiresAt < now) {
      // Clean up expired credentials
      await this.disconnect(userId);
      return { isConnected: false };
    }

    return {
      isConnected: true,
      ebayUsername: credentials.ebay_user_id || undefined,
      marketplaceId: credentials.marketplace_id,
      expiresAt,
      scopes: credentials.scopes,
      needsRefresh: expiresAt.getTime() - now.getTime() < TOKEN_REFRESH_BUFFER_MS,
    };
  }

  /**
   * Check if a user is connected to eBay
   */
  async isConnected(userId: string): Promise<boolean> {
    const status = await this.getConnectionStatus(userId);
    return status.isConnected;
  }

  // ============================================================================
  // Scope Validation
  // ============================================================================

  /**
   * Check if user has the required scopes for listing management
   * @param userId The user ID to check
   * @returns Object with hasScopes boolean and array of missing scopes
   */
  async hasListingManagementScopes(userId: string): Promise<{
    hasScopes: boolean;
    missingScopes: string[];
    currentScopes: string[];
  }> {
    const credentials = await this.getCredentials(userId);

    // Listing refresh needs both listing management AND analytics scopes
    const requiredForRefresh = [...LISTING_MANAGEMENT_SCOPES, ...ANALYTICS_SCOPES];

    if (!credentials) {
      return {
        hasScopes: false,
        missingScopes: requiredForRefresh,
        currentScopes: [],
      };
    }

    const currentScopes = credentials.scopes || [];
    const currentScopeSet = new Set(currentScopes);
    const missingScopes = requiredForRefresh.filter((scope) => !currentScopeSet.has(scope));

    return {
      hasScopes: missingScopes.length === 0,
      missingScopes,
      currentScopes,
    };
  }

  /**
   * Check if user has analytics scope for views data
   * @param userId The user ID to check
   * @returns Object with hasScope boolean
   */
  async hasAnalyticsScope(userId: string): Promise<boolean> {
    const credentials = await this.getCredentials(userId);
    if (!credentials) return false;

    const currentScopes = credentials.scopes || [];
    const currentScopeSet = new Set(currentScopes);

    return ANALYTICS_SCOPES.every((scope) => currentScopeSet.has(scope));
  }

  /**
   * Check if user has all required scopes (base + listing management)
   * @param userId The user ID to check
   * @returns Object with hasScopes boolean and array of missing scopes
   */
  async hasAllRequiredScopes(userId: string): Promise<{
    hasScopes: boolean;
    missingScopes: string[];
    currentScopes: string[];
  }> {
    const credentials = await this.getCredentials(userId);

    if (!credentials) {
      return {
        hasScopes: false,
        missingScopes: REQUIRED_SCOPES,
        currentScopes: [],
      };
    }

    const currentScopes = credentials.scopes || [];
    const currentScopeSet = new Set(currentScopes);
    const missingScopes = REQUIRED_SCOPES.filter((scope) => !currentScopeSet.has(scope));

    return {
      hasScopes: missingScopes.length === 0,
      missingScopes,
      currentScopes,
    };
  }

  // ============================================================================
  // Disconnect
  // ============================================================================

  /**
   * Disconnect eBay by removing stored credentials
   */
  async disconnect(userId: string): Promise<void> {
    const supabase = await this.getSupabase();

    // Note: Type assertion needed until migration is pushed and types regenerated
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('ebay_credentials')
      .delete()
      .eq('user_id', userId);

    if (error) {
      console.error('[EbayAuthService] Failed to disconnect:', error);
      throw new Error('Failed to disconnect eBay account');
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Get stored credentials for a user
   */
  private async getCredentials(userId: string): Promise<EbayCredentials | null> {
    const supabase = await this.getSupabase();

    // Note: Type assertion needed until migration is pushed and types regenerated
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('ebay_credentials')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code !== 'PGRST116') {
        // Not a "not found" error
        console.error('[EbayAuthService] Failed to get credentials:', error);
      }
      return null;
    }

    return data;
  }

  /**
   * Store new credentials for a user
   */
  private async storeCredentials(
    userId: string,
    tokens: EbayTokenResponse,
    marketplaceId: EbayMarketplaceId
  ): Promise<void> {
    const supabase = await this.getSupabase();
    const now = new Date();

    const credentialsData: EbayCredentialsInsert = {
      user_id: userId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token!,
      access_token_expires_at: new Date(now.getTime() + tokens.expires_in * 1000).toISOString(),
      refresh_token_expires_at: new Date(
        now.getTime() + (tokens.refresh_token_expires_in || 18 * 30 * 24 * 60 * 60) * 1000
      ).toISOString(),
      scopes: REQUIRED_SCOPES,
      marketplace_id: marketplaceId,
    };

    // Upsert to handle reconnection
    // Note: Type assertion needed until migration is pushed and types regenerated
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('ebay_credentials')
      .upsert(credentialsData, { onConflict: 'user_id' });

    if (error) {
      console.error('[EbayAuthService] Failed to store credentials:', error);
      throw new Error('Failed to store eBay credentials');
    }
  }

  /**
   * Encode state for OAuth flow
   */
  private encodeState(state: EbayAuthState): string {
    return Buffer.from(JSON.stringify(state)).toString('base64url');
  }

  /**
   * Decode state from OAuth flow
   */
  private decodeState(state: string): EbayAuthState | null {
    try {
      return JSON.parse(Buffer.from(state, 'base64url').toString());
    } catch {
      return null;
    }
  }
}

// Export a default instance
export const ebayAuthService = new EbayAuthService();
