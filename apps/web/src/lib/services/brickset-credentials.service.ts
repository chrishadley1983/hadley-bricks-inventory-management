/**
 * Brickset Credentials Service
 *
 * Manages Brickset API credentials with encryption.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptObject, decryptObject } from '../crypto';
import { BricksetApiClient } from '../brickset';
import type { BricksetCredentials } from '../brickset';

export class BricksetCredentialsService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Check if Brickset is configured for a user
   */
  async isConfigured(userId: string): Promise<boolean> {
    const { count, error } = await this.supabase
      .from('brickset_api_credentials')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) {
      console.error('[BricksetCredentialsService] Error checking configuration:', error);
      return false;
    }

    return (count ?? 0) > 0;
  }

  /**
   * Get credentials for a user
   */
  async getCredentials(userId: string): Promise<BricksetCredentials | null> {
    const { data, error } = await this.supabase
      .from('brickset_api_credentials')
      .select('api_key_encrypted')
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No credentials found
        return null;
      }
      console.error('[BricksetCredentialsService] Error getting credentials:', error);
      throw new Error('Failed to get credentials');
    }

    if (!data?.api_key_encrypted) {
      return null;
    }

    try {
      return await decryptObject<BricksetCredentials>(data.api_key_encrypted);
    } catch (decryptError) {
      console.error('[BricksetCredentialsService] Error decrypting credentials:', decryptError);
      throw new Error('Failed to decrypt credentials');
    }
  }

  /**
   * Get the API key directly (convenience method)
   */
  async getApiKey(userId: string): Promise<string | null> {
    const credentials = await this.getCredentials(userId);
    return credentials?.apiKey || null;
  }

  /**
   * Save credentials for a user
   */
  async saveCredentials(userId: string, credentials: BricksetCredentials): Promise<void> {
    const encrypted = await encryptObject(credentials);

    const { error } = await this.supabase.from('brickset_api_credentials').upsert(
      {
        user_id: userId,
        api_key_encrypted: encrypted,
        last_used_at: new Date().toISOString(),
      },
      {
        onConflict: 'user_id',
      }
    );

    if (error) {
      console.error('[BricksetCredentialsService] Error saving credentials:', error);
      throw new Error('Failed to save credentials');
    }
  }

  /**
   * Delete credentials for a user
   */
  async deleteCredentials(userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('brickset_api_credentials')
      .delete()
      .eq('user_id', userId);

    if (error) {
      console.error('[BricksetCredentialsService] Error deleting credentials:', error);
      throw new Error('Failed to delete credentials');
    }
  }

  /**
   * Test connection using stored credentials
   */
  async testConnection(userId: string): Promise<boolean> {
    const apiKey = await this.getApiKey(userId);

    if (!apiKey) {
      return false;
    }

    return this.testConnectionWithCredentials({ apiKey });
  }

  /**
   * Test connection with provided credentials (before saving)
   */
  async testConnectionWithCredentials(credentials: BricksetCredentials): Promise<boolean> {
    try {
      const client = new BricksetApiClient(credentials.apiKey);
      const isValid = await client.checkKey();
      return isValid;
    } catch (error) {
      console.error('[BricksetCredentialsService] Connection test failed:', error);
      return false;
    }
  }

  /**
   * Update last_used_at timestamp
   */
  async updateLastUsed(userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('brickset_api_credentials')
      .update({ last_used_at: new Date().toISOString() })
      .eq('user_id', userId);

    if (error) {
      // Non-fatal, just log
      console.error('[BricksetCredentialsService] Error updating last_used_at:', error);
    }
  }

  /**
   * Get API usage statistics for a user
   */
  async getUsageStats(userId: string): Promise<{
    configured: boolean;
    lastUsedAt: string | null;
    apiUsage?: Array<{ dateFrom: string; dateTo: string; count: number }>;
  }> {
    const { data, error } = await this.supabase
      .from('brickset_api_credentials')
      .select('last_used_at, api_key_encrypted')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return { configured: false, lastUsedAt: null };
    }

    const result: {
      configured: boolean;
      lastUsedAt: string | null;
      apiUsage?: Array<{ dateFrom: string; dateTo: string; count: number }>;
    } = {
      configured: true,
      lastUsedAt: data.last_used_at,
    };

    // Try to get API usage stats from Brickset
    try {
      const credentials = await decryptObject<BricksetCredentials>(data.api_key_encrypted);
      const client = new BricksetApiClient(credentials.apiKey);
      const usage = await client.getKeyUsageStats();
      result.apiUsage = usage;
    } catch {
      // Ignore errors getting usage stats
    }

    return result;
  }
}
