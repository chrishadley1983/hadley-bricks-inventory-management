/**
 * GET /api/investment/model-status
 *
 * Reports the state of the investment ML model for the dashboard:
 * artifact metrics (temporal-holdout Spearman/MAE per horizon), when it was
 * trained, when scoring last ran, and coverage counts. The artifact rides in
 * the `investment_historical` sentinel row (set_num = '__model_artifact__').
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { createServiceRoleClient } from '@/lib/supabase/server';

/** Scoring older than this is flagged stale on the dashboard. */
const STALE_SCORING_DAYS = 14;

interface HorizonMetrics {
  model_type: string;
  mae_pct: number;
  r_squared: number;
  spearman: number;
  baseline_mae_pct: number;
  beats_baseline: boolean;
  n_train: number;
  n_holdout: number;
}

export async function GET() {
  try {
    const { unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const supabase = createServiceRoleClient();

    const [artifactResult, predictionAgg, highConfCount, labelCount] = await Promise.all([
      supabase
        .from('investment_historical')
        .select('raw_data')
        .eq('set_num', '__model_artifact__')
        .maybeSingle(),
      supabase
        .from('investment_predictions')
        .select('scored_at, model_version', { count: 'exact' })
        .order('scored_at', { ascending: false })
        .limit(1),
      supabase
        .from('investment_predictions')
        .select('*', { count: 'exact', head: true })
        .gte('confidence', 0.49),
      supabase
        .from('investment_historical')
        .select('*', { count: 'exact', head: true })
        .neq('set_num', '__model_artifact__')
        .not('actual_1yr_appreciation', 'is', null),
    ]);

    if (artifactResult.error) {
      console.error(
        '[GET /api/investment/model-status] Artifact query error:',
        artifactResult.error.message
      );
      return NextResponse.json({ error: 'Database query failed' }, { status: 500 });
    }

    const artifact = (artifactResult.data?.raw_data ?? null) as Record<string, unknown> | null;
    const metrics = (artifact?.metrics ?? null) as {
      horizon_1yr?: HorizonMetrics;
      horizon_3yr?: HorizonMetrics;
      temporal_cutoff_date?: string;
    } | null;

    const latest = (predictionAgg.data?.[0] ?? null) as {
      scored_at: string | null;
      model_version: string | null;
    } | null;

    const lastScoredAt = latest?.scored_at ?? null;
    const scoringAgeDays = lastScoredAt
      ? Math.floor((Date.now() - new Date(lastScoredAt).getTime()) / 86_400_000)
      : null;

    return NextResponse.json({
      model_version: (artifact?.model_version as string) ?? latest?.model_version ?? null,
      trained_at: (artifact?.trained_at as string) ?? null,
      temporal_cutoff_date: metrics?.temporal_cutoff_date ?? null,
      horizon_1yr: metrics?.horizon_1yr ?? null,
      horizon_3yr: metrics?.horizon_3yr ?? null,
      scored_sets: predictionAgg.count ?? 0,
      high_confidence_sets: highConfCount.count ?? 0,
      training_labels: labelCount.count ?? 0,
      last_scored_at: lastScoredAt,
      scoring_age_days: scoringAgeDays,
      scoring_stale: scoringAgeDays != null ? scoringAgeDays > STALE_SCORING_DAYS : true,
    });
  } catch (error) {
    console.error('[GET /api/investment/model-status] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
