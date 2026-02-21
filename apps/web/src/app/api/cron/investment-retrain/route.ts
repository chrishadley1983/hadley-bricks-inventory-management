/**
 * POST /api/cron/investment-retrain
 *
 * Monthly cron endpoint that:
 * 1. Recalculates historical appreciation data for retired sets
 * 2. Retrains the TensorFlow.js ML model with latest data
 * 3. Re-scores all active sets with the new model
 *
 * Protected by CRON_SECRET header.
 * Designed to be called by Vercel Cron or similar scheduler.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { HistoricalAppreciationService } from '@/lib/investment';
import { ModelTrainingService } from '@/lib/investment/ml';
import { InvestmentScoringService } from '@/lib/investment';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';

export async function POST(request: NextRequest) {
  let execution: ExecutionHandle = noopHandle;
  try {
    // Verify CRON_SECRET
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    execution = await jobExecutionService.start('investment-retrain', 'cron');

    const startTime = Date.now();
    const supabase = createServiceRoleClient();

    // Step 1: Recalculate historical appreciation
    console.log('[InvestmentRetrain] Step 1: Calculating historical appreciation...');
    const historicalService = new HistoricalAppreciationService(supabase);
    const historicalResult = await historicalService.calculateAll();

    // Step 2: Retrain model
    console.log('[InvestmentRetrain] Step 2: Training model...');
    const trainingService = new ModelTrainingService(supabase);
    const trainingResult = await trainingService.train();

    // Step 3: Re-score all active sets
    console.log('[InvestmentRetrain] Step 3: Scoring all sets...');
    const scoringService = new InvestmentScoringService(supabase);
    const scoringResult = await scoringService.scoreAll();

    const totalDuration = Date.now() - startTime;

    console.log(`[InvestmentRetrain] Complete in ${totalDuration}ms`);

    await execution.complete(
      {
        historical_calculated: historicalResult.calculated,
        model_status: trainingResult.status,
        sets_scored: scoringResult.sets_scored,
      },
      200,
      scoringResult.sets_scored,
      historicalResult.errors
    );

    return NextResponse.json({
      success: true,
      historical_updated: {
        total_retired_sets: historicalResult.total_retired_sets,
        calculated: historicalResult.calculated,
        insufficient_data: historicalResult.insufficient_data,
        errors: historicalResult.errors,
        duration_ms: historicalResult.duration_ms,
      },
      model_metrics:
        trainingResult.status === 'success'
          ? {
              status: 'success',
              metrics: trainingResult.metrics,
              training_samples: trainingResult.training_samples,
              holdout_samples: trainingResult.holdout_samples,
            }
          : {
              status: trainingResult.status,
              available_samples: trainingResult.available_samples,
              minimum_required: trainingResult.minimum_required,
            },
      sets_scored: scoringResult.sets_scored,
      model_version: trainingResult.model_version ?? scoringResult.model_version,
      duration_ms: totalDuration,
    });
  } catch (error) {
    console.error('[POST /api/cron/investment-retrain] Error:', error);
    await execution.fail(error, 500);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
