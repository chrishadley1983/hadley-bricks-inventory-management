/**
 * POST /api/purchases/review-queue/[id]/dismiss
 *
 * Dismiss a skipped email purchase (e.g., non-LEGO items like cardboard boxes).
 * Updates status from 'skipped' to 'manual_skip'.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const serviceSupabase = createServiceRoleClient();

    // Verify the record exists and is in skipped status
    const { data: emailRecord, error: fetchError } = await serviceSupabase
      .from('processed_purchase_emails')
      .select('id, status')
      .eq('id', id)
      .eq('status', 'skipped')
      .single();

    if (fetchError || !emailRecord) {
      return NextResponse.json(
        { error: 'Review item not found or already processed' },
        { status: 404 }
      );
    }

    // Update status to manual_skip
    const { error: updateError } = await serviceSupabase
      .from('processed_purchase_emails')
      .update({ status: 'manual_skip' })
      .eq('id', id);

    if (updateError) {
      return NextResponse.json(
        { error: `Failed to dismiss: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: { id, status: 'manual_skip' } });
  } catch (error) {
    console.error('[POST /api/purchases/review-queue/[id]/dismiss] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
