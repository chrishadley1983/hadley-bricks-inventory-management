import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/pickups/[id]/cancel
 * Cancel a scheduled pickup
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
      return NextResponse.json({ error: 'Cannot cancel a completed pickup' }, { status: 400 });
    }

    if (existing.status === 'cancelled') {
      return NextResponse.json({ error: 'Pickup already cancelled' }, { status: 400 });
    }

    const { data: pickup, error } = await supabase
      .from('stock_pickups')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[POST /api/pickups/[id]/cancel] Error:', error);
      return NextResponse.json({ error: 'Failed to cancel pickup' }, { status: 500 });
    }

    return NextResponse.json({ pickup });
  } catch (error) {
    console.error('[POST /api/pickups/[id]/cancel] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
