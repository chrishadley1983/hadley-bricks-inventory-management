/**
 * Admin endpoint to reconcile Amazon fees from Finance API data
 *
 * POST /api/admin/reconcile-amazon-fees
 * - Runs the fee reconciliation process for sold Amazon inventory items
 * - Updates sold_gross_amount, sold_fees_amount, sold_net_amount from amazon_transactions
 *
 * GET /api/admin/reconcile-amazon-fees
 * - Returns a preview of items that would be reconciled
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { AmazonFeeReconciliationService } from '@/lib/services';

/**
 * GET - Preview items that need fee reconciliation
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const reconciliationService = new AmazonFeeReconciliationService(supabase);
    const preview = await reconciliationService.getReconciliationPreview(user.id);

    // Also get a count of total items needing reconciliation
    const { count } = await supabase
      .from('inventory_items')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'SOLD')
      .eq('sold_platform', 'amazon')
      .not('sold_order_id', 'is', null)
      .or('sold_fees_amount.is.null,sold_fees_amount.eq.0');

    return NextResponse.json({
      data: {
        totalItemsNeedingReconciliation: count ?? 0,
        preview,
      },
    });
  } catch (error) {
    console.error('[GET /api/admin/reconcile-amazon-fees] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST - Run fee reconciliation
 *
 * Query params:
 * - reconcileAll=true: Reconcile ALL sold Amazon items (not just those missing fees)
 *                      Use this to fix items that were reconciled with incorrect (doubled) values
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

    // Check for reconcileAll query param
    const { searchParams } = new URL(request.url);
    const reconcileAll = searchParams.get('reconcileAll') === 'true';

    console.log(`[POST /api/admin/reconcile-amazon-fees] Starting reconciliation for user ${user.id}, reconcileAll=${reconcileAll}`);

    const reconciliationService = new AmazonFeeReconciliationService(supabase);
    const result = await reconciliationService.reconcileFees(user.id, reconcileAll);

    console.log(`[POST /api/admin/reconcile-amazon-fees] Result:`, result);

    return NextResponse.json({
      data: result,
    });
  } catch (error) {
    console.error('[POST /api/admin/reconcile-amazon-fees] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
