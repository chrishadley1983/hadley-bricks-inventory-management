/**
 * Monzo Auth Service
 *
 * Handles OAuth 2.0 Authorization Code Grant flow for Monzo API access.
 * Manages token storage and connection status.
 *
 * IMPORTANT: Monzo restricts transaction access after 5 minutes from OAuth.
 * Full history sync must happen immediately in the callback handler.
 */

import { createClient } from '@/lib/supabase/server';
import { encrypt, decrypt } from '@/lib/crypto';
import type {
  MonzoTokenResponse,
  MonzoAuthConfig,
  MonzoAuthState,
  MonzoConnectionStatus,
  MonzoApiAccount,
} from './types';

// ============================================================================
// Constants
// ============================================================================

const MONZO_AUTH_URL = 'https://auth.monzo.com';
const MONZO_API_URL = 'https://api.monzo.com';

// ============================================================================
// MonzoAuthService Class
// ============================================================================

export class MonzoAuthService {
  private config: MonzoAuthConfig;

  constructor(config?: Partial<MonzoAuthConfig>) {
    this.config = {
      clientId: config?.clientId || process.env.MONZO_CLIENT_ID || '',
      clientSecret: config?.clientSecret || process.env.MONZO_CLIENT_SECRET || '',
      redirectUri: config?.redirectUri || process.env.MONZO_REDIRECT_URI || '',
    };

    if (!this.config.clientId || !this.config.clientSecret || !this.config.redirectUri) {
      console.warn('[MonzoAuthService] Missing Monzo OAuth configuration');
    }
  }

  // ============================================================================
  // OAuth Flow Methods
  // ============================================================================

