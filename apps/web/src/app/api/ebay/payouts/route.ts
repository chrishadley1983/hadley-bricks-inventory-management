import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const QuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  status: z.string().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  sortBy: z.enum(['payout_date', 'amount']).default('payout_date'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

/**
 * GET /api/ebay/payouts
 * Query eBay payouts with filtering and pagination
 */
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

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const params = {
      page: searchParams.get('page'),
      pageSize: searchParams.get('pageSize'),
      status: searchParams.get('status'),
      fromDate: searchParams.get('fromDate'),
      toDate: searchParams.get('toDate'),
      sortBy: searchParams.get('sortBy'),
      sortOrder: searchParams.get('sortOrder'),
    };

    const parsed = QuerySchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { page, pageSize, status, fromDate, toDate, sortBy, sortOrder } = parsed.data;

    // Build query
    let query = supabase
      .from('ebay_payouts')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id);

    // Apply filters
    if (status) {
      query = query.eq('payout_status', status);
    }

    if (fromDate) {
      query = query.gte('payout_date', fromDate);
    }

    if (toDate) {
      query = query.lte('payout_date', toDate);
    }

    // Apply sorting
    query = query.order(sortBy, { ascending: sortOrder === 'asc' });

    // Apply pagination
    const offset = (page - 1) * pageSize;
    query = query.range(offset, offset + pageSize - 1);

    const { data: payouts, error, count } = await query;

    if (error) {
      console.error('[GET /api/ebay/payouts] Query error:', error);
      return NextResponse.json({ error: 'Failed to fetch payouts' }, { status: 500 });
    }

    return NextResponse.json({
      payouts: payouts || [],
      pagination: {
        page,
        pageSize,
        total: count || 0,
        totalPages: count ? Math.ceil(count / pageSize) : 0,
      },
    });
  } catch (error) {
    console.error('[GET /api/ebay/payouts] Error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch payouts',
      },
      { status: 500 }
    );
  }
}
