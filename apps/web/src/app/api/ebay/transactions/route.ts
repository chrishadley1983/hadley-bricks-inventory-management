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

    const { page, pageSize, transactionType, fromDate, toDate, search, sortBy, sortOrder } = parsed.data;

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

    // Calculate summary totals from ALL matching transactions (not just current page)
    // We need to fetch all transactions matching the filters to calculate accurate totals
    // Use pagination to handle large datasets
    let totalSales = 0;
    let totalFees = 0;
    let totalRefunds = 0;
    const summaryPageSize = 1000;
    let summaryOffset = 0;
    let hasMore = true;

    while (hasMore) {
      let summaryQuery = supabase
        .from('ebay_transactions')
        .select('transaction_type, amount, total_fee_amount')
        .eq('user_id', user.id);

      // Apply same filters as main query
      if (transactionType) {
        summaryQuery = summaryQuery.eq('transaction_type', transactionType);
      }
      if (fromDate) {
        summaryQuery = summaryQuery.gte('transaction_date', fromDate);
      }
      if (toDate) {
        summaryQuery = summaryQuery.lte('transaction_date', toDate);
      }
      if (search) {
        summaryQuery = summaryQuery.or(
          `item_title.ilike.%${search}%,custom_label.ilike.%${search}%,ebay_order_id.ilike.%${search}%,buyer_username.ilike.%${search}%`
        );
      }

      summaryQuery = summaryQuery.range(summaryOffset, summaryOffset + summaryPageSize - 1);

      const { data: summaryData, error: summaryError } = await summaryQuery;

      if (summaryError) {
        console.error('[GET /api/ebay/transactions] Summary query error:', summaryError);
        break;
      }

      for (const tx of summaryData || []) {
        if (tx.transaction_type === 'SALE') {
          // Sales = gross amount (net amount + fees deducted)
          // This matches eBay's "Total sales" which includes item price + postage
          const netAmount = tx.amount || 0;
          const feesDeducted = Math.abs(tx.total_fee_amount || 0);
          totalSales += netAmount + feesDeducted; // Gross sales
          totalFees += feesDeducted; // Fees from sales
        } else if (tx.transaction_type === 'REFUND') {
          totalRefunds += Math.abs(tx.amount || 0);
        } else if (tx.transaction_type === 'NON_SALE_CHARGE') {
          // Standalone fee transactions (promoted listings, etc.)
          totalFees += Math.abs(tx.amount || 0);
        }
      }

      hasMore = (summaryData?.length || 0) === summaryPageSize;
      summaryOffset += summaryPageSize;
    }

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

