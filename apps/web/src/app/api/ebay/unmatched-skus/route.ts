import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface UnmatchedSku {
  sku: string;
  title: string;
  orderCount: number;
  totalQuantity: number;
}

/**
 * GET /api/ebay/unmatched-skus
 * List all unmatched eBay SKUs
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

    // Get all line items from unfulfilled orders
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: lineItems, error } = await (supabase as any)
      .from('ebay_order_line_items')
      .select(
        `
        sku,
        title,
        quantity,
        fulfilment_status,
        order:ebay_orders!inner(
          user_id,
          order_payment_status
        )
      `
      )
      .eq('order.user_id', user.id)
      .neq('order.order_payment_status', 'FULLY_REFUNDED')
      .eq('fulfilment_status', 'NOT_STARTED')
      .not('sku', 'is', null);

    if (error) {
      console.error('[GET /api/ebay/unmatched-skus] Error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch line items' },
        { status: 500 }
      );
    }

    // Get existing mappings
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: mappings } = await (supabase as any)
      .from('ebay_sku_mappings')
      .select('ebay_sku')
      .eq('user_id', user.id);

    const mappedSkus = new Set(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mappings || []).map((m: any) => m.ebay_sku)
    );

    // Get inventory items with SKUs
    const allSkus = [...new Set(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (lineItems || []).map((li: any) => li.sku).filter(Boolean)
    )];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let inventorySkus: any[] = [];
    if (allSkus.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('inventory_items')
        .select('sku')
        .eq('user_id', user.id)
        .in('sku', allSkus);
      inventorySkus = data || [];
    }

    const inventorySkuSet = new Set(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inventorySkus.map((item: any) => item.sku)
    );

    // Aggregate unmatched SKUs
    const skuMap = new Map<string, UnmatchedSku>();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const lineItem of lineItems || []) {
      const sku = lineItem.sku;
      if (!sku) continue;

      // Skip if already mapped or has direct match
      if (mappedSkus.has(sku) || inventorySkuSet.has(sku)) continue;

      if (!skuMap.has(sku)) {
        skuMap.set(sku, {
          sku,
          title: lineItem.title,
          orderCount: 0,
          totalQuantity: 0,
        });
      }

      const entry = skuMap.get(sku)!;
      entry.orderCount++;
      entry.totalQuantity += lineItem.quantity;
    }

    const unmatchedSkus = Array.from(skuMap.values()).sort(
      (a, b) => b.totalQuantity - a.totalQuantity
    );

    return NextResponse.json({
      data: unmatchedSkus,
      total: unmatchedSkus.length,
    });
  } catch (error) {
    console.error('[GET /api/ebay/unmatched-skus] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
