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
        { status: 400 },
      );
    }

    const { error } = await supabase
      .from('minifig_removal_queue')
      .update({
        status: 'DISMISSED',
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', parsed.data.removalId)
      .eq('user_id', user.id)
      .eq('status', 'PENDING');

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error('[POST /api/minifigs/sync/removals/dismiss] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to dismiss removal',
        details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
      },
      { status: 500 },
    );
  }
}
