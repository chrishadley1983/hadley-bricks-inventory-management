import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { AmazonInventoryLinkingService } from '@/lib/amazon/amazon-inventory-linking.service';

/**
 * POST /api/orders/amazon/[orderId]/rematch
 * Trigger re-matching of an Amazon order to inventory
 * This is called after linking an ASIN to an inventory item
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify the order exists and belongs to the user
    const { data: order, error: orderError } = await supabase
      .from('platform_orders')
      .select('id, platform_order_id')
      .eq('id', orderId)
      .eq('user_id', user.id)
      .eq('platform', 'amazon')
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // Create the linking service and process the order
    const linkingService = new AmazonInventoryLinkingService(supabase, user.id);
    const result = await linkingService.processShippedOrder(orderId, {
      mode: 'auto',
      includeSold: true, // Allow matching to SOLD items that don't have linked orders
    });

    return NextResponse.json({
      data: result,
      message: `Order processed: ${result.autoLinked} linked, ${result.queuedForResolution} queued`,
    });
  } catch (error) {
    console.error('[POST /api/orders/amazon/[orderId]/rematch] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
