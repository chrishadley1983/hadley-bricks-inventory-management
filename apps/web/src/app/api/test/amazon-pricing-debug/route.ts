/**
 * Debug endpoint to check Amazon pricing data for a specific ASIN
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const asin = searchParams.get('asin');

    if (!asin) {
      return NextResponse.json({ error: 'Missing asin parameter' }, { status: 400 });
    }

    // Get Amazon pricing history for this ASIN
    const { data: pricingData, error: pricingError } = await supabase
      .from('amazon_arbitrage_pricing')
      .select('*')
      .eq('user_id', user.id)
      .eq('asin', asin)
      .order('snapshot_date', { ascending: false })
      .limit(10);

    if (pricingError) {
      return NextResponse.json({ error: pricingError.message }, { status: 500 });
    }

    // Get tracked ASIN info
    const { data: trackedAsin } = await supabase
      .from('tracked_asins')
      .select('*')
      .eq('user_id', user.id)
      .eq('asin', asin)
      .single();

    // Get mapping info
    const { data: mapping } = await supabase
      .from('asin_bricklink_mapping')
      .select('*')
      .eq('user_id', user.id)
      .eq('asin', asin)
      .single();

    // Get view data for this ASIN
    const { data: viewData } = await supabase
      .from('arbitrage_current_view')
      .select('*')
      .eq('user_id', user.id)
      .eq('asin', asin)
      .single();

    return NextResponse.json({
      asin,
      trackedAsin,
      mapping,
      pricingHistory: pricingData,
      currentView: viewData,
    });
  } catch (error) {
    console.error('[GET /api/test/amazon-pricing-debug] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
