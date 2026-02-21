/**
 * Test endpoint to sync a single ASIN's BrickLink pricing
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { BrickLinkArbitrageSyncService } from '@/lib/arbitrage';

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

    const asin = request.nextUrl.searchParams.get('asin') ?? 'B0BBSB69YX';

    // Get the BrickLink set number for this ASIN
    const { data: mapping } = await supabase
      .from('asin_bricklink_mapping')
      .select('bricklink_set_number')
      .eq('asin', asin)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!mapping) {
      return NextResponse.json(
        {
          error: 'No mapping found for ASIN',
          asin,
        },
        { status: 404 }
      );
    }

    const setNumber = mapping.bricklink_set_number;

    // Sync just this one set
    const syncService = new BrickLinkArbitrageSyncService(supabase);
    const priceGuide = await syncService.syncSingleSet(user.id, setNumber);

    // Fetch the stored data to verify
    const { data: storedData } = await supabase
      .from('bricklink_arbitrage_pricing')
      .select('*')
      .eq('bricklink_set_number', setNumber)
      .eq('user_id', user.id)
      .eq('country_code', 'UK')
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      asin,
      setNumber,
      apiResponse: {
        min_price: priceGuide.min_price,
        avg_price: priceGuide.avg_price,
        max_price: priceGuide.max_price,
        unit_quantity: priceGuide.unit_quantity,
        total_quantity: priceGuide.total_quantity,
      },
      storedData: storedData
        ? {
            min_price: storedData.min_price,
            avg_price: storedData.avg_price,
            max_price: storedData.max_price,
            total_lots: storedData.total_lots,
            country_code: storedData.country_code,
            snapshot_date: storedData.snapshot_date,
            price_detail_count: Array.isArray(storedData.price_detail_json)
              ? storedData.price_detail_json.length
              : 0,
            price_detail_sample: Array.isArray(storedData.price_detail_json)
              ? storedData.price_detail_json.slice(0, 3)
              : null,
          }
        : null,
    });
  } catch (error) {
    console.error('[GET /api/test/bricklink-sync-single] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
