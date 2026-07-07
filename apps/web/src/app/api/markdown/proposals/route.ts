import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';

export async function GET(request: NextRequest) {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const { searchParams } = new URL(request.url);
    const page = Number(searchParams.get('page') || '1');
    const pageSize = Math.min(Number(searchParams.get('pageSize') || '50'), 100);
    const status = searchParams.get('status'); // PENDING, APPROVED, etc.
    const platform = searchParams.get('platform'); // amazon, ebay
    const diagnosis = searchParams.get('diagnosis'); // OVERPRICED, LOW_DEMAND
    const action = searchParams.get('action'); // MARKDOWN, AUCTION

    // Build query
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase deep type inference workaround
    let query = (supabase as any)
      .from('markdown_proposals')
      .select('id, user_id, inventory_item_id, platform, diagnosis, diagnosis_reason, current_price, proposed_price, price_floor, market_price, proposed_action, markdown_step, aging_days, auction_end_date, auction_duration_days, status, error_message, set_number, item_name, sales_rank, created_at, updated_at', { count: 'exact' })
      .eq('user_id', user.id)
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

    // Summary counts via head-count queries — a row-select here silently caps
    // at Supabase's 1,000-row limit and undercounts once the table grows.
    const countWhere = async (column: string, value: string): Promise<number> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count: n } = await (supabase as any)
        .from('markdown_proposals')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq(column, value);
      return n || 0;
    };

    const [pending, approved, rejected, autoApplied, failed, auctions, markdowns] =
      await Promise.all([
        countWhere('status', 'PENDING'),
        countWhere('status', 'APPROVED'),
        countWhere('status', 'REJECTED'),
        countWhere('status', 'AUTO_APPLIED'),
        countWhere('status', 'FAILED'),
        countWhere('proposed_action', 'AUCTION'),
        countWhere('proposed_action', 'MARKDOWN'),
      ]);

    const summary = { pending, approved, rejected, autoApplied, failed, markdowns, auctions };

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
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
