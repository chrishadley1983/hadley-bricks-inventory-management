import { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Profile, ProfileUpdate } from '@hadley-bricks/database';
import { BaseRepository } from './base.repository';

/**
 * Repository for user profile operations.
 * Note: Profile creation is handled by database trigger on auth.users insert.
 */
export class UserRepository extends BaseRepository<Profile, never, ProfileUpdate> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'profiles');
  }

  /**
   * Get the current user's profile
   */
  async getCurrentProfile(): Promise<Profile | null> {
    const {
      data: { user },
    } = await this.supabase.auth.getUser();

    if (!user) {
      return null;
    }

    return this.findById(user.id);
  }

  /**
   * Update the current user's profile
   */
  async updateCurrentProfile(input: ProfileUpdate): Promise<Profile> {
    const {
      data: { user },
    } = await this.supabase.auth.getUser();

    if (!user) {
      throw new Error('No authenticated user');
    }

    return this.update(user.id, input);
  }

  /**
   * Update user's business name
   */
  async updateBusinessName(businessName: string): Promise<Profile> {
    return this.updateCurrentProfile({ business_name: businessName });
  }

  /**
   * Update user's home postcode
   */
  async updateHomePostcode(postcode: string): Promise<Profile> {
    return this.updateCurrentProfile({ home_postcode: postcode });
  }
}
