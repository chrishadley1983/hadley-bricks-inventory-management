/**
 * GET /api/investment
 *
 * Returns investment-tracked LEGO sets with retirement data.
 * Supports filtering by retirement status, theme, year range, and "retiring within" timeframe.
 * Server-side pagination.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { z } from 'zod';

const QuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  retirementStatus: z.enum(['available', 'retiring_soon', 'retired']).optional(),
  theme: z.string().optional(),
  minYear: z.coerce.number().optional(),
  maxYear: z.coerce.number().optional(),
  retiringWithinMonths: z.coerce.number().min(1).max(36).optional(),
  sortBy: z.string().default('year_from'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export async function GET(request: NextRequest) {
  try {
    const queryParams = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = QuerySchema.safeParse(queryParams);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const {
      page,
      pageSize,
      search,
      retirementStatus,
      theme,
      minYear,
      maxYear,
      retiringWithinMonths,
      sortBy,
      sortOrder,
    } = parsed.data;

    const supabase = createServiceRoleClient();

    // Build query
    let query = supabase
      .from('brickset_sets')
      .select(
        'id, set_number, set_name, theme, subtheme, year_from, pieces, minifigs, uk_retail_price, retirement_status, expected_retirement_date, retirement_confidence, exclusivity_tier, is_licensed, is_ucs, is_modular, image_url, availability',
        { count: 'exact' }
      );

    // Apply filters
    if (search) {
      query = query.or(
        `set_number.ilike.%${search}%,set_name.ilike.%${search}%`
      );
    }

    if (retirementStatus) {
      query = query.eq('retirement_status', retirementStatus);
    }

    if (theme) {
      query = query.eq('theme', theme);
    }

    if (minYear) {
      query = query.gte('year_from', minYear);
    }

    if (maxYear) {
      query = query.lte('year_from', maxYear);
    }

    if (retiringWithinMonths) {
      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() + retiringWithinMonths);
      const today = new Date().toISOString().split('T')[0];
      const cutoff = cutoffDate.toISOString().split('T')[0];

      query = query
        .gte('expected_retirement_date', today)
        .lte('expected_retirement_date', cutoff);
    }

    // Apply sorting
    const ascending = sortOrder === 'asc';
    query = query.order(sortBy, { ascending, nullsFirst: false });

    // Apply pagination
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error) {
      console.error('[GET /api/investment] Query error:', error.message);
      return NextResponse.json(
        { error: 'Database query failed' },
        { status: 500 }
      );
    }

    const total = count ?? 0;
    const totalPages = Math.ceil(total / pageSize);

    return NextResponse.json({
      data: data ?? [],
      total,
      page,
      pageSize,
      totalPages,
    });
  } catch (error) {
    console.error('[GET /api/investment] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
