/**
 * POST /api/admin/score-investments
 *
 * Runs the investment scoring pipeline for all eligible sets
 * (retirement_status IN ('available', 'retiring_soon')).
 *
 * Uses ML model if available, falls back to rule-based scoring.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { InvestmentScoringService } from '@/lib/investment';

export async function POST(_request: NextRequest) {
  try {
    // Auth check
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const serviceClient = createServiceRoleClient();
    const scoringService = new InvestmentScoringService(serviceClient);

    const result = await scoringService.scoreAll();

    return NextResponse.json({
      success: true,
      message: `Scored ${result.sets_scored} sets${result.used_fallback ? ' (rule-based fallback)' : ''}`,
      stats: {
        sets_scored: result.sets_scored,
        errors: result.errors,
        model_version: result.model_version,
        used_fallback: result.used_fallback,
        duration_ms: result.duration_ms,
      },
    });
  } catch (error) {
    console.error('[POST /api/admin/score-investments] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
