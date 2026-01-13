/**
 * Brickset Cache Service
 *
 * Cache-aware service that checks Supabase first before calling the API.
 * Implements a 30-day TTL for cached data.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceRoleClient } from '../supabase/server';
import { BricksetApiClient } from './brickset-api';
import type { BricksetSet, BricksetApiSet } from './types';
import { apiSetToInternal, internalToDbInsert, dbRowToInternal } from './types';

/** Cache TTL in days */
const CACHE_TTL_DAYS = 30;

/** Calculate if a date is stale (older than TTL) */
function isStale(lastFetchedAt: string | null): boolean {
  if (!lastFetchedAt) return true;

  const fetchedDate = new Date(lastFetchedAt);
  const now = new Date();
  const diffMs = now.getTime() - fetchedDate.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  return diffDays > CACHE_TTL_DAYS;
}

export interface CacheStats {
  totalSets: number;
  freshCount: number;
  staleCount: number;
  oldestFetch: string | null;
  newestFetch: string | null;
}

export class BricksetCacheService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Get a set by set number, using cache with optional API refresh
   *
   * @param setNumber - Set number (e.g., "75192-1")
   * @param apiKey - Optional API key for fetching from Brickset if not cached
   * @param forceRefresh - Force refresh from API even if cached
   */
  async getSet(
    setNumber: string,
    apiKey?: string,
    forceRefresh: boolean = false
  ): Promise<BricksetSet | null> {
    // Normalize set number (ensure it has variant suffix)
    const normalizedSetNumber = setNumber.includes('-') ? setNumber : `${setNumber}-1`;

    // 1. Check cache
    const cached = await this.getCachedSet(normalizedSetNumber);

    // 2. Return cached if fresh and not forcing refresh
    if (cached && !forceRefresh && !isStale(cached.lastFetchedAt)) {
      return cached;
    }

    // 3. If no API key, return cached (even if stale) or null
    if (!apiKey) {
      return cached;
    }

    // 4. Fetch from API and update cache
    try {
      const apiClient = new BricksetApiClient(apiKey);
      const apiSet = await apiClient.getSetByNumber(normalizedSetNumber);

      if (!apiSet) {
        // Set not found in API, return cached if available
        return cached;
      }

      // 5. Convert and save to cache
      const internalSet = apiSetToInternal(apiSet);
      await this.upsertSet(internalSet, apiSet);

      // 6. Return the updated cached version
      return this.getCachedSet(normalizedSetNumber);
    } catch (error) {
      console.error('[BricksetCacheService] Error fetching from API:', error);
      // Return cached version on error
      return cached;
    }
  }

  /**
   * Search sets in the local cache
   */
  async searchSetsLocal(
    query: string,
    options: {
      theme?: string;
      year?: number;
      limit?: number;
    } = {}
  ): Promise<BricksetSet[]> {
    const limit = options.limit || 50;

    let queryBuilder = this.supabase
      .from('brickset_sets')
      .select('*')
      .limit(limit);

    // Search on set name, number, and theme using individual ilike filters
    // Sanitize query by escaping special PostgREST characters
    if (query) {
      const sanitized = query
        .replace(/[%_]/g, '\\$&')  // Escape SQL wildcards
        .replace(/[(),]/g, '');    // Remove PostgREST special chars

      queryBuilder = queryBuilder.or(
        `set_name.ilike.%${sanitized}%,set_number.ilike.%${sanitized}%,theme.ilike.%${sanitized}%`
      );
    }

    if (options.theme) {
      queryBuilder = queryBuilder.eq('theme', options.theme);
    }

    if (options.year) {
      queryBuilder = queryBuilder.eq('year_from', options.year);
    }

    const { data, error } = await queryBuilder.order('year_from', { ascending: false });

    if (error) {
      console.error('[BricksetCacheService] Search error:', error);
      return [];
    }

    return (data || []).map(dbRowToInternal);
  }

  /**
   * Search sets, with optional API fallback
   */
  async searchSets(
    query: string,
    apiKey?: string,
    options: {
      theme?: string;
      year?: number;
      limit?: number;
      useApiIfNoResults?: boolean;
    } = {}
  ): Promise<BricksetSet[]> {
    // First try local cache
    const localResults = await this.searchSetsLocal(query, options);

    // Return local results if we have them or no API key
    if (localResults.length > 0 || !apiKey || !options.useApiIfNoResults) {
      return localResults;
    }

    // Fallback to API
    try {
      const apiClient = new BricksetApiClient(apiKey);
      const apiSets = await apiClient.searchSets(query, {
        theme: options.theme,
        year: options.year?.toString(),
        pageSize: options.limit || 50,
      });

      if (apiSets.length === 0) {
        return localResults;
      }

      // Batch upsert all results to cache
      const dbData = apiSets.map((apiSet) => ({
        ...internalToDbInsert(apiSetToInternal(apiSet)),
        raw_response: apiSet,
      }));

      const { error: upsertError } = await this.supabase
        .from('brickset_sets')
        .upsert(dbData, { onConflict: 'set_number' });

      if (upsertError) {
        console.error('[BricksetCacheService] Batch upsert error:', upsertError);
      }

      // Batch fetch the cached results
      const setNumbers = apiSets.map((s) => `${s.number}-${s.numberVariant}`);
      const { data: cachedData } = await this.supabase
        .from('brickset_sets')
        .select('*')
        .in('set_number', setNumbers);

      return (cachedData || []).map(dbRowToInternal);
    } catch (error) {
      console.error('[BricksetCacheService] API search error:', error);
      return localResults;
    }
  }

  /**
   * Get a set from cache only (no API call)
   */
  async getCachedSet(setNumber: string): Promise<BricksetSet | null> {
    const { data, error } = await this.supabase
      .from('brickset_sets')
      .select('*')
      .eq('set_number', setNumber)
      .single();

    if (error || !data) {
      return null;
    }

    return dbRowToInternal(data);
  }

  /**
   * Check if a set is in the cache
   */
  async isCached(setNumber: string): Promise<boolean> {
    const { count, error } = await this.supabase
      .from('brickset_sets')
      .select('*', { count: 'exact', head: true })
      .eq('set_number', setNumber);

    if (error) {
      return false;
    }

    return (count || 0) > 0;
  }

  /**
   * Check if a set's cache entry is fresh
   */
  async isFresh(setNumber: string): Promise<boolean> {
    const cached = await this.getCachedSet(setNumber);
    if (!cached) return false;
    return !isStale(cached.lastFetchedAt);
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<CacheStats> {
    const now = new Date();
    const staleThreshold = new Date(now.getTime() - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000);

    // Get total count
    const { count: totalSets } = await this.supabase
      .from('brickset_sets')
      .select('*', { count: 'exact', head: true });

    // Get stale count
    const { count: staleCount } = await this.supabase
      .from('brickset_sets')
      .select('*', { count: 'exact', head: true })
      .or(`last_fetched_at.is.null,last_fetched_at.lt.${staleThreshold.toISOString()}`);

    // Get oldest and newest fetch dates
    const { data: oldest } = await this.supabase
      .from('brickset_sets')
      .select('last_fetched_at')
      .not('last_fetched_at', 'is', null)
      .order('last_fetched_at', { ascending: true })
      .limit(1)
      .single();

    const { data: newest } = await this.supabase
      .from('brickset_sets')
      .select('last_fetched_at')
      .not('last_fetched_at', 'is', null)
      .order('last_fetched_at', { ascending: false })
      .limit(1)
      .single();

    return {
      totalSets: totalSets || 0,
      freshCount: (totalSets || 0) - (staleCount || 0),
      staleCount: staleCount || 0,
      oldestFetch: oldest?.last_fetched_at || null,
      newestFetch: newest?.last_fetched_at || null,
    };
  }

  /**
   * Get recent lookups (sets ordered by last_fetched_at)
   */
  async getRecentLookups(limit: number = 10): Promise<BricksetSet[]> {
    const { data, error } = await this.supabase
      .from('brickset_sets')
      .select('*')
      .not('last_fetched_at', 'is', null)
      .order('last_fetched_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[BricksetCacheService] Error getting recent lookups:', error);
      return [];
    }

    return (data || []).map(dbRowToInternal);
  }

  /**
   * Upsert a set into the cache
   * Uses service role client to bypass RLS (brickset_sets has no user write policies)
   */
  private async upsertSet(
    internalSet: Omit<BricksetSet, 'id' | 'createdAt' | 'updatedAt'>,
    rawResponse: BricksetApiSet
  ): Promise<void> {
    const dbData = {
      ...internalToDbInsert(internalSet),
      // Convert to plain JSON by serializing and deserializing
      raw_response: JSON.parse(JSON.stringify(rawResponse)),
    };

    // Use service role client because brickset_sets table only has SELECT policy
    // Writes require service role to bypass RLS
    const serviceClient = createServiceRoleClient();
    const { error } = await serviceClient
      .from('brickset_sets')
      .upsert(dbData, { onConflict: 'set_number' });

    if (error) {
      console.error('[BricksetCacheService] Error upserting set:', error);
      throw error;
    }
  }

  /**
   * Batch insert sets (for seed data import)
   * Uses service role client to bypass RLS
   */
  async batchInsertSets(
    sets: Array<Omit<BricksetSet, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<{ inserted: number; errors: number }> {
    let inserted = 0;
    let errors = 0;

    // Use service role client for writes
    const serviceClient = createServiceRoleClient();

    // Process in batches of 100 to avoid timeouts
    const batchSize = 100;
    for (let i = 0; i < sets.length; i += batchSize) {
      const batch = sets.slice(i, i + batchSize);
      const dbData = batch.map((set) => internalToDbInsert(set));

      const { error } = await serviceClient
        .from('brickset_sets')
        .upsert(dbData, { onConflict: 'set_number', ignoreDuplicates: true });

      if (error) {
        console.error('[BricksetCacheService] Batch insert error:', error);
        errors += batch.length;
      } else {
        inserted += batch.length;
      }
    }

    return { inserted, errors };
  }
}
