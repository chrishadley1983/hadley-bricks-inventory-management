import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Number(searchParams.get('page') || '1');
    const pageSize = Math.min(Number(searchParams.get('pageSize') || '50'), 100);
    const status = searchParams.get('status'); // PENDING, APPROVED, etc.
    const platform = searchParams.get('platform'); // amazon, ebay
    const diagnosis = searchParams.get('diagnosis'); // OVERPRICED, LOW_DEMAND
    const action = searchParams.get('action'); // MARKDOWN, AUCTION

    const supabase = createServiceRoleClient();

    // Build query
    let query = supabase
      .from('markdown_proposals')
      .select('*', { count: 'exact' })
      .eq('user_id', DEFAULT_USER_ID)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (platform) query = query.eq('platform', platform);
    if (diagnosis) query = query.eq('diagnosis', diagnosis);
    if (action) query = query.eq('proposed_action', action);

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Also get summary counts
    const { data: summaryData } = await supabase
      .from('markdown_proposals')
      .select('status, proposed_action')
      .eq('user_id', DEFAULT_USER_ID);

    const summary = {
      pending: 0,
      approved: 0,
      rejected: 0,
      autoApplied: 0,
      failed: 0,
      markdowns: 0,
      auctions: 0,
    };

    for (const row of summaryData || []) {
      if (row.status === 'PENDING') summary.pending++;
      else if (row.status === 'APPROVED') summary.approved++;
      else if (row.status === 'REJECTED') summary.rejected++;
      else if (row.status === 'AUTO_APPLIED') summary.autoApplied++;
      else if (row.status === 'FAILED') summary.failed++;
      if (row.proposed_action === 'AUCTION') summary.auctions++;
      else summary.markdowns++;
    }

    return NextResponse.json({
      data,
      summary,
      pagination: {
        page,
        pageSize,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / pageSize),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
