import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const BulkConfirmSchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(50),
  skipUnmatched: z.boolean().default(false),
});

/**
 * POST /api/orders/ebay/confirm-bulk
 * Confirm multiple eBay orders at once
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
    const parsed = BulkConfirmSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { orderIds, skipUnmatched } = parsed.data;

    // Process each order
    const results: Array<{
      orderId: string;
      success: boolean;
      error?: string;
      inventoryUpdated?: number;
    }> = [];

    for (const orderId of orderIds) {
      try {
        // Make internal call to single order confirm endpoint
        const response = await fetch(
          `${request.nextUrl.origin}/api/orders/ebay/${orderId}/confirm`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: request.headers.get('cookie') || '',
            },
            body: JSON.stringify({ skipUnmatched }),
          }
        );

        const data = await response.json();

        if (response.ok) {
          results.push({
            orderId,
            success: true,
            inventoryUpdated: data.data?.inventoryUpdated || 0,
          });
        } else {
          results.push({
            orderId,
            success: false,
            error: data.error || 'Unknown error',
          });
        }
      } catch (err) {
        results.push({
          orderId,
          success: false,
          error: err instanceof Error ? err.message : 'Request failed',
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failedCount = results.filter((r) => !r.success).length;
    const totalInventoryUpdated = results.reduce((sum, r) => sum + (r.inventoryUpdated || 0), 0);

    return NextResponse.json({
      success: failedCount === 0,
      data: {
        confirmed: successCount,
        failed: failedCount,
        inventoryUpdated: totalInventoryUpdated,
        results,
      },
    });
  } catch (error) {
    console.error('[POST /api/orders/ebay/confirm-bulk] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
