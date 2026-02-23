import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ShopifySyncService } from '@/lib/shopify';

const BatchSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(50),
});

/**
 * POST /api/shopify-sync/batch — Run batch sync (archive sold, create new)
 */
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
    const parsed = BatchSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const service = new ShopifySyncService(supabase, user.id);
    const summary = await service.batchSync(parsed.data.limit);

    return NextResponse.json({ data: summary });
  } catch (error) {
    console.error('[POST /api/shopify-sync/batch] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
