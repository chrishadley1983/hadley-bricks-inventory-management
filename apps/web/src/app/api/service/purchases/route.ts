/**
 * Service API: Purchases
 *
 * POST - Create a new purchase
 * DELETE - Delete a purchase (for rollback)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withServiceAuth, getSystemUserId } from '@/lib/middleware/service-auth';
import { createServiceRoleClient } from '@/lib/supabase/server';

const CreatePurchaseSchema = z.object({
  source: z.string().min(1, 'Source is required'),
  cost: z.number().positive('Cost must be positive'),
  payment_method: z.string().min(1, 'Payment method is required'),
  purchase_date: z.string().min(1, 'Purchase date is required'),
  short_description: z.string().optional(),
  description: z.string().optional(),
  order_reference: z.string().optional(),
  seller_username: z.string().optional(),
});

const DeletePurchaseSchema = z.object({
  purchaseId: z.string().uuid('Invalid purchase ID'),
});

/**
 * POST /api/service/purchases
 * Create a new purchase record
 */
export async function POST(request: NextRequest) {
  return withServiceAuth(request, ['write'], async (_keyInfo) => {
    try {
      const body = await request.json();
      const parsed = CreatePurchaseSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Validation failed', details: parsed.error.flatten() },
          { status: 400 }
        );
      }

      const {
        source,
        cost,
        payment_method,
        purchase_date,
        short_description,
        description,
        order_reference,
        // seller_username - stored in description if needed
      } = parsed.data;

      const supabase = createServiceRoleClient();
      const userId = await getSystemUserId();

      // Create the purchase
      const { data: purchase, error } = await supabase
        .from('purchases')
        .insert({
          user_id: userId,
          source,
          cost,
          payment_method,
          purchase_date,
          short_description: short_description || `${source} purchase`,
          description,
          reference: order_reference,
        })
        .select()
        .single();

      if (error) {
        console.error('[POST /api/service/purchases] Insert error:', error);
        return NextResponse.json(
          { error: 'Failed to create purchase', details: error.message },
          { status: 500 }
        );
      }

      return NextResponse.json({ data: purchase }, { status: 201 });
    } catch (error) {
      console.error('[POST /api/service/purchases] Error:', error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

/**
 * DELETE /api/service/purchases
 * Delete a purchase (for rollback on failed inventory creation)
 */
export async function DELETE(request: NextRequest) {
  return withServiceAuth(request, ['write'], async (_keyInfo) => {
    try {
      const body = await request.json();
      const parsed = DeletePurchaseSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Validation failed', details: parsed.error.flatten() },
          { status: 400 }
        );
      }

      const { purchaseId } = parsed.data;
      const supabase = createServiceRoleClient();

      // Delete the purchase
      const { error } = await supabase.from('purchases').delete().eq('id', purchaseId);

      if (error) {
        console.error('[DELETE /api/service/purchases] Delete error:', error);
        return NextResponse.json(
          { error: 'Failed to delete purchase', details: error.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: `Purchase ${purchaseId} deleted`,
      });
    } catch (error) {
      console.error('[DELETE /api/service/purchases] Error:', error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Internal server error' },
        { status: 500 }
      );
    }
  });
}
