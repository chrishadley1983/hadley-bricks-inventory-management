import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const QuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  transactionType: z.string().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['transaction_date', 'amount', 'item_title']).default('transaction_date'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

/**
 * GET /api/ebay/transactions
 * Query eBay transactions with filtering and pagination
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
      page: searchParams.get('page') ?? undefined,
      pageSize: searchParams.get('pageSize') ?? undefined,
      transactionType: searchParams.get('transactionType') ?? undefined,
      fromDate: searchParams.get('fromDate') ?? undefined,
      toDate: searchParams.get('toDate') ?? undefined,
      search: searchParams.get('search') ?? undefined,
      sortBy: searchParams.get('sortBy') ?? undefined,
      sortOrder: searchParams.get('sortOrder') ?? undefined,
    };

    const parsed = QuerySchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { page, pageSize, transactionType, fromDate, toDate, search, sortBy, sortOrder } =
      parsed.data;

    // Build query
    let query = supabase
      .from('ebay_transactions')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id);

    // Apply filters
    if (transactionType) {
      query = query.eq('transaction_type', transactionType);
    }

    if (fromDate) {
      query = query.gte('transaction_date', fromDate);
    }

    if (toDate) {
      query = query.lte('transaction_date', toDate);
    }

    if (search) {
      // Search in item_title, custom_label, ebay_order_id, buyer_username
      query = query.or(
        `item_title.ilike.%${search}%,custom_label.ilike.%${search}%,ebay_order_id.ilike.%${search}%,buyer_username.ilike.%${search}%`
      );
    }

    // Apply sorting
    query = query.order(sortBy, { ascending: sortOrder === 'asc' });

    // Apply pagination
    const offset = (page - 1) * pageSize;
    query = query.range(offset, offset + pageSize - 1);

    const { data: transactions, error, count } = await query;

    if (error) {
      console.error('[GET /api/ebay/transactions] Query error:', error);
      return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
    }

    // Calculate summary totals using server-side SQL aggregation
    // This replaces the client-side loop that fetched all data in batches
    const { data: summaryResult, error: summaryError } = await supabase.rpc(
      'calculate_ebay_transaction_summary',
      {
        p_user_id: user.id,
        p_transaction_type: transactionType || undefined,
        p_from_date: fromDate || undefined,
        p_to_date: toDate || undefined,
        p_search: search || undefined,
      }
    );

    if (summaryError) {
      console.error('[GET /api/ebay/transactions] Summary RPC error:', summaryError);
    }

    // Extract summary values (RPC returns an array with one row)
    const summary = summaryResult?.[0] || {
      total_sales: 0,
      total_fees: 0,
      total_refunds: 0,
    };
    const totalSales = Number(summary.total_sales) || 0;
    const totalFees = Number(summary.total_fees) || 0;
    const totalRefunds = Number(summary.total_refunds) || 0;

    return NextResponse.json({
      transactions: transactions || [],
      pagination: {
        page,
        pageSize,
        total: count || 0,
        totalPages: count ? Math.ceil(count / pageSize) : 0,
      },
      summary: {
        totalSales,
        totalFees,
        totalRefunds,
        netRevenue: totalSales - totalRefunds - totalFees,
      },
    });
  } catch (error) {
    console.error('[GET /api/ebay/transactions] Error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch transactions',
      },
      { status: 500 }
    );
  }
}
