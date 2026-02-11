/**
 * POST /api/purchases/review-queue/bulk-dismiss
 *
 * Dismiss multiple skipped email purchases at once.
 * Updates status from 'skipped' to 'manual_skip' for all provided IDs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

const BulkDismissSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'At least one ID is required'),
});

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
    const parsed = BulkDismissSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { ids } = parsed.data;
    const serviceSupabase = createServiceRoleClient();

    const { data, error: updateError } = await serviceSupabase
      .from('processed_purchase_emails')
      .update({ status: 'manual_skip' })
      .in('id', ids)
      .eq('status', 'skipped')
      .select('id');

    if (updateError) {
      return NextResponse.json(
        { error: `Failed to dismiss: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: {
        dismissed_count: data?.length ?? 0,
        ids: data?.map((d) => d.id) ?? [],
      },
    });
  } catch (error) {
    console.error('[POST /api/purchases/review-queue/bulk-dismiss] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
