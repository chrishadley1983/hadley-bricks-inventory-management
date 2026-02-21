/**
 * Google Calendar Auth Service
 *
 * Handles OAuth 2.0 Authorization Code Grant flow for Google Calendar API access.
 * Manages token storage, refresh, and connection status.
 */

import { createClient } from '@/lib/supabase/server';
import { encrypt, decrypt } from '@/lib/crypto';
import type {
  GoogleCalendarConnectionStatus,
  GoogleCalendarOAuthState,
  GoogleTokenResponse,
  GoogleUserInfo,
} from './types';

// ============================================================================
// Constants
// ============================================================================

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

/** Scopes required for calendar event management */
const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
];

/** Buffer time before token expiry to trigger refresh (10 minutes) */
const TOKEN_EXPIRY_BUFFER_MS = 10 * 60 * 1000;

// ============================================================================
// GoogleCalendarAuthService Class
// ============================================================================

export interface GoogleCalendarAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export class GoogleCalendarAuthService {
  private config: GoogleCalendarAuthConfig;

  constructor(config?: Partial<GoogleCalendarAuthConfig>) {
    this.config = {
      clientId: config?.clientId || process.env.GOOGLE_CALENDAR_CLIENT_ID || '',
      clientSecret: config?.clientSecret || process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '',
      redirectUri: config?.redirectUri || process.env.GOOGLE_CALENDAR_REDIRECT_URI || '',
    };

    if (!this.config.clientId || !this.config.clientSecret || !this.config.redirectUri) {
      console.warn('[GoogleCalendarAuthService] Missing Google Calendar OAuth configuration');
    }
  }

  // ============================================================================
  // OAuth Flow Methods
  // ============================================================================

