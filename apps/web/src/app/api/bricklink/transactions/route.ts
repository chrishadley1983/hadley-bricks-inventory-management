/**
 * BrickLink Transactions Query API
 *
 * GET /api/bricklink/transactions
 * Query BrickLink transactions with filtering, sorting, and pagination
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { BrickLinkTransactionsResponse } from '@/lib/bricklink';

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
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)));
    const search = searchParams.get('search') || '';
    const fromDate = searchParams.get('fromDate') || '';
    const toDate = searchParams.get('toDate') || '';
    const status = searchParams.get('status') || '';
    const sortBy = searchParams.get('sortBy') || 'order_date';
    const sortOrder = (searchParams.get('sortOrder') || 'desc') as 'asc' | 'desc';

    // Build query
    let query = supabase
      .from('bricklink_transactions')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id);

    // Apply search filter (buyer name, order ID, buyer location)
    if (search) {
      query = query.or(
        `buyer_name.ilike.%${search}%,bricklink_order_id.ilike.%${search}%,buyer_location.ilike.%${search}%,buyer_email.ilike.%${search}%`
      );
    }

    // Apply date filters
    if (fromDate) {
      query = query.gte('order_date', fromDate);
    }
    if (toDate) {
      query = query.lte('order_date', toDate);
    }

    // Apply status filter
    if (status) {
      query = query.eq('order_status', status);
    }

    // Apply sorting
    const validSortColumns = [
      'order_date',
      'buyer_name',
      'order_status',
      'base_grand_total',
      'order_total',
      'shipping',
      'tax',
    ];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'order_date';
    query = query.order(sortColumn, { ascending: sortOrder === 'asc' });

    // Apply pagination
    const offset = (page - 1) * pageSize;
    query = query.range(offset, offset + pageSize - 1);

    // Execute query
    const { data: transactions, count, error } = await query;

    if (error) {
      console.error('[GET /api/bricklink/transactions] Query error:', error);
      return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
    }

    // Calculate summary for ALL matching records (not just current page)
    let summaryQuery = supabase
      .from('bricklink_transactions')
      .select('order_total, shipping, insurance, add_charge_1, add_charge_2, tax, base_grand_total')
      .eq('user_id', user.id);

    // Apply same filters for summary
    if (search) {
      summaryQuery = summaryQuery.or(
        `buyer_name.ilike.%${search}%,bricklink_order_id.ilike.%${search}%,buyer_location.ilike.%${search}%,buyer_email.ilike.%${search}%`
      );
    }
    if (fromDate) {
      summaryQuery = summaryQuery.gte('order_date', fromDate);
    }
    if (toDate) {
      summaryQuery = summaryQuery.lte('order_date', toDate);
    }
    if (status) {
      summaryQuery = summaryQuery.eq('order_status', status);
    }

    const { data: summaryData } = await summaryQuery;

    // Calculate totals
    const summary = {
      totalSales: 0,
      totalShipping: 0,
      totalTax: 0,
      totalGrandTotal: 0,
      transactionCount: count ?? 0,
    };

    if (summaryData) {
      for (const row of summaryData) {
        summary.totalSales += Number(row.order_total) || 0;
        summary.totalShipping +=
          (Number(row.shipping) || 0) +
          (Number(row.insurance) || 0) +
          (Number(row.add_charge_1) || 0) +
          (Number(row.add_charge_2) || 0);
        summary.totalTax += Number(row.tax) || 0;
        summary.totalGrandTotal += Number(row.base_grand_total) || 0;
      }
    }

    // Transform transactions to ensure non-null numeric values
    const transformedTransactions = (transactions ?? []).map((t) => ({
      ...t,
      shipping: t.shipping ?? 0,
      insurance: t.insurance ?? 0,
      add_charge_1: t.add_charge_1 ?? 0,
      add_charge_2: t.add_charge_2 ?? 0,
      credit: t.credit ?? 0,
      coupon_credit: t.coupon_credit ?? 0,
      order_total: t.order_total ?? 0,
      tax: t.tax ?? 0,
      base_grand_total: t.base_grand_total ?? 0,
      total_lots: t.total_lots ?? 0,
      total_items: t.total_items ?? 0,
    }));

    const response: BrickLinkTransactionsResponse = {
      transactions: transformedTransactions,
      pagination: {
        page,
        pageSize,
        total: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / pageSize),
      },
      summary,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[GET /api/bricklink/transactions] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
