import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
    if (meetsThreshold !== null) {
      query = query.eq('meets_threshold', meetsThreshold === 'true');
    }
    if (search) {
      query = query.or(`name.ilike.%${search}%,bricklink_id.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    console.error('[GET /api/minifigs/sync/items] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch items', details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
