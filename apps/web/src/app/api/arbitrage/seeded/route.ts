/**
 * Seeded ASIN Preferences API Routes
 *
 * GET - List seeded ASINs with filters
 * POST - Toggle sync preference for seeded ASINs
 * PATCH - Update user preference for a seeded ASIN
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

// =============================================================================
// SCHEMAS
// =============================================================================

const ListQuerySchema = z.object({
  theme: z.string().optional(),
  yearFrom: z.coerce.number().int().optional(),
  yearTo: z.coerce.number().int().optional(),
  minConfidence: z.coerce.number().int().min(0).max(100).optional(),
  status: z.enum(['found', 'not_found', 'multiple', 'pending', 'excluded']).optional(),
  includeEnabledOnly: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(50),
  search: z.string().optional(),
});

const ToggleSyncSchema = z.object({
  seededAsinIds: z.array(z.string().uuid()),
  includeInSync: z.boolean(),
});

const UpdatePreferenceSchema = z.object({
  seededAsinId: z.string().uuid(),
  includeInSync: z.boolean().optional(),
  userStatus: z.enum(['active', 'excluded']).optional(),
  exclusionReason: z.string().max(500).optional(),
  manualAsinOverride: z.string().max(10).optional().nullable(),
});

// =============================================================================
// GET - List seeded ASINs with filters
// =============================================================================

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check auth
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse query params
    const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = ListQuerySchema.safeParse(searchParams);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const {
      theme,
      yearFrom,
      yearTo,
      minConfidence,
      status,
      includeEnabledOnly,
      page,
      pageSize,
      search,
    } = parsed.data;

    const offset = (page - 1) * pageSize;
    let data: unknown[] | null = null;
    let error: unknown = null;
    let totalCount = 0;

    // When search is provided, use the flattened view for cross-table search
    if (search) {
      // Use the view that supports searching across seeded_asins and brickset_sets
      let viewQuery = supabase
        .from('seeded_asins_with_sets')
        .select('*', { count: 'exact' })
        .or(`amazon_title.ilike.%${search}%,set_number.ilike.%${search}%,set_name.ilike.%${search}%`)
        .order('created_at', { ascending: false });

      // Apply filters
      if (status) {
        viewQuery = viewQuery.eq('discovery_status', status);
      }
      if (minConfidence !== undefined) {
        viewQuery = viewQuery.gte('match_confidence', minConfidence);
      }
      if (theme) {
        viewQuery = viewQuery.eq('theme', theme);
      }
      if (yearFrom !== undefined) {
        viewQuery = viewQuery.gte('year_from', yearFrom);
      }
      if (yearTo !== undefined) {
        viewQuery = viewQuery.lte('year_from', yearTo);
      }

      // Pagination
      viewQuery = viewQuery.range(offset, offset + pageSize - 1);

      const result = await viewQuery;
      data = result.data;
      error = result.error;
      totalCount = result.count ?? 0;

      // Transform view data to match expected format
      if (data) {
        data = (data as Record<string, unknown>[]).map((row) => ({
          id: row.id,
          asin: row.asin,
          discovery_status: row.discovery_status,
          match_method: row.match_method,
          match_confidence: row.match_confidence,
          amazon_title: row.amazon_title,
          amazon_price: row.amazon_price,
          amazon_image_url: row.amazon_image_url,
          amazon_brand: row.amazon_brand,
          alternative_asins: row.alternative_asins,
          last_discovery_attempt_at: row.last_discovery_attempt_at,
          discovery_attempts: row.discovery_attempts,
          discovery_error: row.discovery_error,
          created_at: row.created_at,
          updated_at: row.updated_at,
          brickset_sets: {
            id: row.brickset_set_id,
            set_number: row.set_number,
            set_name: row.set_name,
            theme: row.theme,
            year_from: row.year_from,
            uk_retail_price: row.uk_retail_price,
            image_url: row.brickset_image_url,
            pieces: row.pieces,
            ean: row.ean,
            upc: row.upc,
          },
          user_seeded_asin_preferences: [], // View doesn't include preferences, handled separately if needed
        }));
      }
    } else {
      // No search - use the standard query with joins
      let query = supabase
        .from('seeded_asins')
        .select(
          `
          id,
          asin,
          discovery_status,
          match_method,
          match_confidence,
          amazon_title,
          amazon_price,
          amazon_image_url,
          amazon_brand,
          alternative_asins,
          last_discovery_attempt_at,
          discovery_attempts,
          discovery_error,
          created_at,
          updated_at,
          brickset_sets!inner(
            id,
            set_number,
            set_name,
            theme,
            year_from,
            uk_retail_price,
            image_url,
            pieces,
            ean,
            upc
          ),
          user_seeded_asin_preferences!left(
            id,
            include_in_sync,
            user_status,
            exclusion_reason,
            manual_asin_override
          )
        `,
          { count: 'exact' }
        )
        .order('created_at', { ascending: false });

      // Apply filters
      if (status) {
        query = query.eq('discovery_status', status);
      }
      if (minConfidence !== undefined) {
        query = query.gte('match_confidence', minConfidence);
      }
      if (theme) {
        query = query.eq('brickset_sets.theme', theme);
      }
      if (yearFrom !== undefined) {
        query = query.gte('brickset_sets.year_from', yearFrom);
      }
      if (yearTo !== undefined) {
        query = query.lte('brickset_sets.year_from', yearTo);
      }

      // Pagination
      query = query.range(offset, offset + pageSize - 1);

      const result = await query;
      data = result.data;
      error = result.error;
      totalCount = result.count ?? 0;

      // If count appears capped at 1000, run a separate count query
      if (totalCount === 1000) {
        const { count: actualCount } = await supabase
          .from('seeded_asins')
          .select('*', { count: 'exact', head: true });
        totalCount = actualCount ?? 0;
      }
    }

    console.log(`[GET /api/arbitrage/seeded] Page: ${page}, Search: ${search || 'none'}, Results: ${(data as unknown[])?.length ?? 0}, Total: ${totalCount}`);

    if (error) {
      console.error('[GET /api/arbitrage/seeded] Query error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch seeded ASINs' },
        { status: 500 }
      );
    }

    // Transform response - define expected row shape from query/view
    interface QueryRow {
      id: string;
      asin: string | null;
      discovery_status: string;
      match_method: string | null;
      match_confidence: number | null;
      amazon_title: string | null;
      amazon_price: number | null;
      amazon_image_url: string | null;
      amazon_brand: string | null;
      alternative_asins: unknown;
      last_discovery_attempt_at: string | null;
      discovery_attempts: number;
      discovery_error: string | null;
      created_at: string;
      updated_at: string;
      brickset_sets: {
        id: string;
        set_number: string;
        set_name: string;
        theme: string | null;
        year_from: number | null;
        uk_retail_price: number | null;
        image_url: string | null;
        pieces: number | null;
        ean: string | null;
        upc: string | null;
      };
      user_seeded_asin_preferences: Array<{
        id: string;
        include_in_sync: boolean;
        user_status: string;
        exclusion_reason: string | null;
        manual_asin_override: string | null;
      }> | null;
    }

    const items = ((data ?? []) as QueryRow[]).map((row) => {
      const bs = row.brickset_sets;

      // Get user preference (may be an array or single object)
      const prefArray = row.user_seeded_asin_preferences;
      const pref = prefArray?.[0] ?? null;

      return {
        id: row.id,
        asin: row.asin,
        discoveryStatus: row.discovery_status,
        matchMethod: row.match_method,
        matchConfidence: row.match_confidence,
        amazonTitle: row.amazon_title,
        amazonPrice: row.amazon_price,
        amazonImageUrl: row.amazon_image_url,
        amazonBrand: row.amazon_brand,
        alternativeAsins: row.alternative_asins,
        lastDiscoveryAttemptAt: row.last_discovery_attempt_at,
        discoveryAttempts: row.discovery_attempts,
        discoveryError: row.discovery_error,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        bricksetSet: {
          id: bs.id,
          setNumber: bs.set_number,
          setName: bs.set_name,
          theme: bs.theme,
          yearFrom: bs.year_from,
          ukRetailPrice: bs.uk_retail_price,
          imageUrl: bs.image_url,
          pieces: bs.pieces,
          ean: bs.ean,
          upc: bs.upc,
        },
        userPreference: pref
          ? {
              id: pref.id,
              includeInSync: pref.include_in_sync,
              userStatus: pref.user_status,
              exclusionReason: pref.exclusion_reason,
              manualAsinOverride: pref.manual_asin_override,
            }
          : null,
      };
    });

    // Filter by enabled only if requested (client-side since it's a left join)
    const filteredItems =
      includeEnabledOnly === 'true'
        ? items.filter((item) => item.userPreference?.includeInSync === true)
        : items;

    console.log(`[GET /api/arbitrage/seeded] Returning ${filteredItems.length} items (raw: ${items.length})`);

    return NextResponse.json({
      items: filteredItems,
      totalCount,
      page,
      pageSize,
      hasMore: offset + pageSize < totalCount,
    });
  } catch (error) {
    console.error('[GET /api/arbitrage/seeded] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// =============================================================================
// POST - Toggle sync preference for multiple seeded ASINs
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check auth
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse and validate body
    const body = await request.json();
    const parsed = ToggleSyncSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { seededAsinIds, includeInSync } = parsed.data;

    // Upsert preferences for all seeded ASINs
    const records = seededAsinIds.map((seededAsinId) => ({
      user_id: user.id,
      seeded_asin_id: seededAsinId,
      include_in_sync: includeInSync,
      user_status: 'active' as const,
    }));

    const { error } = await supabase
      .from('user_seeded_asin_preferences')
      .upsert(records, { onConflict: 'user_id,seeded_asin_id' });

    if (error) {
      console.error('[POST /api/arbitrage/seeded] Upsert error:', error);
      return NextResponse.json(
        { error: 'Failed to update preferences' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Updated ${seededAsinIds.length} seeded ASIN preferences`,
      updated: seededAsinIds.length,
    });
  } catch (error) {
    console.error('[POST /api/arbitrage/seeded] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// =============================================================================
// PATCH - Update single user preference
// =============================================================================

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check auth
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse and validate body
    const body = await request.json();
    const parsed = UpdatePreferenceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { seededAsinId, includeInSync, userStatus, exclusionReason, manualAsinOverride } =
      parsed.data;

    // Build update data
    const updateData: Record<string, unknown> = {};
    if (includeInSync !== undefined) updateData.include_in_sync = includeInSync;
    if (userStatus !== undefined) {
      updateData.user_status = userStatus;
      if (userStatus === 'excluded') {
        updateData.excluded_at = new Date().toISOString();
      }
    }
    if (exclusionReason !== undefined) updateData.exclusion_reason = exclusionReason;
    if (manualAsinOverride !== undefined) updateData.manual_asin_override = manualAsinOverride;

    // Upsert preference
    const { data, error } = await supabase
      .from('user_seeded_asin_preferences')
      .upsert(
        {
          user_id: user.id,
          seeded_asin_id: seededAsinId,
          ...updateData,
        },
        { onConflict: 'user_id,seeded_asin_id' }
      )
      .select()
      .single();

    if (error) {
      console.error('[PATCH /api/arbitrage/seeded] Upsert error:', error);
      return NextResponse.json(
        { error: 'Failed to update preference' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      preference: {
        id: data.id,
        seededAsinId: data.seeded_asin_id,
        includeInSync: data.include_in_sync,
        userStatus: data.user_status,
        exclusionReason: data.exclusion_reason,
        manualAsinOverride: data.manual_asin_override,
      },
    });
  } catch (error) {
    console.error('[PATCH /api/arbitrage/seeded] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
