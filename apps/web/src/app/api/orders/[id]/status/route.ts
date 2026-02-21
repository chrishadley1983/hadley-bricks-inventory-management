import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { OrderStatusService } from '@/lib/services';
import type { OrderStatus } from '@hadley-bricks/database';

const UpdateStatusSchema = z.object({
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
  force: z.boolean().optional(),
});

/**
 * GET /api/orders/[id]/status
 * Get status history for an order
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    // Verify user owns the order
    const { data: order, error: orderError } = await supabase
      .from('platform_orders')
      .select('id, user_id, status, internal_status')
      .eq('id', id)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const orderData = order as {
      id: string;
      user_id: string;
      status: string | null;
      internal_status: string | null;
    };
    if (orderData.user_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const statusService = new OrderStatusService(supabase);
    const history = await statusService.getStatusHistory(id);

    // Get effective status and allowed transitions
    const effectiveStatus = statusService.getEffectiveStatus(
      orderData as Parameters<typeof statusService.getEffectiveStatus>[0]
    );
    const allowedTransitions = statusService.getAllowedNextStatuses(effectiveStatus);

    return NextResponse.json({
      data: {
        currentStatus: effectiveStatus,
        platformStatus: orderData.status,
        allowedTransitions,
        history,
      },
    });
  } catch (error) {
    console.error('[GET /api/orders/[id]/status] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/orders/[id]/status
 * Update order status
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

    // Verify user owns the order
    const { data: order, error: orderError } = await supabase
      .from('platform_orders')
      .select('id, user_id')
      .eq('id', id)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const orderData = order as { id: string; user_id: string };
    if (orderData.user_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = UpdateStatusSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const statusService = new OrderStatusService(supabase);

    const result = await statusService.updateStatus(id, parsed.data.status as OrderStatus, {
      notes: parsed.data.notes,
      shipping: parsed.data.shipping,
      force: parsed.data.force,
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[POST /api/orders/[id]/status] Error:', error);

    if (error instanceof Error && error.message.includes('Invalid status transition')) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
