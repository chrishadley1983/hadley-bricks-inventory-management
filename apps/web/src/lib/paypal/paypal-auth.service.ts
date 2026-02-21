/**
 * PayPal Auth Service
 *
 * Handles OAuth 2.0 Client Credentials flow for PayPal API access.
 * Manages token storage, refresh, and connection status.
 */

import { createClient } from '@/lib/supabase/server';
import { encrypt, decrypt } from '@/lib/crypto';
import type {
  PayPalTokenResponse,
  PayPalCredentialsRow,
  PayPalConnectionStatus,
  PayPalSyncConfig,
  PayPalSyncLog,
} from './types';

// ============================================================================
// Constants
// ============================================================================

const PAYPAL_TOKEN_URL = 'https://api.paypal.com/v1/oauth2/token';
const PAYPAL_SANDBOX_TOKEN_URL = 'https://api.sandbox.paypal.com/v1/oauth2/token';

// Token refresh buffer - refresh 5 minutes before expiry
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

// Required scope for Transaction Search API
const REQUIRED_SCOPE = 'https://uri.paypal.com/services/reporting/search/read';

// ============================================================================
// Types
// ============================================================================

export interface PayPalCredentialsInput {
  clientId: string;
  clientSecret: string;
  sandbox?: boolean;
}

// ============================================================================
// PayPalAuthService Class
// ============================================================================

export class PayPalAuthService {
  // ============================================================================
  // Credentials Management
  // ============================================================================

