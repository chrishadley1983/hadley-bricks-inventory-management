import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ListingActionsService } from '@/lib/minifig-sync/listing-actions.service';

export const runtime = 'nodejs';

const RequestSchema = z.object({
  itemId: z.string().uuid(),
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

    const service = new ListingActionsService(supabase, user.id);
    await service.reject(parsed.data.itemId);

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error('[POST /api/minifigs/sync/dismiss] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to dismiss listing',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
