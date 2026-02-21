import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { EbayInventoryLinkingService } from '@/lib/ebay/ebay-inventory-linking.service';

const ResolveSchema = z.object({
  inventoryItemIds: z.array(z.string().uuid()).min(1),
});

/**
 * POST /api/ebay/resolution-queue/[id]/resolve
 * Resolve a queue item by selecting inventory item(s)
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Validate request body
    const body = await request.json();
    const parsed = ResolveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Resolve the queue item
    const linkingService = new EbayInventoryLinkingService(supabase, user.id);
    const result = await linkingService.resolveQueueItem(id, parsed.data.inventoryItemIds);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/ebay/resolution-queue/[id]/resolve] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
