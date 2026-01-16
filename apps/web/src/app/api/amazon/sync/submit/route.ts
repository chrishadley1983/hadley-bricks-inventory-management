/**
 * Amazon Sync Submit API Route
 *
 * POST /api/amazon/sync/submit - Submit queue to Amazon
 *
 * Supports two sync modes:
 * - single: Submit price and quantity in one feed (default)
 * - two_phase: Submit price first, verify it's live, then submit quantity
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { AmazonSyncService } from '@/lib/amazon/amazon-sync.service';

// ============================================================================
// SCHEMAS
// ============================================================================

const SubmitSchema = z.object({
  dryRun: z.boolean().default(false),
  syncMode: z.enum(['single', 'two_phase']).default('single'),
  priceVerificationTimeout: z.number().optional(),
  priceVerificationInterval: z.number().optional(),
});

// ============================================================================
// POST - Submit queue to Amazon
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
    const parsed = SubmitSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { dryRun, syncMode, priceVerificationTimeout, priceVerificationInterval } = parsed.data;
    const service = new AmazonSyncService(supabase, user.id);

    if (syncMode === 'two_phase') {
      // Two-phase sync: price first, verify, then quantity
      // Requires user email for notifications
      const result = await service.submitTwoPhaseFeed({
        dryRun,
        userEmail: user.email || '',
        priceVerificationTimeout,
        priceVerificationInterval,
      });

      const message =
        result.status === 'completed'
          ? 'Two-phase sync completed successfully'
          : result.status === 'failed'
            ? result.error || 'Two-phase sync failed'
            : dryRun
              ? 'Validation completed'
              : 'Two-phase sync in progress';

      return NextResponse.json(
        {
          data: { result },
          message,
        },
        { status: 201 }
      );
    }

    // Single-phase sync (default): price and quantity in one feed
    const feed = await service.submitFeed(dryRun);

    const message = dryRun ? 'Validation completed' : 'Feed submitted to Amazon';

    return NextResponse.json(
      {
        data: { feed },
        message,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/amazon/sync/submit] Error:', error);

    if (error instanceof Error) {
      // Return user-friendly errors
      if (
        error.message.includes('No items in the sync queue') ||
        error.message.includes('credentials not configured')
      ) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
