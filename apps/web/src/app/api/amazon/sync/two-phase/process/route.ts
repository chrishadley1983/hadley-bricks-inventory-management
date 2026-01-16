/**
 * Two-Phase Sync Background Processor API Route
 *
 * POST /api/amazon/sync/two-phase/process - Continue processing a two-phase sync
 *
 * This endpoint is called to continue processing after the price feed is submitted.
 * It handles:
 * 1. Polling for price feed completion
 * 2. Verifying price is live on Amazon
 * 3. Submitting quantity feed
 * 4. Sending notifications
 *
 * Can be called by:
 * - Client-side polling when user stays on page
 * - Vercel cron job for background processing
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { AmazonSyncService } from '@/lib/amazon/amazon-sync.service';

// ============================================================================
// SCHEMAS
// ============================================================================

const ProcessSchema = z.object({
  feedId: z.string().uuid(),
});

// ============================================================================
// POST - Process two-phase sync step
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = ProcessSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { feedId } = parsed.data;
    const service = new AmazonSyncService(supabase, user.id);

    // Process the next step of two-phase sync
    const result = await service.processTwoPhaseStep(feedId, user.email || '');

    return NextResponse.json({
      data: result,
      message: result.message,
    });
  } catch (error) {
    console.error('[POST /api/amazon/sync/two-phase/process] Error:', error);

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
