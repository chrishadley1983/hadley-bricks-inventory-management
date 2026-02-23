import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ShopifySyncService } from '@/lib/shopify';

const ProcessSchema = z.object({
  batch_size: z.number().int().min(1).max(50).optional().default(10),
});

const EnqueueSchema = z.object({
  inventory_item_id: z.string().uuid('Invalid inventory item ID'),
  action: z.enum(['create', 'archive', 'update_price', 'delete']),
  priority: z.number().int().min(1).max(10).optional().default(5),
});

/**
 * POST /api/shopify-sync/queue — Process pending queue jobs
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
    const parsed = ProcessSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const service = new ShopifySyncService(supabase, user.id);
    const summary = await service.processQueue(parsed.data.batch_size);

    return NextResponse.json({ data: summary });
  } catch (error) {
    console.error('[POST /api/shopify-sync/queue] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/shopify-sync/queue — Enqueue a new sync job
 */
export async function PUT(request: NextRequest) {
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
    const parsed = EnqueueSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const service = new ShopifySyncService(supabase, user.id);
    await service.enqueueJob(
      parsed.data.action,
      parsed.data.inventory_item_id,
      parsed.data.priority
    );

    return NextResponse.json({ data: { queued: true } }, { status: 201 });
  } catch (error) {
    console.error('[PUT /api/shopify-sync/queue] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
