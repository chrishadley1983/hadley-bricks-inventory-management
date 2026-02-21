import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const CompletePickupSchema = z.object({
  outcome: z.enum(['successful', 'partial', 'unsuccessful', 'rescheduled']),
  final_amount_paid: z.number().nullable().optional(),
  completion_notes: z.string().nullable().optional(),
  mileage: z.number().nullable().optional(),
});

/**
 * POST /api/pickups/[id]/complete
 * Complete a pickup with outcome details
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = CompletePickupSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Verify pickup exists and belongs to user
    const { data: existing } = await supabase
      .from('stock_pickups')
      .select('id, status')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: 'Pickup not found' }, { status: 404 });
    }

    if (existing.status === 'completed') {
      return NextResponse.json({ error: 'Pickup already completed' }, { status: 400 });
    }

    if (existing.status === 'cancelled') {
      return NextResponse.json({ error: 'Cannot complete a cancelled pickup' }, { status: 400 });
    }

    // Calculate mileage cost (using HMRC rate of £0.45/mile)
    const mileageCost = parsed.data.mileage ? parsed.data.mileage * 0.45 : null;

    const { data: pickup, error } = await supabase
      .from('stock_pickups')
      .update({
        status: 'completed',
        outcome: parsed.data.outcome,
        final_amount_paid: parsed.data.final_amount_paid,
        completion_notes: parsed.data.completion_notes,
        mileage: parsed.data.mileage,
        mileage_cost: mileageCost,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[POST /api/pickups/[id]/complete] Error:', error);
      return NextResponse.json({ error: 'Failed to complete pickup' }, { status: 500 });
    }

    return NextResponse.json({ pickup });
  } catch (error) {
    console.error('[POST /api/pickups/[id]/complete] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
