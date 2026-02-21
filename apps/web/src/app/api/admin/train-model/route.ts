/**
 * POST /api/admin/train-model
 *
 * Trains the TensorFlow.js investment prediction model using
 * historical appreciation data from investment_historical.
 *
 * Returns insufficient_data warning if < 50 samples available.
 * Saves model artifact to database on success.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { validateAuth } from '@/lib/api/validate-auth';
import { ModelTrainingService } from '@/lib/investment/ml';

export async function POST(request: NextRequest) {
  try {
    // Auth check (supports both session and API key)
    const auth = await validateAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use service role client for database operations
    const serviceClient = createServiceRoleClient();
    const trainingService = new ModelTrainingService(serviceClient);

    const result = await trainingService.train();

    if (result.status === 'insufficient_data') {
      return NextResponse.json(
        {
          status: 'insufficient_data',
          available_samples: result.available_samples,
          minimum_required: result.minimum_required,
          message: `Need at least ${result.minimum_required} training samples, only ${result.available_samples} available`,
          duration_ms: result.duration_ms,
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      status: 'success',
      message: `Model ${result.model_version} trained successfully`,
      metrics: result.metrics,
      training_samples: result.training_samples,
      holdout_samples: result.holdout_samples,
      model_version: result.model_version,
      duration_ms: result.duration_ms,
    });
  } catch (error) {
    console.error('[POST /api/admin/train-model] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
