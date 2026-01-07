import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const QuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  sortBy: z.enum(['transaction_date', 'fee_amount', 'gross_amount', 'payer_name']).default('transaction_date'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

/**
 * GET /api/paypal/transactions
 * Query PayPal transactions with filtering and pagination
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
    const searchParams = request.nextUrl.searchParams;
    const params = {
      page: searchParams.get('page') || '1',
      pageSize: searchParams.get('pageSize') || '50',
      search: searchParams.get('search') || undefined,
      fromDate: searchParams.get('fromDate') || undefined,
      toDate: searchParams.get('toDate') || undefined,
      sortBy: searchParams.get('sortBy') || 'transaction_date',
      sortOrder: searchParams.get('sortOrder') || 'desc',
    };

    const parsed = QuerySchema.safeParse(params);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { page, pageSize, search, fromDate, toDate, sortBy, sortOrder } = parsed.data;

    // Build query
    let query = supabase
      .from('paypal_transactions')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id);

    // Apply date filters
    if (fromDate) {
      query = query.gte('transaction_date', new Date(fromDate).toISOString());
    }
    if (toDate) {
      const endDate = new Date(toDate);
      endDate.setDate(endDate.getDate() + 1); // Include the entire end date
      query = query.lt('transaction_date', endDate.toISOString());
    }

    // Apply search filter
    if (search) {
      query = query.or(
        `description.ilike.%${search}%,payer_name.ilike.%${search}%,from_email.ilike.%${search}%,paypal_transaction_id.ilike.%${search}%,invoice_id.ilike.%${search}%`
      );
    }

    // Apply sorting
    query = query.order(sortBy, { ascending: sortOrder === 'asc' });

    // Apply pagination
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);

    const { data: transactions, error, count } = await query;

    if (error) {
      console.error('[GET /api/paypal/transactions] Error:', error);
      return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
    }

    // Calculate summary (for all matching records, not just current page)
    let summaryQuery = supabase
      .from('paypal_transactions')
      .select('fee_amount, gross_amount')
      .eq('user_id', user.id);

    if (fromDate) {
      summaryQuery = summaryQuery.gte('transaction_date', new Date(fromDate).toISOString());
    }
    if (toDate) {
      const endDate = new Date(toDate);
      endDate.setDate(endDate.getDate() + 1);
      summaryQuery = summaryQuery.lt('transaction_date', endDate.toISOString());
    }
    if (search) {
      summaryQuery = summaryQuery.or(
        `description.ilike.%${search}%,payer_name.ilike.%${search}%,from_email.ilike.%${search}%,paypal_transaction_id.ilike.%${search}%,invoice_id.ilike.%${search}%`
      );
    }

    const { data: summaryData } = await summaryQuery;

    // Calculate totals
    const summary = {
      totalFees: (summaryData || []).reduce((sum, tx) => sum + Number(tx.fee_amount || 0), 0),
      totalGross: (summaryData || []).reduce((sum, tx) => sum + Number(tx.gross_amount || 0), 0),
      transactionCount: count || 0,
    };

    return NextResponse.json({
      transactions: transactions || [],
      pagination: {
        page,
        pageSize,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / pageSize),
      },
      summary,
    });
  } catch (error) {
    console.error('[GET /api/paypal/transactions] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
