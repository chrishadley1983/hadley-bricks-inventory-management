import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ResearchService } from '@/lib/minifig-sync/research.service';

export const runtime = 'nodejs';
export const maxDuration = 300;

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
        { status: 400 }
      );
    }

    const service = new ResearchService(supabase, user.id);
    await service.forceRefresh(parsed.data.itemId);

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error('[POST /api/minifigs/sync/research/refresh] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to refresh research',
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
