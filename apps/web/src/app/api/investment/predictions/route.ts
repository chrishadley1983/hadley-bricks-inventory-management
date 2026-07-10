/**
 * GET /api/investment/predictions
 *
 * Returns paginated investment predictions sorted by score descending, each
 * enriched with set metadata and a max-buy price (shared house formula).
 * Supports filters: minScore, minConfidence, retiringWithinMonths, theme.
 *
 * Filters that live on brickset_sets (theme, retirement window) are applied
 * BEFORE pagination so page counts and totals stay correct — the old version
 * filtered the enrichment query instead, silently dropping cards while still
 * reporting the unfiltered total.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { fetchAllRecords } from '@/lib/supabase/pagination';
import { computeMaxBuy } from '@/lib/investment/max-buy';
import { z } from 'zod';

const QuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  minScore: z.coerce.number().min(1).max(10).optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
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

    const { page, pageSize, minScore, minConfidence, retiringWithinMonths, theme } = parsed.data;

    const { supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    // Fetch ALL matching predictions (bounded: only scored sets ever have rows),
    // then join set metadata and filter before paginating so totals are honest.
    const predictionRows = (await fetchAllRecords(supabase, 'investment_predictions', {
      select: '*',
      gte: {
        ...(minScore != null ? { investment_score: minScore } : {}),
        ...(minConfidence != null ? { confidence: minConfidence } : {}),
      },
      orderBy: [
        { column: 'investment_score', ascending: false },
        { column: 'set_num', ascending: true },
      ],
    })) as unknown as Record<string, unknown>[];

    // Set metadata for every predicted set, in chunks (no FK, so no embed join)
    const setNums = predictionRows.map((p) => p.set_num as string);
    const setMap = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < setNums.length; i += 200) {
      const { data: sets, error } = await supabase
        .from('brickset_sets')
        .select(
          'set_number, set_name, theme, year_from, pieces, uk_retail_price, retirement_status, expected_retirement_date, retirement_confidence, exclusivity_tier, image_url, has_amazon_listing'
        )
        .in('set_number', setNums.slice(i, i + 200));
      if (error) {
        console.error('[GET /api/investment/predictions] Set join error:', error.message);
        return NextResponse.json({ error: 'Database query failed' }, { status: 500 });
      }
      for (const s of (sets ?? []) as unknown as Record<string, unknown>[]) {
        setMap.set(s.set_number as string, s);
      }
    }

    let retirementCutoff: string | null = null;
    const today = new Date().toISOString().split('T')[0];
    if (retiringWithinMonths) {
      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() + retiringWithinMonths);
      retirementCutoff = cutoffDate.toISOString().split('T')[0];
    }

    const filtered = predictionRows.filter((p) => {
      const set = setMap.get(p.set_num as string);
      if (!set) return false;
      if (theme && !(set.theme as string | null)?.toLowerCase().includes(theme.toLowerCase())) {
        return false;
      }
      if (retirementCutoff) {
        const expected = set.expected_retirement_date as string | null;
        if (!expected || expected < today || expected > retirementCutoff) return false;
      }
      return true;
    });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

    const enriched = pageRows.map((p) => {
      const set = setMap.get(p.set_num as string)!;
      const rrp = set.uk_retail_price as number | null;
      const maxBuy =
        rrp != null && p.predicted_1yr_appreciation != null
          ? computeMaxBuy({
              rrp,
              predicted1yrAppreciationPct: Number(p.predicted_1yr_appreciation),
              confidence: Number(p.confidence ?? 0),
              riskFactors: (p.risk_factors as string[] | null) ?? [],
            })
          : null;

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
        max_buy: maxBuy,
      };
    });

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
