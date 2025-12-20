import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Database,
  PlatformCredential,
  PlatformCredentialInsert,
  PlatformCredentialUpdate,
  Platform,
} from '@hadley-bricks/database';
import { BaseRepository } from './base.repository';
import { encryptObject, decryptObject } from '../crypto';

/**
 * Repository for platform credentials with encryption
 */
export class CredentialsRepository extends BaseRepository<
  PlatformCredential,
  PlatformCredentialInsert,
  PlatformCredentialUpdate
> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'platform_credentials');
  }

  /**
   * Get credentials for a platform
   */
  async getCredentials<T>(userId: string, platform: Platform): Promise<T | null> {
    const { data, error } = await this.supabase
      .from('platform_credentials')
      .select('*')
      .eq('user_id', userId)
      .eq('platform', platform)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new Error(`Failed to get credentials: ${error.message}`);
    }

    if (!data?.credentials_encrypted) {
      return null;
    }

    // Decrypt credentials
    try {
      return await decryptObject<T>(data.credentials_encrypted);
    } catch {
      throw new Error('Failed to decrypt credentials');
    }
  }

  /**
   * Save credentials for a platform
   */
  async saveCredentials<T extends object>(
    userId: string,
    platform: Platform,
    credentials: T
  ): Promise<void> {
    // Encrypt credentials
    const encrypted = await encryptObject(credentials);

    const { error } = await this.supabase.from('platform_credentials').upsert(
      {
        user_id: userId,
        platform,
        credentials_encrypted: encrypted,
      },
      {
        onConflict: 'user_id,platform',
      }
    );

    if (error) {
      throw new Error(`Failed to save credentials: ${error.message}`);
    }
  }

  /**
   * Delete credentials for a platform
   */
  async deleteCredentials(userId: string, platform: Platform): Promise<void> {
    const { error } = await this.supabase
      .from('platform_credentials')
      .delete()
      .eq('user_id', userId)
      .eq('platform', platform);

    if (error) {
      throw new Error(`Failed to delete credentials: ${error.message}`);
    }
  }

  /**
   * Check if credentials exist for a platform
   */
  async hasCredentials(userId: string, platform: Platform): Promise<boolean> {
    const { count, error } = await this.supabase
      .from('platform_credentials')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('platform', platform);

    if (error) {
      throw new Error(`Failed to check credentials: ${error.message}`);
    }

    return (count ?? 0) > 0;
  }

  /**
   * Get all configured platforms for a user
   */
  async getConfiguredPlatforms(userId: string): Promise<Platform[]> {
    const { data, error } = await this.supabase
      .from('platform_credentials')
      .select('platform')
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to get configured platforms: ${error.message}`);
    }

    return (data ?? []).map((d) => d.platform as Platform);
  }
}
