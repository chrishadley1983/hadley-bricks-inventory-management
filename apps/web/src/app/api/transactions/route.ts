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
  sortField: z.enum(['created', 'amount', 'merchant_name', 'description', 'local_category', 'user_notes']).default('created'),
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

    const { page, pageSize, search, category, localCategory, startDate, endDate, sortField, sortDirection } =
      params.data;

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

    // 4. Calculate period totals (same filters but paginate to handle 1000 row limit)
    let totalIncome = 0;
    let totalExpenses = 0;
    let summaryPage = 0;
    const summaryPageSize = 1000;
    let hasMoreSummary = true;

    while (hasMoreSummary) {
      let summaryQuery = supabase
        .from('monzo_transactions')
        .select('amount')
        .eq('user_id', user.id);

      // Apply same filters for summary
      if (search) {
        summaryQuery = summaryQuery.or(`description.ilike.%${search}%,merchant_name.ilike.%${search}%`);
      }
      if (category) {
        summaryQuery = summaryQuery.eq('category', category);
      }
      if (localCategory) {
        summaryQuery = summaryQuery.eq('local_category', localCategory);
      }
      if (startDate) {
        summaryQuery = summaryQuery.gte('created', startDate);
      }
      if (endDate) {
        summaryQuery = summaryQuery.lte('created', endDate);
      }

      summaryQuery = summaryQuery.range(summaryPage * summaryPageSize, (summaryPage + 1) * summaryPageSize - 1);

      const { data: summaryData, error: summaryError } = await summaryQuery;

      if (!summaryError && summaryData) {
        for (const row of summaryData) {
          if (row.amount > 0) {
            totalIncome += row.amount;
          } else {
            totalExpenses += Math.abs(row.amount);
          }
        }
      }

      hasMoreSummary = (summaryData?.length ?? 0) === summaryPageSize;
      summaryPage++;
    }

    // 5. Get distinct local_category values from all user's transactions
    // Paginate to handle Supabase 1000 row limit
    const categorySet = new Set<string>();
    let categoryPage = 0;
    const categoryPageSize = 1000;
    let hasMoreCategories = true;

    while (hasMoreCategories) {
      const { data: localCategoryData } = await supabase
        .from('monzo_transactions')
        .select('local_category')
        .eq('user_id', user.id)
        .not('local_category', 'is', null)
        .not('local_category', 'eq', '')
        .range(categoryPage * categoryPageSize, (categoryPage + 1) * categoryPageSize - 1);

      if (localCategoryData) {
        for (const row of localCategoryData) {
          if (row.local_category) {
            categorySet.add(row.local_category);
          }
        }
      }

      hasMoreCategories = (localCategoryData?.length ?? 0) === categoryPageSize;
      categoryPage++;
    }

    const categories = [...categorySet].sort();

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
