import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const RequestSchema = z.object({
  removalId: z.string().uuid(),
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
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Fetch the removal to get the linked sync item (CR-013)
    const { data: removal, error: fetchError } = await supabase
      .from('minifig_removal_queue')
      .select('id, minifig_sync_id')
      .eq('id', parsed.data.removalId)
      .eq('user_id', user.id)
      .eq('status', 'PENDING')
      .single();

    if (fetchError || !removal) {
      return NextResponse.json(
        { error: 'Removal not found or already processed' },
        { status: 404 }
      );
    }

    const now = new Date().toISOString();

    // Mark removal as dismissed
    const { error } = await supabase
      .from('minifig_removal_queue')
      .update({
        status: 'DISMISSED',
        reviewed_at: now,
      })
      .eq('id', removal.id)
      .eq('user_id', user.id);

    if (error) {
      throw new Error(error.message);
    }

    // Revert sync item status back to PUBLISHED (CR-013)
    await supabase
      .from('minifig_sync_items')
      .update({
        listing_status: 'PUBLISHED',
        updated_at: now,
      })
      .eq('id', removal.minifig_sync_id)
      .eq('user_id', user.id);

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error('[POST /api/minifigs/sync/removals/dismiss] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to dismiss removal',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 }
    );
  }
}
