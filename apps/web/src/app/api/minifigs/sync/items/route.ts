import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const url = new URL(request.url);
    const listingStatus = url.searchParams.get('listingStatus');
    const meetsThreshold = url.searchParams.get('meetsThreshold');
    const search = url.searchParams.get('search');

    let query = supabase
      .from('minifig_sync_items')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    if (listingStatus) {
      query = query.eq('listing_status', listingStatus);
    }
    if (meetsThreshold !== null && meetsThreshold !== '') {
      query = query.eq('meets_threshold', meetsThreshold === 'true');
    }
    if (search) {
      // Escape PostgREST special characters to prevent filter injection (C4)
      const escaped = search.replace(/[%_,().\\]/g, '\\$&');
      query = query.or(`name.ilike.%${escaped}%,bricklink_id.ilike.%${escaped}%`);
    }

    const { data, error } = await query.limit(1000);
    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    console.error('[GET /api/minifigs/sync/items] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch items' }, { status: 500 });
  }
}
