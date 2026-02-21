/**
 * Listings Service
 *
 * Handles CRUD operations for generated listings in Supabase.
 */

import { createClient } from '@/lib/supabase/server';
import type { Json } from '@hadley-bricks/database';
import type {
  GeneratedListing,
  CreateListingInput,
  UpdateListingInput,
  ListingStatus,
} from './types';

/**
 * Get all listings for a user with optional filtering
 */
export async function getListings(
  userId: string,
  options?: {
    status?: ListingStatus;
    inventoryItemId?: string;
    limit?: number;
    offset?: number;
  }
): Promise<{ listings: GeneratedListing[]; total: number }> {
  const supabase = await createClient();

  let query = supabase
    .from('generated_listings')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (options?.status) {
    query = query.eq('status', options.status);
  }

  if (options?.inventoryItemId) {
    query = query.eq('inventory_item_id', options.inventoryItemId);
  }

  if (options?.limit) {
    const offset = options.offset ?? 0;
    query = query.range(offset, offset + options.limit - 1);
  }

  const { data, error, count } = await query;

  if (error) {
    console.error('[Listings] Failed to fetch listings:', error);
    throw new Error('Failed to fetch listings');
  }

  return {
    listings: data as GeneratedListing[],
    total: count ?? 0,
  };
}

/**
 * Get a single listing by ID
 */
export async function getListingById(
  userId: string,
  listingId: string
): Promise<GeneratedListing | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('generated_listings')
    .select('*')
    .eq('id', listingId)
    .eq('user_id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    console.error('[Listings] Failed to fetch listing:', error);
    throw new Error('Failed to fetch listing');
  }

  return data as GeneratedListing;
}

/**
 * Get listings for a specific inventory item
 */
export async function getListingsForInventoryItem(
  userId: string,
  inventoryItemId: string
): Promise<GeneratedListing[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('generated_listings')
    .select('*')
    .eq('user_id', userId)
    .eq('inventory_item_id', inventoryItemId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[Listings] Failed to fetch listings for inventory item:', error);
    throw new Error('Failed to fetch listings');
  }

  return data as GeneratedListing[];
}

/**
 * Create a new listing
 */
export async function createListing(
  userId: string,
  input: CreateListingInput
): Promise<GeneratedListing> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('generated_listings')
    .insert({
      user_id: userId,
      inventory_item_id: input.inventory_item_id ?? null,
      item_name: input.item_name,
      condition: input.condition,
      title: input.title,
      price_range: input.price_range ?? null,
      description: input.description,
      template_id: input.template_id ?? null,
      source_urls: input.source_urls ?? null,
      ebay_sold_data: (input.ebay_sold_data ?? null) as Json,
      status: input.status ?? 'draft',
    })
    .select()
    .single();

  if (error) {
    console.error('[Listings] Failed to create listing:', error);
    throw new Error('Failed to create listing');
  }

  return data as GeneratedListing;
}

/**
 * Update an existing listing
 */
export async function updateListing(
  userId: string,
  listingId: string,
  input: UpdateListingInput
): Promise<GeneratedListing> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('generated_listings')
    .update({
      ...(input.title !== undefined && { title: input.title }),
      ...(input.price_range !== undefined && { price_range: input.price_range }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.status !== undefined && { status: input.status }),
    })
    .eq('id', listingId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    console.error('[Listings] Failed to update listing:', error);
    throw new Error('Failed to update listing');
  }

  return data as GeneratedListing;
}

/**
 * Delete a listing
 */
export async function deleteListing(userId: string, listingId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('generated_listings')
    .delete()
    .eq('id', listingId)
    .eq('user_id', userId);

  if (error) {
    console.error('[Listings] Failed to delete listing:', error);
    throw new Error('Failed to delete listing');
  }
}

/**
 * Get count of listings by status
 */
export async function getListingCounts(
  userId: string
): Promise<Record<ListingStatus | 'total', number>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('generated_listings')
    .select('status')
    .eq('user_id', userId);

  if (error) {
    console.error('[Listings] Failed to get listing counts:', error);
    throw new Error('Failed to get listing counts');
  }

  const counts: Record<ListingStatus | 'total', number> = {
    draft: 0,
    ready: 0,
    listed: 0,
    sold: 0,
    total: 0,
  };

  for (const item of data) {
    const status = item.status as ListingStatus;
    counts[status] = (counts[status] || 0) + 1;
    counts.total++;
  }

  return counts;
}
