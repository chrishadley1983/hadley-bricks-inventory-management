/**
 * Test endpoint for Brickset API
 * GET /api/test/brickset?setNumber=75198-1
 * GET /api/test/brickset?setNumber=75198-1&testUpsert=true
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { BricksetCredentialsService } from '@/lib/services';
import { BricksetApiClient, apiSetToInternal, internalToDbInsert } from '@/lib/brickset';

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

    const url = new URL(request.url);
    const setNumber = url.searchParams.get('setNumber') || '75198-1';

    // Get API key
    const credentialsService = new BricksetCredentialsService(supabase);
    const apiKey = await credentialsService.getApiKey(user.id);

    if (!apiKey) {
      return NextResponse.json({
        error: 'Brickset API key not configured',
        configured: false,
      }, { status: 400 });
    }

    console.log('[TEST /api/test/brickset] Testing API with set:', setNumber);
    console.log('[TEST /api/test/brickset] API key length:', apiKey.length);

    // Test the API directly
    const client = new BricksetApiClient(apiKey);

    // First check if key is valid
    console.log('[TEST /api/test/brickset] Checking key validity...');
    const keyValid = await client.checkKey();
    console.log('[TEST /api/test/brickset] Key valid:', keyValid);

    if (!keyValid) {
      return NextResponse.json({
        error: 'API key is invalid',
        keyValid: false,
      }, { status: 400 });
    }

    // Now try to get the set
    console.log('[TEST /api/test/brickset] Fetching set:', setNumber);
    const apiSet = await client.getSetByNumber(setNumber);

    if (!apiSet) {
      return NextResponse.json({
        error: 'Set not found',
        keyValid: true,
        setNumber,
      }, { status: 404 });
    }

    // Test upsert if requested
    const testUpsert = url.searchParams.get('testUpsert') === 'true';
    let upsertResult = null;

    if (testUpsert) {
      console.log('[TEST /api/test/brickset] Testing upsert...');
      const internalSet = apiSetToInternal(apiSet);
      console.log('[TEST /api/test/brickset] Converted EAN:', internalSet.ean);
      console.log('[TEST /api/test/brickset] Converted UPC:', internalSet.upc);

      const dbData = {
        ...internalToDbInsert(internalSet),
        raw_response: JSON.parse(JSON.stringify(apiSet)),
      };
      console.log('[TEST /api/test/brickset] DB data EAN:', dbData.ean);

      const { data, error } = await supabase
        .from('brickset_sets')
        .upsert(dbData, { onConflict: 'set_number' })
        .select()
        .single();

      if (error) {
        console.error('[TEST /api/test/brickset] Upsert error:', error);
        upsertResult = { error: error.message, code: error.code, details: error.details };
      } else {
        console.log('[TEST /api/test/brickset] Upsert success, EAN in DB:', data?.ean);
        upsertResult = { success: true, ean: data?.ean, upc: data?.upc, lastFetchedAt: data?.last_fetched_at };
      }
    }

    // Return the raw API response for debugging
    return NextResponse.json({
      success: true,
      keyValid: true,
      setNumber,
      apiResponse: {
        setID: apiSet.setID,
        number: apiSet.number,
        numberVariant: apiSet.numberVariant,
        name: apiSet.name,
        year: apiSet.year,
        theme: apiSet.theme,
        barcode: apiSet.barcode,
        LEGOCom: apiSet.LEGOCom,
        released: apiSet.released,
        lastUpdated: apiSet.lastUpdated,
      },
      upsertResult,
    });
  } catch (error) {
    console.error('[TEST /api/test/brickset] Error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    }, { status: 500 });
  }
}
