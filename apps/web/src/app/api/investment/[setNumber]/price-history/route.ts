/**
 * GET /api/investment/[setNumber]/price-history
 *
 * Returns Amazon pricing history for a set's ASIN.
 * Used by the price history chart on the set detail page.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ setNumber: string }> }
) {
  try {
    const { setNumber } = await params;
    const supabase = createServiceRoleClient();

    // Get the set's ASIN
    // Note: amazon_asin column may not be in generated types yet
    const { data: rawSet, error: setError } = await supabase
      .from('brickset_sets')
      .select('amazon_asin, uk_retail_price')
      .eq('set_number', setNumber)
      .single();

    if (setError || !rawSet) {
      return NextResponse.json({ error: 'Set not found' }, { status: 404 });
    }

    const set = rawSet as unknown as Record<string, unknown>;
    const amazonAsin = set.amazon_asin as string | null;
    const ukRetailPrice = set.uk_retail_price as number | null;

    if (!amazonAsin) {
      return NextResponse.json({
        data: [],
        rrp: ukRetailPrice,
        message: 'No Amazon ASIN linked to this set',
      });
    }

    // Fetch price history
    const { data: history, error: historyError } = await supabase
      .from('amazon_arbitrage_pricing')
      .select(
        'snapshot_date, buy_box_price, was_price_90d, lowest_offer_price, sales_rank, offer_count'
      )
      .eq('asin', amazonAsin)
      .order('snapshot_date', { ascending: true });

    if (historyError) {
      console.error('[GET /api/investment/[setNumber]/price-history] Error:', historyError.message);
      return NextResponse.json({ error: 'Failed to fetch price history' }, { status: 500 });
    }

    return NextResponse.json({
      data: history ?? [],
      rrp: ukRetailPrice,
      asin: amazonAsin,
    });
  } catch (error) {
    console.error('[GET /api/investment/[setNumber]/price-history] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
