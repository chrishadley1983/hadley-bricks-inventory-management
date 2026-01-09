import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { PurchaseService } from '@/lib/services';

const BulkUpdateSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'At least one ID is required'),
  updates: z.object({
    purchase_date: z.string().nullish(),
    short_description: z.string().nullish(),
    cost: z.number().nullish(),
    source: z.string().nullish(),
    payment_method: z.string().nullish(),
    description: z.string().nullish(),
    reference: z.string().nullish(),
  }),
});

const BulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'At least one ID is required'),
});

/**
 * PATCH /api/purchases/bulk
 * Bulk update multiple purchases
 */
export async function PATCH(request: NextRequest) {
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
    const parsed = BulkUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { ids, updates } = parsed.data;

    // Filter out undefined/null values that weren't explicitly set
    const cleanedUpdates: Record<string, string | number | null> = {};
    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined) {
        cleanedUpdates[key] = value;
      }
    });

    if (Object.keys(cleanedUpdates).length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    const service = new PurchaseService(supabase, user.id);
    const result = await service.updateBulk(ids, cleanedUpdates);

    return NextResponse.json({
      data: result,
      updated: result.length,
    });
  } catch (error) {
    console.error('[PATCH /api/purchases/bulk] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/purchases/bulk
 * Bulk delete multiple purchases
 */
export async function DELETE(request: NextRequest) {
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
    const parsed = BulkDeleteSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { ids } = parsed.data;

    const service = new PurchaseService(supabase, user.id);
    await service.deleteBulk(ids);

    return NextResponse.json({
      deleted: ids.length,
    });
  } catch (error) {
    console.error('[DELETE /api/purchases/bulk] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
