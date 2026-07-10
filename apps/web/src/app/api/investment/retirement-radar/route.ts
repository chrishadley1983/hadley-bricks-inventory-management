/**
 * GET /api/investment/retirement-radar
 *
 * The two retirement watchlists for the dashboard:
 *  - retiring:   sets expected to retire within `window` months (default 12)
 *  - retired:    sets that retired within the past `window` months, using
 *                COALESCE(exit_date, expected_retirement_date) as the actual
 *                retirement date (exit_date is the real Brickset exit date)
 *
 * Rows are enriched with the model prediction, a max-buy price where scored,
 * and the latest Amazon buy-box price so appreciation-underway is visible.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/require-user';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { computeMaxBuy } from '@/lib/investment/max-buy';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';

const QuerySchema = z.object({
  window: z.coerce.number().min(1).max(36).default(12),
  limit: z.coerce.number().min(1).max(200).default(60),
});

const SET_COLUMNS =
  'set_number, set_name, theme, year_from, pieces, uk_retail_price, retirement_status, expected_retirement_date, retirement_confidence, exit_date, image_url, amazon_asin';

interface RadarSet extends Record<string, unknown> {
  set_number: string;
  uk_retail_price: number | null;
  expected_retirement_date: string | null;
  exit_date: string | null;
  amazon_asin: string | null;
}

async function enrichRows(supabase: SupabaseClient<Database>, rows: RadarSet[]) {
  // Predictions + max buy
  const setNumbers = rows.map((r) => r.set_number);
  const predictionMap = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < setNumbers.length; i += 100) {
    const { data: predictions } = await supabase
      .from('investment_predictions')
      .select(
        'set_num, investment_score, predicted_1yr_appreciation, confidence, risk_factors'
      )
      .in('set_num', setNumbers.slice(i, i + 100));
    for (const p of (predictions ?? []) as unknown as Record<string, unknown>[]) {
      predictionMap.set(p.set_num as string, p);
    }
  }

  // Latest buy-box snapshot per ASIN (parallel batches, same as /api/investment)
  const asins = [...new Set(rows.map((r) => r.amazon_asin).filter(Boolean))] as string[];
  const buyBoxMap = new Map<string, number | null>();
  for (let i = 0; i < asins.length; i += 10) {
    const batch = asins.slice(i, i + 10);
    const results = await Promise.all(
      batch.map((asin) =>
        supabase
          .from('amazon_arbitrage_pricing')
          .select('asin, buy_box_price')
          .eq('asin', asin)
          .order('snapshot_date', { ascending: false })
          .limit(1)
          .maybeSingle()
      )
    );
    for (const result of results) {
      if (result.data) {
        const snap = result.data as Record<string, unknown>;
        buyBoxMap.set(snap.asin as string, snap.buy_box_price as number | null);
      }
    }
  }

  return rows.map((row) => {
    const prediction = predictionMap.get(row.set_number) ?? null;
    const rrp = row.uk_retail_price;
    const buyBox = row.amazon_asin ? (buyBoxMap.get(row.amazon_asin) ?? null) : null;

    const maxBuy =
      prediction && rrp
        ? computeMaxBuy({
            rrp,
            predicted1yrAppreciationPct: Number(prediction.predicted_1yr_appreciation),
            confidence: Number(prediction.confidence ?? 0),
            riskFactors: (prediction.risk_factors as string[] | null) ?? [],
          })
        : null;

    return {
      ...row,
      retirement_date: row.exit_date ?? row.expected_retirement_date,
      investment_score: prediction ? Number(prediction.investment_score) : null,
      predicted_1yr_appreciation: prediction
        ? (prediction.predicted_1yr_appreciation as number | null)
        : null,
      confidence: prediction ? Number(prediction.confidence ?? 0) : null,
      risk_factors: prediction ? ((prediction.risk_factors as string[] | null) ?? []) : null,
      buy_box_price: buyBox,
      buy_box_vs_rrp_pct:
        buyBox != null && rrp ? Math.round(((buyBox - rrp) / rrp) * 1000) / 10 : null,
      max_buy: maxBuy,
    };
  });
}

export async function GET(request: NextRequest) {
  try {
    const parsed = QuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { window, limit } = parsed.data;

    const { unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const supabase = createServiceRoleClient();

    const today = new Date().toISOString().split('T')[0];
    const forward = new Date();
    forward.setMonth(forward.getMonth() + window);
    const forwardCutoff = forward.toISOString().split('T')[0];
    const back = new Date();
    back.setMonth(back.getMonth() - window);
    const backCutoff = back.toISOString().split('T')[0];

    const [retiringResult, retiredResult] = await Promise.all([
      supabase
        .from('brickset_sets')
        .select(SET_COLUMNS, { count: 'exact' })
        .neq('retirement_status' as string, 'retired')
        .gte('expected_retirement_date' as string, today)
        .lte('expected_retirement_date' as string, forwardCutoff)
        .order('expected_retirement_date', { ascending: true })
        .limit(limit),
      // COALESCE(exit_date, expected_retirement_date) >= backCutoff, expressed
      // as an OR since PostgREST cannot order/filter on a computed coalesce
      supabase
        .from('brickset_sets')
        .select(SET_COLUMNS, { count: 'exact' })
        .eq('retirement_status' as string, 'retired')
        .or(
          `exit_date.gte.${backCutoff},and(exit_date.is.null,expected_retirement_date.gte.${backCutoff})`
        )
        .limit(1000),
    ]);

    if (retiringResult.error || retiredResult.error) {
      console.error(
        '[GET /api/investment/retirement-radar] Query error:',
        retiringResult.error?.message ?? retiredResult.error?.message
      );
      return NextResponse.json({ error: 'Database query failed' }, { status: 500 });
    }

    const retiringRows = (retiringResult.data ?? []) as unknown as RadarSet[];

    // Sort retired by actual retirement date (newest first) before capping
    const retiredFiltered = ((retiredResult.data ?? []) as unknown as RadarSet[])
      .map((r) => ({ ...r, _date: r.exit_date ?? r.expected_retirement_date ?? '' }))
      .filter((r) => r._date && r._date <= today)
      .sort((a, b) => b._date.localeCompare(a._date));
    const retiredRows = retiredFiltered.slice(0, limit);

    const [retiring, retired] = await Promise.all([
      enrichRows(supabase, retiringRows),
      enrichRows(supabase, retiredRows),
    ]);

    return NextResponse.json({
      window_months: window,
      retiring: {
        total: retiringResult.count ?? 0,
        data: retiring,
      },
      retired: {
        total: retiredFiltered.length,
        data: retired,
      },
    });
  } catch (error) {
    console.error('[GET /api/investment/retirement-radar] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
