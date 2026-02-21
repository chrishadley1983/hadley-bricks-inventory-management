import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ListingStagingService } from '@/lib/minifig-sync/listing-staging.service';

export const runtime = 'nodejs';
export const maxDuration = 300;

const RequestSchema = z.object({
  itemIds: z.array(z.string().uuid()).optional(),
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

    const body = await request.json().catch(() => ({}));
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const service = new ListingStagingService(supabase, user.id);
    const result = await service.createStagedListings(parsed.data.itemIds);

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[POST /api/minifigs/sync/create-listings] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to create staged listings',
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
