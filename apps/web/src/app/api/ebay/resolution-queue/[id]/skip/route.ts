import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/require-user';
import { EbayInventoryLinkingService } from '@/lib/ebay/ebay-inventory-linking.service';

const SkipSchema = z.object({
  reason: z.enum(['skipped', 'no_inventory']),
});

/**
 * POST /api/ebay/resolution-queue/[id]/skip
 * Skip a queue item (mark as skipped or no_inventory)
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    // Validate request body
    const body = await request.json();
    const parsed = SkipSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Skip the queue item
    const linkingService = new EbayInventoryLinkingService(supabase, user.id);
    const result = await linkingService.skipQueueItem(id, parsed.data.reason);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/ebay/resolution-queue/[id]/skip] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
