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

    // Get all data from the view
    const { data, error } = await supabase
      .from('arbitrage_current_view')
      .select('asin, bricklink_set_number, ebay_min_price, ebay_margin_percent, your_price, buy_box_price')
      .eq('user_id', user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const items = data ?? [];

    const stats = {
      total: items.length,
      withMapping: items.filter(i => i.bricklink_set_number).length,
      withEbayPrice: items.filter(i => i.ebay_min_price !== null).length,
      withEbayMargin: items.filter(i => i.ebay_margin_percent !== null).length,
      ebayMarginGte0: items.filter(i => i.ebay_margin_percent !== null && i.ebay_margin_percent >= 0).length,
      ebayMarginGte30: items.filter(i => i.ebay_margin_percent !== null && i.ebay_margin_percent >= 30).length,
      withYourPrice: items.filter(i => i.your_price !== null).length,
      withBuyBoxPrice: items.filter(i => i.buy_box_price !== null).length,
      withAnyAmazonPrice: items.filter(i => i.your_price !== null || i.buy_box_price !== null).length,
    };

    // Sample items without eBay data but with mapping
    const missingEbay = items
      .filter(i => i.bricklink_set_number && !i.ebay_min_price)
      .slice(0, 10)
      .map(i => ({ asin: i.asin, setNumber: i.bricklink_set_number }));

    return NextResponse.json({
      stats,
      missingEbaySamples: missingEbay,
    });
  } catch (error) {
    console.error('[GET /api/test/arbitrage-stats] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