  /**
   * Generate the Monzo OAuth authorization URL
   * @param userId The user ID to associate with the connection
   * @param returnUrl Optional URL to return to after OAuth
   */
  getAuthorizationUrl(userId: string, returnUrl?: string): string {
    const state = this.encodeState({ userId, returnUrl });

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      state,
    });

    return `${MONZO_AUTH_URL}/?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens and store credentials
   * @param code The authorization code from Monzo callback
   * @param state The state parameter from the callback
   * @returns Object with success status, error message, return URL, and whether full sync is needed
   */
  async handleCallback(
    code: string,
    state: string
  ): Promise<{
    success: boolean;
    error?: string;
    returnUrl?: string;
    requiresFullSync: boolean;
  }> {
    try {
      // Decode and validate state
      const stateData = this.decodeState(state);
      if (!stateData?.userId) {
        return { success: false, error: 'Invalid state parameter', requiresFullSync: false };
      }

      // Exchange code for tokens
      const tokens = await this.exchangeCodeForTokens(code);

      // Immediately fetch account ID (required for transactions)
      const accounts = await this.fetchAccounts(tokens.access_token);
      const primaryAccount = accounts.find(
        (a) => a.type === 'uk_retail' || a.type === 'uk_retail_joint'
      );

      if (!primaryAccount) {
        return {
          success: false,
          error: 'No personal account found. Please ensure you have a personal Monzo account.',
          requiresFullSync: false,
        };
      }

      // Check if this is a new connection or reconnection
      const existingCredentials = await this.getCredentials(stateData.userId);
      const isNewConnection = !existingCredentials;

      // Store credentials
      await this.storeCredentials(stateData.userId, tokens, primaryAccount);

      return {
        success: true,
        returnUrl: stateData.returnUrl,
        requiresFullSync: isNewConnection,
      };
    } catch (error) {
      console.error('[MonzoAuthService] Callback error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to complete Monzo connection',
        requiresFullSync: false,
      };
    }
  }

  /**
   * Exchange authorization code for tokens
   */
  private async exchangeCodeForTokens(code: string): Promise<MonzoTokenResponse> {
    const response = await fetch(`${MONZO_API_URL}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
        code,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[MonzoAuthService] Token exchange failed:', errorText);
      throw new Error(`Token exchange failed: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Fetch user's Monzo accounts
   */
  private async fetchAccounts(accessToken: string): Promise<MonzoApiAccount[]> {
    const response = await fetch(`${MONZO_API_URL}/accounts`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[MonzoAuthService] Failed to fetch accounts:', errorText);
      throw new Error(`Failed to fetch accounts: ${response.status}`);
    }

    const data = await response.json();
    return data.accounts || [];
  }

  // ============================================================================
  // Token Management
  // ============================================================================

  /**
   * Get a valid access token for a user
   * Note: Monzo tokens cannot be refreshed - user must re-authenticate when expired
   */
  async getAccessToken(userId: string): Promise<string | null> {
    const credentials = await this.getCredentials(userId);
    if (!credentials) {
      return null;
    }

    // Check if token is expired
    const expiresAt = new Date(credentials.access_token_expires_at);
    const now = new Date();

    if (expiresAt < now) {
      console.warn('[MonzoAuthService] Access token expired for user:', userId);
      return null;
    }

    return credentials.access_token;
  }

  /**
   * Get the account ID for API calls
   */
  async getAccountId(userId: string): Promise<string | null> {
    const credentials = await this.getCredentials(userId);
    return credentials?.account_id || null;
  }

  // ============================================================================
  // Connection Status
  // ============================================================================

  /**
   * Get the connection status for a user
   */
  async getConnectionStatus(userId: string): Promise<MonzoConnectionStatus> {
    const credentials = await this.getCredentials(userId);

    if (!credentials) {
      return { isConnected: false };
    }

    const expiresAt = new Date(credentials.access_token_expires_at);
    const now = new Date();

    // If token is expired, connection is dead (Monzo has no refresh tokens for personal API)
    if (expiresAt < now) {
      return {
        isConnected: false,
        monzoUserId: credentials.monzo_user_id || undefined,
        accountId: credentials.account_id,
        accountType: credentials.account_type || undefined,
      };
    }

    // Get last sync info
    const supabase = await createClient();
    const { data: lastSync } = await supabase
      .from('monzo_sync_log')
      .select('completed_at, transactions_processed')
      .eq('user_id', userId)
      .eq('status', 'COMPLETED')
      .order('completed_at', { ascending: false })
      .limit(1)
      .single();

    // Get transaction count
    const { count: transactionCount } = await supabase
      .from('monzo_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    return {
      isConnected: true,
      monzoUserId: credentials.monzo_user_id || undefined,
      accountId: credentials.account_id,
      accountType: credentials.account_type || undefined,
      expiresAt,
      lastSyncAt: lastSync?.completed_at ? new Date(lastSync.completed_at) : undefined,
      transactionCount: transactionCount || 0,
    };
  }

  /**
   * Check if a user is connected to Monzo
   */
  async isConnected(userId: string): Promise<boolean> {
    const status = await this.getConnectionStatus(userId);
    return status.isConnected;
  }

  // ============================================================================
  // Manual Token Entry (for Playground tokens)
  // ============================================================================

  /**
   * Store credentials from a manually entered access token (Playground token)
   * This is useful when OAuth client creation is not available.
   *
   * @param userId The user ID to associate with the connection
   * @param accessToken The access token from Monzo Playground
   * @returns Object with success status and error message if failed
   */
  async storeManualToken(
    userId: string,
    accessToken: string
  ): Promise<{
    success: boolean;
    error?: string;
    requiresFullSync: boolean;
  }> {
    try {
      // Verify the token works by fetching accounts
      const accounts = await this.fetchAccounts(accessToken);
      const primaryAccount = accounts.find(
        (a) => a.type === 'uk_retail' || a.type === 'uk_retail_joint'
      );

      if (!primaryAccount) {
        return {
          success: false,
          error: 'No personal account found. Please ensure you have a personal Monzo account.',
          requiresFullSync: false,
        };
      }

      // Get user ID from whoami endpoint
      const whoamiResponse = await fetch(`${MONZO_API_URL}/ping/whoami`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!whoamiResponse.ok) {
        return {
          success: false,
          error: 'Invalid access token. Please check the token and try again.',
          requiresFullSync: false,
        };
      }

      const whoami = await whoamiResponse.json();

      // Check if this is a new connection
      const existingCredentials = await this.getCredentials(userId);
      const isNewConnection = !existingCredentials;

      // Playground tokens typically last 24 hours
      // Set expiry to 24 hours from now (conservative estimate)
      const supabase = await createClient();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      // Encrypt the access token before storing
      const encryptedAccessToken = await encrypt(accessToken);

      const credentialsData = {
        user_id: userId,
        monzo_user_id: whoami.user_id,
        access_token: encryptedAccessToken,
        refresh_token: null,
        access_token_expires_at: expiresAt.toISOString(),
        account_id: primaryAccount.id,
        account_type: primaryAccount.type,
      };

      // Upsert to handle reconnection
      const { error } = await supabase
        .from('monzo_credentials')
        .upsert(credentialsData, { onConflict: 'user_id' });

      if (error) {
        console.error('[MonzoAuthService] Failed to store manual token:', error);
        return {
          success: false,
          error: 'Failed to store credentials',
          requiresFullSync: false,
        };
      }

      return {
        success: true,
        requiresFullSync: isNewConnection,
      };
    } catch (error) {
      console.error('[MonzoAuthService] Manual token storage error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to verify token',
        requiresFullSync: false,
      };
    }
  }

  // ============================================================================
  // Disconnect
  // ============================================================================

  /**
   * Disconnect Monzo by removing stored credentials
   * Optionally also logs out from Monzo API
   */
  async disconnect(userId: string): Promise<void> {
    const credentials = await this.getCredentials(userId);

    // Try to logout from Monzo (invalidate token)
    if (credentials?.access_token) {
      try {
        await fetch(`${MONZO_API_URL}/oauth2/logout`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${credentials.access_token}`,
          },
        });
      } catch (error) {
        // Ignore logout errors - continue with local cleanup
        console.warn('[MonzoAuthService] Failed to logout from Monzo API:', error);
      }
    }

    // Remove credentials from database
    const supabase = await createClient();
    const { error } = await supabase.from('monzo_credentials').delete().eq('user_id', userId);

    if (error) {
      console.error('[MonzoAuthService] Failed to disconnect:', error);
      throw new Error('Failed to disconnect Monzo account');
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Get stored credentials for a user (decrypts sensitive fields)
   */
  private async getCredentials(userId: string) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('monzo_credentials')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code !== 'PGRST116') {
        // Not a "not found" error
        console.error('[MonzoAuthService] Failed to get credentials:', error);
      }
      return null;
    }

    // Decrypt sensitive fields
    try {
      const decryptedAccessToken = await decrypt(data.access_token);
      const decryptedRefreshToken = data.refresh_token
        ? await decrypt(data.refresh_token)
        : null;

      return {
        ...data,
        access_token: decryptedAccessToken,
        refresh_token: decryptedRefreshToken,
      };
    } catch (decryptError) {
      console.error('[MonzoAuthService] Failed to decrypt credentials:', decryptError);
      return null;
    }
  }

  /**
   * Store new credentials for a user (encrypts sensitive fields)
   */
  private async storeCredentials(
    userId: string,
    tokens: MonzoTokenResponse,
    account: MonzoApiAccount
  ): Promise<void> {
    const supabase = await createClient();
    const now = new Date();

    // Encrypt sensitive tokens before storing
    const encryptedAccessToken = await encrypt(tokens.access_token);
    const encryptedRefreshToken = tokens.refresh_token
      ? await encrypt(tokens.refresh_token)
      : null;

    const credentialsData = {
      user_id: userId,
      monzo_user_id: tokens.user_id,
      access_token: encryptedAccessToken,
      refresh_token: encryptedRefreshToken,
      access_token_expires_at: new Date(now.getTime() + tokens.expires_in * 1000).toISOString(),
      account_id: account.id,
      account_type: account.type,
    };

    // Upsert to handle reconnection
    const { error } = await supabase
      .from('monzo_credentials')
      .upsert(credentialsData, { onConflict: 'user_id' });

    if (error) {
      console.error('[MonzoAuthService] Failed to store credentials:', error);
      throw new Error('Failed to store Monzo credentials');
    }
  }

  /**
   * Encode state for OAuth flow
   */
  private encodeState(state: MonzoAuthState): string {
    return Buffer.from(JSON.stringify(state)).toString('base64url');
  }

  /**
   * Decode state from OAuth flow
   */
  private decodeState(state: string): MonzoAuthState | null {
    try {
      return JSON.parse(Buffer.from(state, 'base64url').toString());
    } catch {
      return null;
    }
  }
}

// Export a default instance
export const monzoAuthService = new MonzoAuthService();
