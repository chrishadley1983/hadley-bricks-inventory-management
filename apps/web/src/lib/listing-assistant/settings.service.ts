/**
 * Settings Service
 *
 * Handles user settings for the Listing Assistant feature.
 */

import { createClient } from '@/lib/supabase/server';
import type { ListingAssistantSettings, UpdateSettingsInput } from './types';

/**
 * Get settings for a user, creating defaults if they don't exist
 */
export async function getSettings(userId: string): Promise<ListingAssistantSettings> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('listing_assistant_settings')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // Not found, create default settings
      return createDefaultSettings(userId);
    }
    console.error('[Settings] Failed to fetch settings:', error);
    throw new Error('Failed to fetch settings');
  }

  return data as ListingAssistantSettings;
}

/**
 * Create default settings for a new user
 */
async function createDefaultSettings(userId: string): Promise<ListingAssistantSettings> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('listing_assistant_settings')
    .insert({
      user_id: userId,
      default_tone: 'Minimalist',
      default_condition: 'Used',
    })
    .select()
    .single();

  if (error) {
    console.error('[Settings] Failed to create default settings:', error);
    throw new Error('Failed to create settings');
  }

  return data as ListingAssistantSettings;
}

/**
 * Update settings for a user
 */
export async function updateSettings(
  userId: string,
  input: UpdateSettingsInput
): Promise<ListingAssistantSettings> {
  const supabase = await createClient();

  // Ensure settings exist first
  await getSettings(userId);

  const { data, error } = await supabase
    .from('listing_assistant_settings')
    .update({
      ...(input.default_tone !== undefined && { default_tone: input.default_tone }),
      ...(input.default_condition !== undefined && { default_condition: input.default_condition }),
    })
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    console.error('[Settings] Failed to update settings:', error);
    throw new Error('Failed to update settings');
  }

  return data as ListingAssistantSettings;
}
