import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { InventoryService } from '@/lib/services';

const BulkUpdateSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'At least one ID is required'),
  updates: z.object({
    storage_location: z.string().nullish(),
    linked_lot: z.string().nullish(),
    notes: z.string().nullish(),
    condition: z.enum(['New', 'Used']).nullish(),
    status: z.string().nullish(),
    source: z.string().nullish(),
    listing_platform: z.string().nullish(),
  }),
});

/**
 * PATCH /api/inventory/bulk
 * Bulk update multiple inventory items
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
    const cleanedUpdates: Record<string, string | null> = {};
    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined) {
        cleanedUpdates[key] = value;
      }
    });

    if (Object.keys(cleanedUpdates).length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    const service = new InventoryService(supabase, user.id);
    const result = await service.updateBulk(ids, cleanedUpdates);

    return NextResponse.json({
      data: result,
      updated: result.length,
    });
  } catch (error) {
    console.error('[PATCH /api/inventory/bulk] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
