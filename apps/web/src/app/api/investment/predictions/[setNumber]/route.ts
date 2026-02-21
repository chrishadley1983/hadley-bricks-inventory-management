/**
 * GET /api/investment/predictions/[setNumber]
 *
 * Returns the investment prediction for a single set.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ setNumber: string }> }
) {
  try {
    const { setNumber } = await params;
    const decodedSetNumber = decodeURIComponent(setNumber);

    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('investment_predictions')
      .select('*')
      .eq('set_num', decodedSetNumber)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: `No prediction found for set ${decodedSetNumber}` },
        { status: 404 }
      );
    }

    const pred = data as Record<string, unknown>;

    return NextResponse.json({
      set_num: pred.set_num,
      investment_score: pred.investment_score,
      predicted_1yr_appreciation: pred.predicted_1yr_appreciation,
      predicted_3yr_appreciation: pred.predicted_3yr_appreciation,
      predicted_1yr_price_gbp: pred.predicted_1yr_price_gbp,
      predicted_3yr_price_gbp: pred.predicted_3yr_price_gbp,
      confidence: pred.confidence,
      risk_factors: pred.risk_factors,
      amazon_viable: pred.amazon_viable,
      model_version: pred.model_version,
      scored_at: pred.scored_at,
    });
  } catch (error) {
    console.error('[GET /api/investment/predictions/[setNumber]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
