import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/inventory/listing-counts
 * Get active listing counts per platform
 */
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

    // Query active listings count by platform using listing_platform field
    const [ebayResult, amazonResult, bricklinkResult, brickowlResult] = await Promise.all([
      supabase
        .from('inventory_items')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('listing_platform', 'ebay')
        .eq('status', 'Listed'),
      supabase
        .from('inventory_items')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('listing_platform', 'amazon')
        .eq('status', 'Listed'),
      supabase
        .from('inventory_items')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('listing_platform', 'bricklink')
        .eq('status', 'Listed'),
      supabase
        .from('inventory_items')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('listing_platform', 'brickowl')
        .eq('status', 'Listed'),
    ]);

    return NextResponse.json({
      ebay: ebayResult.count ?? 0,
      amazon: amazonResult.count ?? 0,
      bricklink: bricklinkResult.count ?? 0,
      brickowl: brickowlResult.count ?? 0,
    });
  } catch (error) {
    console.error('[GET /api/inventory/listing-counts] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
