import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { AmazonInventoryLinkingService } from '@/lib/amazon/amazon-inventory-linking.service';

/**
 * POST /api/amazon/inventory-linking/reconcile-phantoms
 *
 * Run the Amazon phantom-stock reconciler on demand: detect inventory units
 * still shown as available that actually sold (order shipped, sale never linked).
 * Detection is alert-only — it returns candidates and (by default) posts a Discord
 * summary; it does NOT auto-mark anything sold.
 *
 * Query: ?alert=false to suppress the Discord post (e.g. validation runs).
 */
export async function POST(request: NextRequest) {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const alert = new URL(request.url).searchParams.get('alert') !== 'false';

    const service = new AmazonInventoryLinkingService(supabase, user.id);
    const result = await service.reconcilePhantomStock({ alert });

    return NextResponse.json({
      checkedOrders: result.checkedOrders,
      uncoveredUnits: result.uncoveredUnits,
      phantomCount: result.phantoms.length,
      selfCoveringCount: result.selfCovering.length,
      alerted: result.alerted,
      selfCovering: result.selfCovering.map((u) => ({
        sku: u.sku,
        setNumber: u.set_number,
        itemName: u.item_name,
        asin: u.amazon_asin,
      })),
      phantoms: result.phantoms.map((p) => ({
        sku: p.unit.sku,
        setNumber: p.unit.set_number,
        itemName: p.unit.item_name,
        asin: p.unit.amazon_asin,
        listingDate: p.unit.listing_date,
        soldOrderId: p.order.platformOrderId,
        soldDate: p.order.orderDate,
        estUnitValue: p.order.perUnit,
      })),
    });
  } catch (error) {
    console.error('[POST /api/amazon/inventory-linking/reconcile-phantoms] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
