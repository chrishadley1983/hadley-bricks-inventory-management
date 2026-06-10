import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/require-user';
import { OrderRepository } from '@/lib/repositories';

const orderIdSchema = z.string().uuid('Order ID must be a valid UUID');

/**
 * GET /api/orders/[id]
 * Get a single order with items
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const orderRepo = new OrderRepository(supabase);
    const order = await orderRepo.findByIdWithItems(id);

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // Verify ownership
    if (order.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json({ data: order });
  } catch (error) {
    console.error('[GET /api/orders/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/orders/[id]
 * Delete an order
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const idResult = orderIdSchema.safeParse(id);
    if (!idResult.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: idResult.error.flatten().formErrors },
        { status: 400 }
      );
    }

    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const orderRepo = new OrderRepository(supabase);

    // Verify ownership first
    const order = await orderRepo.findById(idResult.data);
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    if (order.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await orderRepo.delete(idResult.data);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/orders/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
