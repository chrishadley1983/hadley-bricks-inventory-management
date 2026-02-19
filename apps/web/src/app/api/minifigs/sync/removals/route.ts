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

    const { data, error } = await supabase
      .from('minifig_removal_queue')
      .select('*, minifig_sync_items!minifig_removal_queue_minifig_sync_id_fkey(id, name, bricklink_id, bricqer_image_url, ebay_listing_url, ebay_sku, images)')
      .eq('user_id', user.id)
      .eq('status', 'PENDING')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    console.error('[GET /api/minifigs/sync/removals] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch removals',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
