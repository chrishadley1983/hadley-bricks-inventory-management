import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { SalesService } from '@/lib/services';

const UpdateSaleSchema = z.object({
  saleDate: z.string().optional(),
  platform: z.string().optional(),
  saleAmount: z.number().positive().optional(),
  shippingCharged: z.number().optional(),
  shippingCost: z.number().optional(),
  platformFees: z.number().optional(),
  otherCosts: z.number().optional(),
  costOfGoods: z.number().optional(),
  buyerName: z.string().optional(),
  buyerEmail: z.string().email().optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * GET /api/sales/[id]
 * Get a single sale with items
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const salesService = new SalesService(supabase);
    const sale = await salesService.getSaleWithItems(id);

    if (!sale) {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404 });
    }

    // Verify ownership
    if (sale.user_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    return NextResponse.json({ data: sale });
  } catch (error) {
    console.error('[GET /api/sales/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/sales/[id]
 * Update a sale
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    // Verify ownership
    const { data: existingSale, error: fetchError } = await supabase
      .from('sales')
      .select('id, user_id')
      .eq('id', id)
      .single();

    if (fetchError || !existingSale) {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404 });
    }

    const saleData = existingSale as { id: string; user_id: string };
    if (saleData.user_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = UpdateSaleSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Convert to database column names
    const updateData: Record<string, unknown> = {};
    if (parsed.data.saleDate !== undefined) updateData.sale_date = parsed.data.saleDate;
    if (parsed.data.platform !== undefined) updateData.platform = parsed.data.platform;
    if (parsed.data.saleAmount !== undefined) updateData.sale_amount = parsed.data.saleAmount;
    if (parsed.data.shippingCharged !== undefined)
      updateData.shipping_charged = parsed.data.shippingCharged;
    if (parsed.data.shippingCost !== undefined) updateData.shipping_cost = parsed.data.shippingCost;
    if (parsed.data.platformFees !== undefined) updateData.platform_fees = parsed.data.platformFees;
    if (parsed.data.otherCosts !== undefined) updateData.other_costs = parsed.data.otherCosts;
    if (parsed.data.costOfGoods !== undefined) updateData.cost_of_goods = parsed.data.costOfGoods;
    if (parsed.data.buyerName !== undefined) updateData.buyer_name = parsed.data.buyerName;
    if (parsed.data.buyerEmail !== undefined) updateData.buyer_email = parsed.data.buyerEmail;
    if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
    if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updatedSale, error: updateError } = await (supabase as any)
      .from('sales')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to update sale: ${updateError.message}`);
    }

    return NextResponse.json({ data: updatedSale });
  } catch (error) {
    console.error('[PATCH /api/sales/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/sales/[id]
 * Delete a sale
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    // Verify ownership
    const { data: existingSale, error: fetchError } = await supabase
      .from('sales')
      .select('id, user_id')
      .eq('id', id)
      .single();

    if (fetchError || !existingSale) {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404 });
    }

    const saleData = existingSale as { id: string; user_id: string };
    if (saleData.user_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const salesService = new SalesService(supabase);
    const deleted = await salesService.deleteSale(id);

    if (!deleted) {
      return NextResponse.json({ error: 'Failed to delete sale' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/sales/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
