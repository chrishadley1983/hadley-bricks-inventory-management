/**
 * GET /api/ebay-auctions/alerts
 *
 * Fetch eBay auction alert history with pagination.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.max(1, Math.min(parseInt(searchParams.get('pageSize') || '20', 10) || 20, 100));
    const offset = (page - 1) * pageSize;

    const supabase = createServiceRoleClient();

    // Get total count
    const { count } = await supabase
      .from('ebay_auction_alerts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', DEFAULT_USER_ID);

    // Get paginated alerts
    const { data, error } = await supabase
      .from('ebay_auction_alerts')
      .select('*')
      .eq('user_id', DEFAULT_USER_ID)
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
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