  /**
   * Generate the Google OAuth authorization URL
   * @param userId The user ID to associate with the connection
   * @param returnUrl Optional URL to return to after OAuth
   */
  getAuthorizationUrl(userId: string, returnUrl?: string): string {
    const state = this.encodeState({ userId, returnUrl, timestamp: Date.now() });

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: CALENDAR_SCOPES.join(' '),
      access_type: 'offline', // Request refresh token
      prompt: 'consent', // Force consent screen to get refresh token
      state,
    });

    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens and store credentials
   * @param code The authorization code from Google callback
   * @param state The state parameter from the callback
   */
  async handleCallback(
    code: string,
    state: string
  ): Promise<{
    success: boolean;
    error?: string;
    returnUrl?: string;
  }> {
    try {
      // Decode and validate state
      const stateData = this.decodeState(state);
      if (!stateData?.userId) {
        return { success: false, error: 'Invalid state parameter' };
      }

      // Validate timestamp (state should be recent - within 10 minutes)
      const stateAge = Date.now() - stateData.timestamp;
      if (stateAge > 10 * 60 * 1000) {
        return { success: false, error: 'Authorization request expired. Please try again.' };
      }

      // Exchange code for tokens
      const tokens = await this.exchangeCodeForTokens(code);

      // Fetch user info to get email
      const userInfo = await this.fetchUserInfo(tokens.access_token);

      // Store credentials
      await this.storeCredentials(stateData.userId, tokens, userInfo);

      return {
        success: true,
        returnUrl: stateData.returnUrl,
      };
    } catch (error) {
      console.error('[GoogleCalendarAuthService] Callback error:', error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to complete Google Calendar connection',
      };
    }
  }

  /**
   * Exchange authorization code for tokens
   */
  private async exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
    const response = await fetch(GOOGLE_TOKEN_URL, {
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
      console.error('[GoogleCalendarAuthService] Token exchange failed:', errorText);
      throw new Error(`Token exchange failed: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Refresh an expired access token
   */
  private async refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[GoogleCalendarAuthService] Token refresh failed:', errorText);
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Fetch user info from Google
   */
  private async fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
    const response = await fetch(GOOGLE_USERINFO_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[GoogleCalendarAuthService] Failed to fetch user info:', errorText);
      throw new Error(`Failed to fetch user info: ${response.status}`);
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

    const expiresAt = new Date(credentials.access_token_expires_at);
    const now = new Date();

    // Check if token is expired or about to expire
    if (expiresAt.getTime() - now.getTime() < TOKEN_EXPIRY_BUFFER_MS) {
      // Need to refresh
      if (!credentials.refresh_token) {
        console.warn('[GoogleCalendarAuthService] No refresh token available for user:', userId);
        return null;
      }

      try {
        const newTokens = await this.refreshAccessToken(credentials.refresh_token);
        await this.updateAccessToken(userId, newTokens);
        return newTokens.access_token;
      } catch (error) {
        console.error('[GoogleCalendarAuthService] Failed to refresh token:', error);
        return null;
      }
    }

    return credentials.access_token;
  }

  // ============================================================================
  // Connection Status
  // ============================================================================

  /**
   * Get the connection status for a user
   */
  async getConnectionStatus(userId: string): Promise<GoogleCalendarConnectionStatus> {
    const credentials = await this.getCredentials(userId);

    if (!credentials) {
      return { isConnected: false };
    }

    const expiresAt = new Date(credentials.access_token_expires_at);

    // If we have a refresh token, we can always get a new access token
    // Only consider disconnected if no refresh token AND access token expired
    if (!credentials.refresh_token && expiresAt < new Date()) {
      return {
        isConnected: false,
        email: credentials.email || undefined,
      };
    }

    return {
      isConnected: true,
      email: credentials.email || undefined,
      expiresAt,
    };
  }

  /**
   * Check if a user is connected to Google Calendar
   */
  async isConnected(userId: string): Promise<boolean> {
    const status = await this.getConnectionStatus(userId);
    return status.isConnected;
  }

  // ============================================================================
  // Disconnect
  // ============================================================================

  /**
   * Disconnect Google Calendar by removing stored credentials
   */
  async disconnect(userId: string): Promise<void> {
    const credentials = await this.getCredentials(userId);

    // Try to revoke the token with Google
    if (credentials?.access_token) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${credentials.access_token}`, {
          method: 'POST',
        });
      } catch (error) {
        // Ignore revocation errors - continue with local cleanup
        console.warn('[GoogleCalendarAuthService] Failed to revoke token with Google:', error);
      }
    }

    // Remove credentials from database
    const supabase = await createClient();
    const { error } = await supabase
      .from('google_calendar_credentials')
      .delete()
      .eq('user_id', userId);

    if (error) {
      console.error('[GoogleCalendarAuthService] Failed to disconnect:', error);
      throw new Error('Failed to disconnect Google Calendar');
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
      .from('google_calendar_credentials')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code !== 'PGRST116') {
        // Not a "not found" error
        console.error('[GoogleCalendarAuthService] Failed to get credentials:', error);
      }
      return null;
    }

    // Decrypt sensitive fields
    try {
      const decryptedAccessToken = await decrypt(data.access_token);
      const decryptedRefreshToken = data.refresh_token ? await decrypt(data.refresh_token) : null;

      return {
        ...data,
        access_token: decryptedAccessToken,
        refresh_token: decryptedRefreshToken,
      };
    } catch (decryptError) {
      console.error('[GoogleCalendarAuthService] Failed to decrypt credentials:', decryptError);
      return null;
    }
  }

  /**
   * Store new credentials for a user (encrypts sensitive fields)
   */
  private async storeCredentials(
    userId: string,
    tokens: GoogleTokenResponse,
    userInfo: GoogleUserInfo
  ): Promise<void> {
    const supabase = await createClient();
    const now = new Date();

    // Encrypt sensitive tokens before storing
    const encryptedAccessToken = await encrypt(tokens.access_token);

    // Refresh token is required for the integration to work
    // Google should always provide one with access_type: 'offline' and prompt: 'consent'
    if (!tokens.refresh_token) {
      throw new Error(
        'No refresh token received from Google. Please disconnect and reconnect your Google Calendar.'
      );
    }
    const encryptedRefreshToken = await encrypt(tokens.refresh_token);

    const credentialsData = {
      user_id: userId,
      google_user_id: userInfo.id,
      email: userInfo.email,
      access_token: encryptedAccessToken,
      refresh_token: encryptedRefreshToken,
      access_token_expires_at: new Date(now.getTime() + tokens.expires_in * 1000).toISOString(),
      scopes: tokens.scope.split(' '),
    };

    // Upsert to handle reconnection
    const { error } = await supabase
      .from('google_calendar_credentials')
      .upsert(credentialsData, { onConflict: 'user_id' });

    if (error) {
      console.error('[GoogleCalendarAuthService] Failed to store credentials:', error);
      throw new Error('Failed to store Google Calendar credentials');
    }
  }

  /**
   * Update access token after refresh
   */
  private async updateAccessToken(userId: string, tokens: GoogleTokenResponse): Promise<void> {
    const supabase = await createClient();
    const now = new Date();

    const encryptedAccessToken = await encrypt(tokens.access_token);

    const updateData: Record<string, unknown> = {
      access_token: encryptedAccessToken,
      access_token_expires_at: new Date(now.getTime() + tokens.expires_in * 1000).toISOString(),
      updated_at: now.toISOString(),
    };

    // If a new refresh token was provided, update it
    if (tokens.refresh_token) {
      updateData.refresh_token = await encrypt(tokens.refresh_token);
    }

    const { error } = await supabase
      .from('google_calendar_credentials')
      .update(updateData)
      .eq('user_id', userId);

    if (error) {
      console.error('[GoogleCalendarAuthService] Failed to update access token:', error);
      throw new Error('Failed to update access token');
    }
  }

  /**
   * Encode state for OAuth flow
   */
  private encodeState(state: GoogleCalendarOAuthState): string {
    return Buffer.from(JSON.stringify(state)).toString('base64url');
  }

  /**
   * Decode state from OAuth flow
   */
  private decodeState(state: string): GoogleCalendarOAuthState | null {
    try {
      return JSON.parse(Buffer.from(state, 'base64url').toString());
    } catch {
      return null;
    }
  }
}

// Export a default instance
export const googleCalendarAuthService = new GoogleCalendarAuthService();