  /**
   * Save PayPal API credentials for a user
   */
  async saveCredentials(
    userId: string,
    credentials: PayPalCredentialsInput
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const supabase = await createClient();

      // First, test the credentials by getting an access token
      const tokenResult = await this.getNewAccessToken(
        credentials.clientId,
        credentials.clientSecret,
        credentials.sandbox ?? false
      );

      if (!tokenResult.success || !tokenResult.token) {
        return { success: false, error: tokenResult.error || 'Failed to validate credentials' };
      }

      // Calculate token expiry
      const now = new Date();
      const expiresAt = new Date(now.getTime() + tokenResult.expiresIn * 1000);

      // Encrypt sensitive credentials before storing
      const encryptedClientSecret = await encrypt(credentials.clientSecret);
      const encryptedAccessToken = await encrypt(tokenResult.token);

      // Upsert credentials
      const { error } = await supabase.from('paypal_credentials').upsert(
        {
          user_id: userId,
          client_id: credentials.clientId,
          client_secret: encryptedClientSecret,
          access_token: encryptedAccessToken,
          access_token_expires_at: expiresAt.toISOString(),
          sandbox: credentials.sandbox ?? false,
        },
        { onConflict: 'user_id' }
      );

      if (error) {
        console.error('[PayPalAuthService] Failed to save credentials:', error);
        return { success: false, error: 'Failed to save credentials' };
      }

      return { success: true };
    } catch (error) {
      console.error('[PayPalAuthService] Error saving credentials:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save credentials',
      };
    }
  }

  /**
   * Get stored credentials for a user (decrypts sensitive fields)
   */
  async getCredentials(userId: string): Promise<PayPalCredentialsRow | null> {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('paypal_credentials')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code !== 'PGRST116') {
        // Not a "not found" error
        console.error('[PayPalAuthService] Failed to get credentials:', error);
      }
      return null;
    }

    // Decrypt sensitive fields
    try {
      const decryptedClientSecret = await decrypt(data.client_secret);
      const decryptedAccessToken = data.access_token ? await decrypt(data.access_token) : undefined;

      return {
        ...data,
        client_secret: decryptedClientSecret,
        access_token: decryptedAccessToken,
      } as PayPalCredentialsRow;
    } catch (decryptError) {
      console.error('[PayPalAuthService] Failed to decrypt credentials:', decryptError);
      return null;
    }
  }

  /**
   * Delete stored credentials for a user
   */
  async deleteCredentials(userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const supabase = await createClient();

      // Delete credentials
      const { error: credError } = await supabase
        .from('paypal_credentials')
        .delete()
        .eq('user_id', userId);

      if (credError) {
        console.error('[PayPalAuthService] Failed to delete credentials:', credError);
        return { success: false, error: 'Failed to delete credentials' };
      }

      // Also delete sync config
      await supabase.from('paypal_sync_config').delete().eq('user_id', userId);

      // Also delete transactions
      await supabase.from('paypal_transactions').delete().eq('user_id', userId);

      // Also delete sync logs
      await supabase.from('paypal_sync_log').delete().eq('user_id', userId);

      return { success: true };
    } catch (error) {
      console.error('[PayPalAuthService] Error deleting credentials:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete credentials',
      };
    }
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

    // Check if we have a valid token
    if (credentials.access_token && credentials.access_token_expires_at) {
      const expiresAt = new Date(credentials.access_token_expires_at);
      const now = new Date();

      // Return existing token if not expired
      if (expiresAt.getTime() - now.getTime() > TOKEN_REFRESH_BUFFER_MS) {
        return credentials.access_token;
      }
    }

    // Token expired or missing, get a new one
    const tokenResult = await this.getNewAccessToken(
      credentials.client_id,
      credentials.client_secret,
      credentials.sandbox
    );

    if (!tokenResult.success || !tokenResult.token) {
      console.error('[PayPalAuthService] Failed to get new access token');
      return null;
    }

    // Update stored token (encrypted)
    const supabase = await createClient();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + tokenResult.expiresIn * 1000);
    const encryptedToken = await encrypt(tokenResult.token);

    await supabase
      .from('paypal_credentials')
      .update({
        access_token: encryptedToken,
        access_token_expires_at: expiresAt.toISOString(),
      })
      .eq('user_id', userId);

    return tokenResult.token;
  }

  /**
   * Get a new access token using client credentials
   */
  private async getNewAccessToken(
    clientId: string,
    clientSecret: string,
    sandbox: boolean
  ): Promise<{ success: boolean; token?: string; expiresIn: number; error?: string }> {
    try {
      const tokenUrl = sandbox ? PAYPAL_SANDBOX_TOKEN_URL : PAYPAL_TOKEN_URL;

      // Create Basic auth header
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${credentials}`,
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[PayPalAuthService] Token request failed:', response.status, errorText);

        // Parse error for better message
        try {
          const errorJson = JSON.parse(errorText);
          return {
            success: false,
            expiresIn: 0,
            error: errorJson.error_description || errorJson.error || 'Authentication failed',
          };
        } catch {
          return {
            success: false,
            expiresIn: 0,
            error: `Authentication failed: ${response.status}`,
          };
        }
      }

      const data: PayPalTokenResponse = await response.json();

      // Validate scope includes what we need
      if (!data.scope.includes(REQUIRED_SCOPE)) {
        console.warn(
          '[PayPalAuthService] Token missing Transaction Search scope. Available scopes:',
          data.scope
        );
        return {
          success: false,
          expiresIn: 0,
          error:
            'Transaction Search permission not enabled. Please enable it in PayPal Developer Dashboard and wait up to 9 hours.',
        };
      }

      return {
        success: true,
        token: data.access_token,
        expiresIn: data.expires_in,
      };
    } catch (error) {
      console.error('[PayPalAuthService] Error getting access token:', error);
      return {
        success: false,
        expiresIn: 0,
        error: error instanceof Error ? error.message : 'Failed to get access token',
      };
    }
  }

  // ============================================================================
  // Connection Status
  // ============================================================================

  /**
   * Get the connection status for a user
   */
  async getConnectionStatus(userId: string): Promise<PayPalConnectionStatus> {
    const credentials = await this.getCredentials(userId);

    if (!credentials) {
      return { isConnected: false };
    }

    // Get transaction count
    const supabase = await createClient();
    const { count: transactionCount } = await supabase
      .from('paypal_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    // Get sync config
    const { data: syncConfigData } = await supabase
      .from('paypal_sync_config')
      .select('*')
      .eq('user_id', userId)
      .single();

    const syncConfig: PayPalSyncConfig | undefined = syncConfigData
      ? {
          autoSyncEnabled: syncConfigData.auto_sync_enabled,
          autoSyncIntervalHours: syncConfigData.auto_sync_interval_hours,
          lastAutoSyncAt: syncConfigData.last_auto_sync_at || undefined,
          nextAutoSyncAt: syncConfigData.next_auto_sync_at || undefined,
          lastSyncDateCursor: syncConfigData.last_sync_date_cursor || undefined,
          historicalImportStartedAt: syncConfigData.historical_import_started_at || undefined,
          historicalImportCompletedAt: syncConfigData.historical_import_completed_at || undefined,
          historicalImportFromDate: syncConfigData.historical_import_from_date || undefined,
        }
      : undefined;

    // Get recent sync logs
    const { data: logsData } = await supabase
      .from('paypal_sync_log')
      .select('*')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(5);

    const recentLogs: PayPalSyncLog[] = (logsData || []).map((log) => ({
      id: log.id,
      syncMode: log.sync_mode as PayPalSyncLog['syncMode'],
      status: log.status as PayPalSyncLog['status'],
      startedAt: log.started_at,
      completedAt: log.completed_at || undefined,
      transactionsProcessed: log.transactions_processed,
      transactionsCreated: log.transactions_created,
      transactionsUpdated: log.transactions_updated,
      transactionsSkipped: log.transactions_skipped,
      fromDate: log.from_date || undefined,
      toDate: log.to_date || undefined,
      lastSyncCursor: log.last_sync_cursor || undefined,
      errorMessage: log.error_message || undefined,
    }));

    // Get last sync time from most recent completed sync
    const lastCompletedSync = recentLogs.find((log) => log.status === 'COMPLETED');

    return {
      isConnected: true,
      sandbox: credentials.sandbox,
      transactionCount: transactionCount || 0,
      lastSyncAt: lastCompletedSync?.completedAt,
      syncConfig,
      recentLogs,
    };
  }

  /**
   * Check if a user is connected to PayPal
   */
  async isConnected(userId: string): Promise<boolean> {
    const credentials = await this.getCredentials(userId);
    return credentials !== null;
  }

  // ============================================================================
  // Test Connection
  // ============================================================================

  /**
   * Test the PayPal connection by attempting to get an access token
   */
  async testConnection(userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const token = await this.getAccessToken(userId);
      if (!token) {
        return { success: false, error: 'Failed to get access token' };
      }

      return { success: true };
    } catch (error) {
      console.error('[PayPalAuthService] Test connection error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection test failed',
      };
    }
  }
}

// Export a default instance
export const paypalAuthService = new PayPalAuthService();
