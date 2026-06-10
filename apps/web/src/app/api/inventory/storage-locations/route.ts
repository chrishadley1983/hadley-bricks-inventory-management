/**
 * Storage Locations API Route
 *
 * GET /api/inventory/storage-locations - Get distinct storage locations for autocomplete
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';

/**
 * GET /api/inventory/storage-locations
 *
 * Returns distinct storage locations from the user's inventory items
 * for use in autocomplete fields.
 */
export async function GET(_request: NextRequest) {
  try {
    // 1. Auth check
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    // 2. Query distinct storage locations
    const { data, error } = await supabase
      .from('inventory_items')
      .select('storage_location')
      .eq('user_id', user.id)
      .not('storage_location', 'is', null)
      .not('storage_location', 'eq', '')
      .order('storage_location')
      .limit(100);

    if (error) {
      console.error('[GET /api/inventory/storage-locations] Database error:', error);
      return NextResponse.json({ error: 'Failed to fetch storage locations' }, { status: 500 });
    }

    // 3. Deduplicate and sort (in case of case variations)
    const locations = [
      ...new Set(data?.map((d) => d.storage_location).filter(Boolean) as string[]),
    ].sort((a, b) => a.localeCompare(b));

    console.log(`[GET /api/inventory/storage-locations] Returning ${locations.length} locations`);

    return NextResponse.json({ locations });
  } catch (error) {
    console.error('[GET /api/inventory/storage-locations] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
