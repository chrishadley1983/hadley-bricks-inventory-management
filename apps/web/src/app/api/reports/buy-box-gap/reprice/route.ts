/**
 * POST /api/reports/buy-box-gap/reprice
 *
 * Updates the listing price for an ASIN:
 * 1. Updates listing_value on all inventory_items with that ASIN
 * 2. Adds them to amazon_sync_queue for price push to Amazon
 *
 * Logic lives in queueAmazonRepriceByAsin (shared with markdown approvals).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/require-user';
import { queueAmazonRepriceByAsin } from '@/lib/amazon/reprice-queue';

const RepriceSchema = z.object({
  asin: z.string().min(1),
  newPrice: z.number().positive(),
});

export async function POST(request: NextRequest) {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const body = await request.json();
    const parsed = RepriceSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { asin, newPrice } = parsed.data;

    const result = await queueAmazonRepriceByAsin(supabase, user.id, asin, newPrice);

    if (result.error) {
      const status = result.error.startsWith('No inventory items found') ? 404 : 500;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({
      data: {
        asin,
        newPrice,
        inventoryItemsUpdated: result.itemsUpdated,
        queuedForSync: result.queued,
        errors: result.errors,
      },
      message: `Updated ${result.itemsUpdated} items to £${newPrice.toFixed(2)}, ${result.queued} queued for Amazon sync`,
    });
  } catch (error) {
    console.error('[POST /api/reports/buy-box-gap/reprice] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
