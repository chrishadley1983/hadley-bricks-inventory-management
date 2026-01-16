import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { PurchaseProfitabilityService } from '@/lib/services/purchase-profitability.service';

/**
 * GET /api/purchases/[id]/profitability
 * Get profitability metrics for a purchase
 */
export async function GET(
  _request: NextRequest,
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

    // Verify purchase exists and belongs to user
    const { data: purchase, error: purchaseError } = await supabase
      .from('purchases')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (purchaseError || !purchase) {
      return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
    }

    const service = new PurchaseProfitabilityService(supabase, user.id);
    const profitability = await service.calculateProfitability(id);

    return NextResponse.json({ data: profitability });
  } catch (error) {
    console.error('[GET /api/purchases/[id]/profitability] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
