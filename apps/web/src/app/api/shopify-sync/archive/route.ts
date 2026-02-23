import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ShopifySyncService } from '@/lib/shopify';

const ArchiveSchema = z.object({
  inventory_item_id: z.string().uuid('Invalid inventory item ID'),
});

/**
 * POST /api/shopify-sync/archive — Archive a Shopify product (item sold elsewhere)
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

    const body = await request.json();
    const parsed = ArchiveSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const service = new ShopifySyncService(supabase, user.id);
    const result = await service.archiveProduct(parsed.data.inventory_item_id);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to archive Shopify product' },
        { status: 422 }
      );
    }

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[POST /api/shopify-sync/archive] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
