/**
 * Transactions List Route
 *
 * GET /api/transactions - List transactions with pagination and filtering
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

// Query parameters schema
const QuerySchema = z.object({
  platform: z.enum(['monzo']).optional(), // Future: 'ebay', 'paypal', 'amazon'
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  category: z.string().optional(),
  localCategory: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  sortField: z
    .enum(['created', 'amount', 'merchant_name', 'description', 'local_category', 'user_notes'])
    .default('created'),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
});

export async function GET(request: NextRequest) {
  try {
    // 1. Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Parse query parameters
    const { searchParams } = new URL(request.url);
    const params = QuerySchema.safeParse({
      platform: searchParams.get('platform') || undefined,
      page: searchParams.get('page') || 1,
      pageSize: searchParams.get('pageSize') || 50,
      search: searchParams.get('search') || undefined,
      category: searchParams.get('category') || undefined,
      localCategory: searchParams.get('localCategory') || undefined,
      startDate: searchParams.get('startDate') || undefined,
      endDate: searchParams.get('endDate') || undefined,
      sortField: searchParams.get('sortField') || 'created',
      sortDirection: searchParams.get('sortDirection') || 'desc',
    });

    if (!params.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: params.error.flatten() },
        { status: 400 }
      );
    }

    const {
      page,
      pageSize,
      search,
      category,
      localCategory,
      startDate,
      endDate,
      sortField,
      sortDirection,
    } = params.data;

    // 3. Build query for Monzo transactions
    // TODO: Add support for other platforms when implemented
    let query = supabase
      .from('monzo_transactions')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id);

    // Apply filters
    if (search) {
      query = query.or(`description.ilike.%${search}%,merchant_name.ilike.%${search}%`);
    }
    if (category) {
      query = query.eq('category', category);
    }
    if (localCategory) {
      query = query.eq('local_category', localCategory);
    }
    if (startDate) {
      query = query.gte('created', startDate);
    }
    if (endDate) {
      query = query.lte('created', endDate);
    }

    // Apply sorting
    query = query.order(sortField, { ascending: sortDirection === 'asc', nullsFirst: false });

    // Apply pagination
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);

    const { data, count, error } = await query;

    if (error) {
      console.error('[GET /api/transactions] Database error:', error);
      return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
    }

    // 4. Calculate period totals using server-side SQL aggregation
    // This replaces the client-side loop that fetched all data in batches
    const { data: summaryResult, error: summaryError } = await supabase.rpc(
      'calculate_monzo_transaction_summary',
      {
        p_user_id: user.id,
        p_category: category || undefined,
        p_local_category: localCategory || undefined,
        p_start_date: startDate || undefined,
        p_end_date: endDate || undefined,
        p_search: search || undefined,
      }
    );

    if (summaryError) {
      console.error('[GET /api/transactions] Summary RPC error:', summaryError);
    }

    // Extract summary values (RPC returns an array with one row)
    const summaryRow = summaryResult?.[0] || {
      total_income: 0,
      total_expenses: 0,
    };
    const totalIncome = Number(summaryRow.total_income) || 0;
    const totalExpenses = Number(summaryRow.total_expenses) || 0;

    // 5. Get distinct local_category values using SQL aggregation
    // This replaces the client-side loop with DISTINCT query
    const { data: categoryResult, error: categoryError } = await supabase.rpc(
      'get_monzo_local_categories',
      {
        p_user_id: user.id,
      }
    );

    if (categoryError) {
      console.error('[GET /api/transactions] Categories RPC error:', categoryError);
    }

    const categories = (categoryResult || []).map(
      (row: { local_category: string }) => row.local_category
    );

    // 6. Return paginated results with summary and categories
    return NextResponse.json({
      data: {
        transactions: data || [],
        pagination: {
          page,
          pageSize,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / pageSize),
        },
        summary: {
          totalIncome,
          totalExpenses,
        },
        categories,
      },
    });
  } catch (error) {
    console.error('[GET /api/transactions] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
