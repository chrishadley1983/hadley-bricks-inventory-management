/**
 * POST /api/negotiation/send-offers
 *
 * Trigger manual offer sending for eligible listings
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getNegotiationService } from '@/lib/ebay/negotiation.service';

const SendOffersSchema = z.object({
  listingIds: z.array(z.string()).optional(),
  dryRun: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse and validate body
    const body = await request.json();
    const parsed = SendOffersSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { listingIds, dryRun } = parsed.data;

    // Initialize service
    const service = getNegotiationService();
    const initialized = await service.init(user.id);

    if (!initialized) {
      return NextResponse.json(
        { error: 'Failed to connect to eBay. Please check your eBay connection.' },
        { status: 503 }
      );
    }

    // If dry run, just return eligible items without sending
    if (dryRun) {
      const eligibleItems = await service.getEligibleItems(user.id);
      const itemsToProcess = listingIds
        ? eligibleItems.filter((item) => listingIds.includes(item.listingId))
        : eligibleItems;

      return NextResponse.json({
        data: {
          dryRun: true,
          eligibleCount: itemsToProcess.length,
          items: itemsToProcess,
        },
      });
    }

    // Process offers
    const result = await service.processOffers(user.id, 'manual', listingIds);

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[POST /api/negotiation/send-offers] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
