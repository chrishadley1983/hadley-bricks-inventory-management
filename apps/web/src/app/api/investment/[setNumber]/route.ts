/**
 * GET /api/investment/[setNumber]
 *
 * Returns detailed investment data for a single LEGO set including
 * Amazon pricing data from the latest snapshot.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ setNumber: string }> }
) {
  try {
    const { setNumber } = await params;
    const supabase = createServiceRoleClient();

    // Fetch set data
    // Note: Some columns added by investment migrations may not be in generated types yet
    const { data: rawSet, error: setError } = await supabase
      .from('brickset_sets')
      .select(
        'id, set_number, set_name, theme, subtheme, year_from, pieces, minifigs, uk_retail_price, retirement_status, expected_retirement_date, retirement_confidence, exclusivity_tier, is_licensed, is_ucs, is_modular, image_url, availability, amazon_asin, has_amazon_listing, classification_override'
      )
      .eq('set_number', setNumber)
      .single();

    if (setError || !rawSet) {
      return NextResponse.json({ error: 'Set not found' }, { status: 404 });
    }

    const set = rawSet as unknown as Record<string, unknown>;

    // Fetch latest Amazon pricing if ASIN exists
    let pricing = null;
    if (set.amazon_asin) {
      const { data: snapshot } = await supabase
        .from('amazon_arbitrage_pricing')
        .select(
          'buy_box_price, was_price_90d, sales_rank, offer_count, lowest_offer_price, total_offer_count, snapshot_date'
        )
        .eq('asin', set.amazon_asin as string)
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .single();

      if (snapshot) {
        const snap = snapshot as Record<string, unknown>;
        pricing = {
          buy_box_price: snap.buy_box_price as number | null,
          was_price: snap.was_price_90d as number | null,
          sales_rank: snap.sales_rank as number | null,
          offer_count: snap.offer_count as number | null,
          lowest_offer_price: snap.lowest_offer_price as number | null,
          total_offer_count: snap.total_offer_count as number | null,
          latest_snapshot_date: snap.snapshot_date as string | null,
        };
      }
    }

    // Fetch retirement sources - table may not be in generated types yet
    let retirementSources: unknown[] = [];
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: sources } = await (supabase as any)
        .from('retirement_sources')
        .select('source, expected_retirement_date, status, confidence, updated_at')
        .eq('set_num', setNumber);
      retirementSources = sources ?? [];
    } catch {
      // Table may not exist yet, ignore
    }

    // Fetch investment prediction
    let prediction = null;
    const { data: predData } = await supabase
      .from('investment_predictions')
      .select('*')
      .eq('set_num', setNumber)
      .single();

    if (predData) {
      const p = predData as Record<string, unknown>;
      prediction = {
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
      };
    }

    return NextResponse.json({
      ...set,
      pricing,
      retirement_sources: retirementSources,
      prediction,
      investment_score: prediction?.investment_score ?? null,
      predicted_1yr_appreciation: prediction?.predicted_1yr_appreciation ?? null,
      predicted_3yr_appreciation: prediction?.predicted_3yr_appreciation ?? null,
      confidence: prediction?.confidence ?? null,
    });
  } catch (error) {
    console.error('[GET /api/investment/[setNumber]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
