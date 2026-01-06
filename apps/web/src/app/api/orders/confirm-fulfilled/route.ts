import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { OrderFulfilmentService } from '@/lib/services/order-fulfilment.service';

const ConfirmOrdersSchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1),
  archiveLocation: z.string().optional(),
  itemMappings: z.record(z.string(), z.string()).optional(),
});

const GetOrdersSchema = z.object({
  platform: z.enum(['amazon', 'ebay']),
});

/**
 * POST /api/orders/confirm-fulfilled
 * Confirm orders as fulfilled and update inventory to SOLD
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
    const parsed = ConfirmOrdersSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const fulfilmentService = new OrderFulfilmentService(supabase);
    const result = await fulfilmentService.confirmOrdersFulfilled(user.id, parsed.data);

    return NextResponse.json({
      success: result.success,
      data: result,
    });
  } catch (error) {
    console.error('[POST /api/orders/confirm-fulfilled] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/orders/confirm-fulfilled?platform=amazon
 * Get orders ready for confirmation with their inventory match status
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const platform = request.nextUrl.searchParams.get('platform');
    const parsed = GetOrdersSchema.safeParse({ platform });

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid platform. Must be "amazon" or "ebay"' },
        { status: 400 }
      );
    }

    const fulfilmentService = new OrderFulfilmentService(supabase);
    const orders = await fulfilmentService.getOrdersForConfirmation(user.id, parsed.data.platform);

    // Calculate summary stats
    const totalOrders = orders.length;
    const allMatchedOrders = orders.filter((o) => o.allMatched).length;
    const partialMatchOrders = orders.filter((o) => !o.allMatched && o.unmatchedCount < o.items.length).length;
    const unmatchedOrders = orders.filter((o) => o.unmatchedCount === o.items.length).length;

    return NextResponse.json({
      data: {
        orders,
        summary: {
          totalOrders,
          allMatchedOrders,
          partialMatchOrders,
          unmatchedOrders,
          readyToConfirm: allMatchedOrders,
        },
      },
    });
  } catch (error) {
    console.error('[GET /api/orders/confirm-fulfilled] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
