import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ShopifySyncService } from '@/lib/shopify';

const CreateSchema = z.object({
  inventory_item_id: z.string().uuid('Invalid inventory item ID'),
});

/**
 * POST /api/shopify-sync/create — Push a single item to Shopify
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
    const parsed = CreateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const service = new ShopifySyncService(supabase, user.id);
    const result = await service.createProduct(parsed.data.inventory_item_id);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to create Shopify product' },
        { status: 422 }
      );
    }

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/shopify-sync/create] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
