import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { SalesService } from '@/lib/services';

const CreateFromOrderSchema = z.object({
  orderId: z.string().uuid(),
  platformFees: z.number().optional(),
  shippingCost: z.number().optional(),
  otherCosts: z.number().optional(),
  notes: z.string().optional(),
});

/**
 * POST /api/sales/from-order
 * Create a sale record from a completed order
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
    const parsed = CreateFromOrderSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Verify user owns the order
    const { data: order, error: orderError } = await supabase
      .from('platform_orders')
      .select('id, user_id')
      .eq('id', parsed.data.orderId)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const orderData = order as { id: string; user_id: string };
    if (orderData.user_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const salesService = new SalesService(supabase);
    const result = await salesService.createFromOrder(user.id, parsed.data);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // Update inventory status if needed
    if (result.sale) {
      await salesService.updateInventoryStatus(result.sale.id);
    }

    return NextResponse.json({ data: result.sale }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/sales/from-order] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
