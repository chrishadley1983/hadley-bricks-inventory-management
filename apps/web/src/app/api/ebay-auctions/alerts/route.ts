/**
 * GET /api/ebay-auctions/alerts
 *
 * Fetch eBay auction alert history with pagination.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.max(1, Math.min(parseInt(searchParams.get('pageSize') || '20', 10) || 20, 100));
    const offset = (page - 1) * pageSize;

    // Get total count
    const { count } = await supabase
      .from('ebay_auction_alerts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);

    // Get paginated alerts
    const { data, error } = await supabase
      .from('ebay_auction_alerts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      alerts: data || [],
      totalCount: count || 0,
      hasMore: (count || 0) > offset + pageSize,
      page,
      pageSize,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
