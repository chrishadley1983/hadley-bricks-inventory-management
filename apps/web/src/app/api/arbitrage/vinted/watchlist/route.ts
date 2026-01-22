/**
 * Vinted Watchlist API
 *
 * GET - List watchlist items with stats
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();

  // Check auth
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fetch watchlist items
  const { data: watchlistItems, error: watchlistError } = await supabase
    .from('vinted_watchlist')
    .select('*')
    .eq('user_id', user.id)
    .order('sales_rank', { ascending: true, nullsFirst: false });

  if (watchlistError) {
    console.error('[watchlist] Query error:', watchlistError);
    return NextResponse.json({ error: 'Failed to fetch watchlist' }, { status: 500 });
  }

  // Fetch stats for all watchlist items
  const { data: stats, error: statsError } = await supabase
    .from('vinted_watchlist_stats')
    .select('*')
    .eq('user_id', user.id);

  if (statsError) {
    console.warn('[watchlist] Stats query error:', statsError);
  }

  // Map stats to items
  const statsMap = new Map(
    (stats || []).map((s) => [
      s.set_number,
      {
        total_scans: s.total_scans,
        listings_found: s.listings_found,
        viable_found: s.viable_found,
        near_miss_found: s.near_miss_found,
        last_listing_at: s.last_listing_at,
        last_viable_at: s.last_viable_at,
      },
    ])
  );

  const items = (watchlistItems || []).map((item) => ({
    ...item,
    stats: statsMap.get(item.set_number) || null,
  }));

  return NextResponse.json({ items });
}
