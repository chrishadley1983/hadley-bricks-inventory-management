import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Paginated fetch to handle >1000 pending removals (M2)
    const allRemovals: Array<Record<string, unknown>> = [];
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;
    while (hasMore) {
      const { data, error } = await supabase
        .from('minifig_removal_queue')
        .select('*, minifig_sync_items!minifig_removal_queue_minifig_sync_id_fkey(id, name, bricklink_id, bricqer_image_url, ebay_listing_url, ebay_sku, images)')
        .eq('user_id', user.id)
        .eq('status', 'PENDING')
        .order('created_at', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        throw new Error(error.message);
      }

      allRemovals.push(...(data ?? []));
      hasMore = (data?.length ?? 0) === pageSize;
      page++;
    }

    return NextResponse.json({ data: allRemovals });
  } catch (error) {
    console.error('[GET /api/minifigs/sync/removals] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch removals',
        details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
      },
      { status: 500 },
    );
  }
}
