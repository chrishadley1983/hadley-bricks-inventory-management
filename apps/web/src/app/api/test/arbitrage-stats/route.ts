/**
 * Debug endpoint to check arbitrage data distribution
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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

    // Get total tracked ASINs count
    const { count: totalTrackedAsins } = await supabase
      .from('tracked_asins')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'active');

    // Get excluded ASINs count
    const { count: excludedAsins } = await supabase
      .from('tracked_asins')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'excluded');

    // Get all data from the view (these are active ASINs in the view)
    const { data, error } = await supabase
      .from('arbitrage_current_view')
      .select(
        'asin, bricklink_set_number, ebay_min_price, ebay_margin_percent, margin_percent, your_price, buy_box_price, your_qty'
      )
      .eq('user_id', user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const items = data ?? [];

    // Calculate breakdown
    const breakdown = {
      // Source totals
      totalTrackedAsins: totalTrackedAsins ?? 0,
      excludedAsins: excludedAsins ?? 0,
      activeAsins: (totalTrackedAsins ?? 0) - (excludedAsins ?? 0),

      // View data (only active ASINs appear here)
      inView: items.length,

      // Mapping status
      mapped: items.filter((i) => i.bricklink_set_number).length,
      unmapped: items.filter((i) => !i.bricklink_set_number).length,

      // eBay data status (only for mapped items)
      withEbayPrice: items.filter((i) => i.ebay_min_price !== null).length,
      noEbayPrice: items.filter((i) => i.bricklink_set_number && i.ebay_min_price === null).length,

      // eBay margin breakdown (only where margin can be calculated)
      ebayMarginGte30: items.filter(
        (i) => i.ebay_margin_percent !== null && i.ebay_margin_percent >= 30
      ).length,
      ebayMarginGte0: items.filter(
        (i) => i.ebay_margin_percent !== null && i.ebay_margin_percent >= 0
      ).length,
      ebayMarginLt0: items.filter(
        (i) => i.ebay_margin_percent !== null && i.ebay_margin_percent < 0
      ).length,
      ebayMarginNull: items.filter((i) => i.ebay_margin_percent === null).length,

      // BrickLink margin breakdown
      blMarginGte30: items.filter((i) => i.margin_percent !== null && i.margin_percent >= 30)
        .length,
      blMarginGte0: items.filter((i) => i.margin_percent !== null && i.margin_percent >= 0).length,
      blMarginLt0: items.filter((i) => i.margin_percent !== null && i.margin_percent < 0).length,
      blMarginNull: items.filter((i) => i.margin_percent === null).length,

      // Amazon pricing status
      withYourPrice: items.filter((i) => i.your_price !== null).length,
      withBuyBoxPrice: items.filter((i) => i.buy_box_price !== null).length,
      noAmazonPrice: items.filter((i) => i.your_price === null && i.buy_box_price === null).length,

      // Stock status
      inStock: items.filter((i) => (i.your_qty ?? 0) > 0).length,
      zeroQty: items.filter((i) => (i.your_qty ?? 0) === 0).length,
    };

    // Why eBay margin is null breakdown
    const ebayMarginNullReasons = {
      noMapping: items.filter((i) => !i.bricklink_set_number).length,
      mappedButNoEbayPrice: items.filter((i) => i.bricklink_set_number && i.ebay_min_price === null)
        .length,
      hasEbayPriceButNoAmazonPrice: items.filter(
        (i) => i.ebay_min_price !== null && i.your_price === null && i.buy_box_price === null
      ).length,
    };

    return NextResponse.json({
      breakdown,
      ebayMarginNullReasons,
      summary: `${breakdown.totalTrackedAsins} tracked → ${breakdown.activeAsins} active → ${breakdown.mapped} mapped → ${breakdown.withEbayPrice} with eBay price → ${breakdown.ebayMarginGte30} opportunities (≥30%)`,
    });
  } catch (error) {
    console.error('[GET /api/test/arbitrage-stats] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
