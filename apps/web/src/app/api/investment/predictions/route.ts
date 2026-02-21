/**
 * GET /api/investment/predictions
 *
 * Returns paginated investment predictions sorted by score descending.
 * Supports filters: minScore, retiringWithinMonths, theme.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const QuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  minScore: z.coerce.number().min(1).max(10).optional(),
  retiringWithinMonths: z.coerce.number().min(1).max(36).optional(),
  theme: z.string().optional(),
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

    const { page, pageSize, minScore, retiringWithinMonths, theme } = parsed.data;

    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch predictions
    let query = supabase
      .from('investment_predictions')
      .select('*', { count: 'exact' })
      .order('investment_score', { ascending: false });

    if (minScore) {
      query = query.gte('investment_score', minScore);
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);

    const { data: predictions, error, count } = await query;

    if (error) {
      console.error('[GET /api/investment/predictions] Query error:', error.message);
      return NextResponse.json({ error: 'Database query failed' }, { status: 500 });
    }

    const predictionRows = (predictions ?? []) as unknown as Record<string, unknown>[];

    // Enrich with set data
    const setNums = predictionRows.map((p) => p.set_num as string);

    let setFilter = supabase
      .from('brickset_sets')
      .select(
        'set_number, set_name, theme, year_from, pieces, uk_retail_price, retirement_status, expected_retirement_date, exclusivity_tier, image_url, has_amazon_listing'
      )
      .in('set_number', setNums);

    if (theme) {
      setFilter = setFilter.ilike('theme', `%${theme}%`);
    }

    if (retiringWithinMonths) {
      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() + retiringWithinMonths);
      const today = new Date().toISOString().split('T')[0];
      const cutoff = cutoffDate.toISOString().split('T')[0];
      setFilter = setFilter
        .gte('expected_retirement_date' as string, today)
        .lte('expected_retirement_date' as string, cutoff);
    }

    const { data: sets } = await setFilter;
    const setMap = new Map<string, Record<string, unknown>>();
    for (const s of sets ?? []) {
      const r = s as unknown as Record<string, unknown>;
      setMap.set(r.set_number as string, r);
    }

    // Merge predictions with set data, filtering out unmatched
    const enriched = predictionRows
      .filter((p) => setMap.has(p.set_num as string))
      .map((p) => {
        const set = setMap.get(p.set_num as string)!;
        return {
          ...set,
          prediction: {
            set_num: p.set_num,
            investment_score: p.investment_score,
            predicted_1yr_appreciation: p.predicted_1yr_appreciation,
            predicted_3yr_appreciation: p.predicted_3yr_appreciation,
            predicted_1yr_price_gbp: p.predicted_1yr_price_gbp,
            predicted_3yr_price_gbp: p.predicted_3yr_price_gbp,
            confidence: p.confidence,
            risk_factors: p.risk_factors,
            amazon_viable: p.amazon_viable,
            model_version: p.model_version,
            scored_at: p.scored_at,
          },
          investment_score: p.investment_score,
        };
      });

    const total = count ?? 0;
    const totalPages = Math.ceil(total / pageSize);

    return NextResponse.json({
      data: enriched,
      total,
      page,
      pageSize,
      totalPages,
    });
  } catch (error) {
    console.error('[GET /api/investment/predictions] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
