/**
 * POST /api/ebay/listing-refresh/[id]/items/skip
 *
 * Bulk skip items (exclude from refresh)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { EbayListingRefreshService } from '@/lib/ebay/ebay-listing-refresh.service';

const BulkSkipSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1, 'At least one item ID is required'),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Validate input
    const body = await request.json();
    const parsed = BulkSkipSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    // Skip items
    const service = new EbayListingRefreshService(supabase, user.id);
    await service.skipItems(id, parsed.data.itemIds);

    return NextResponse.json({ success: true, skippedCount: parsed.data.itemIds.length });
  } catch (error) {
    console.error('[POST /api/ebay/listing-refresh/[id]/items/skip] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
