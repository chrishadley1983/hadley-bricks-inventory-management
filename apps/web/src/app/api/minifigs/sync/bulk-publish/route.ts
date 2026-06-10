import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { ListingActionsService } from '@/lib/minifig-sync/listing-actions.service';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST() {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const service = new ListingActionsService(supabase, user.id);
    const result = await service.bulkPublish();

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[POST /api/minifigs/sync/bulk-publish] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to bulk publish',
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
