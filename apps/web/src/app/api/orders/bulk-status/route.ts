import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { OrderStatusService } from '@/lib/services';
import type { OrderStatus } from '@hadley-bricks/database';

const BulkUpdateSchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1),
  status: z.enum(['Pending', 'Paid', 'Packed', 'Shipped', 'Completed', 'Cancelled']),
  notes: z.string().optional(),
  shipping: z
    .object({
      carrier: z.string().optional(),
      trackingNumber: z.string().optional(),
      method: z.string().optional(),
      actualCost: z.number().optional(),
    })
    .optional(),
});

/**
 * POST /api/orders/bulk-status
 * Update status for multiple orders
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
    const parsed = BulkUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Verify user owns all orders
    const { data: orders, error: ordersError } = await supabase
      .from('platform_orders')
      .select('id, user_id')
      .in('id', parsed.data.orderIds);

    if (ordersError) {
      throw new Error(`Failed to verify orders: ${ordersError.message}`);
    }

    const ordersData = (orders || []) as Array<{ id: string; user_id: string }>;
    const userOrderIds = ordersData.filter((o) => o.user_id === user.id).map((o) => o.id);
    const invalidOrderIds = parsed.data.orderIds.filter((id) => !userOrderIds.includes(id));

    if (invalidOrderIds.length > 0) {
      return NextResponse.json(
        {
          error: 'Some orders not found or unauthorized',
          invalidOrderIds,
        },
        { status: 403 }
      );
    }

    const statusService = new OrderStatusService(supabase);

    const result = await statusService.bulkUpdateStatus(
      parsed.data.orderIds,
      parsed.data.status as OrderStatus,
      {
        notes: parsed.data.notes,
        shipping: parsed.data.shipping,
      }
    );

    return NextResponse.json({
      success: result.success,
      data: result,
    });
  } catch (error) {
    console.error('[POST /api/orders/bulk-status] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
