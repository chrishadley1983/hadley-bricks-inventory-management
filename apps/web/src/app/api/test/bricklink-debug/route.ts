/**
 * Debug endpoint to inspect raw BrickLink API response
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { BrickLinkClient } from '@/lib/bricklink/client';
import { CredentialsRepository } from '@/lib/repositories';
import type { BrickLinkCredentials } from '@/lib/bricklink/types';

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

    // Get set number from ASIN mapping or use default test set
    const asin = request.nextUrl.searchParams.get('asin') ?? 'B0BBSB69YX';

    // First, find the BrickLink set number for this ASIN
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
          suggestion: 'Check asin_bricklink_mapping table',
        },
        { status: 404 }
      );
    }

    const setNumber = mapping.bricklink_set_number;

    const credentialsRepo = new CredentialsRepository(supabase);
    const credentials = await credentialsRepo.getCredentials<BrickLinkCredentials>(
      user.id,
      'bricklink'
    );

    if (!credentials) {
      return NextResponse.json({ error: 'BrickLink credentials not configured' }, { status: 400 });
    }

    const client = new BrickLinkClient(credentials);

    // Get price guide WITHOUT country filter to get price_detail (global)
    const globalPriceGuide = await client.getSetPriceGuide(setNumber, {
      condition: 'N',
      currencyCode: 'GBP',
    });

    // Get price guide WITH GB country filter (UK-only aggregate prices)
    const gbPriceGuide = await client.getSetPriceGuide(setNumber, {
      condition: 'N',
      countryCode: 'GB',
      currencyCode: 'GBP',
    });

    // Also try UK country code to compare
    const ukPriceGuide = await client.getSetPriceGuide(setNumber, {
      condition: 'N',
      countryCode: 'UK',
      currencyCode: 'GBP',
    });

    // Analyze the price_detail array from global response
    const details = globalPriceGuide.price_detail ?? [];
    const countryCodes = [...new Set(details.map((d) => d.seller_country_code))];

    return NextResponse.json({
      asin,
      setNumber,
      globalPrices: {
        min_price: globalPriceGuide.min_price,
        avg_price: globalPriceGuide.avg_price,
        max_price: globalPriceGuide.max_price,
        unit_quantity: globalPriceGuide.unit_quantity,
        total_quantity: globalPriceGuide.total_quantity,
      },
      gbPrices: {
        min_price: gbPriceGuide.min_price,
        avg_price: gbPriceGuide.avg_price,
        max_price: gbPriceGuide.max_price,
        unit_quantity: gbPriceGuide.unit_quantity,
        total_quantity: gbPriceGuide.total_quantity,
        note: 'countryCode=GB (ISO standard)',
      },
      ukPrices: {
        min_price: ukPriceGuide.min_price,
        avg_price: ukPriceGuide.avg_price,
        max_price: ukPriceGuide.max_price,
        unit_quantity: ukPriceGuide.unit_quantity,
        total_quantity: ukPriceGuide.total_quantity,
        note: 'countryCode=UK (non-standard but BrickLink may use it)',
      },
      priceDetailAnalysis: {
        totalCount: details.length,
        uniqueCountryCodes: countryCodes,
        note: 'seller_country_code is null for guide_type=stock - BrickLink API limitation',
        sampleEntries: details.slice(0, 3),
      },
    });
  } catch (error) {
    console.error('[GET /api/test/bricklink-debug] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
