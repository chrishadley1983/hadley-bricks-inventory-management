import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ListingActionsService } from '@/lib/minifig-sync/listing-actions.service';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const service = new ListingActionsService(supabase, user.id);
    const result = await service.bulkPublish();

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[POST /api/minifigs/sync/bulk-publish] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to bulk publish',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
