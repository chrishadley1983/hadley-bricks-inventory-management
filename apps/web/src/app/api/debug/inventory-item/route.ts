/**
 * Debug endpoint to inspect eBay Inventory API response
 * GET /api/debug/inventory-item?itemId=177815885004
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { EbayTradingClient } from '@/lib/platform-stock/ebay/ebay-trading.client';
import { EbayAuthService } from '@/lib/ebay/ebay-auth.service';

export async function GET(request: NextRequest) {
  const result: Record<string, unknown> = {};

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const itemId = request.nextUrl.searchParams.get('itemId');
    if (!itemId) {
      return NextResponse.json({ error: 'itemId required' }, { status: 400 });
    }

    result.itemId = itemId;

    // Get eBay access token
    const ebayAuth = new EbayAuthService();
    const accessToken = await ebayAuth.getAccessToken(user.id);

    if (!accessToken) {
      return NextResponse.json({ error: 'No eBay access token' }, { status: 400 });
    }

    result.hasAccessToken = true;

    // Step 1: Get SKU from Trading API
    try {
      const tradingClient = new EbayTradingClient({ accessToken });
      const listing = await tradingClient.getItem(itemId);
      result.tradingApiSuccess = true;
      result.tradingApiData = {
        itemId: listing.itemId,
        title: listing.title,
        sku: listing.sku,
        conditionId: listing.conditionId,
        conditionDescription: listing.conditionDescription,
      };
    } catch (tradingError) {
      result.tradingApiSuccess = false;
      result.tradingApiError = tradingError instanceof Error ? tradingError.message : 'Unknown error';
      return NextResponse.json(result);
    }

    const sku = result.tradingApiData && typeof result.tradingApiData === 'object' && 'sku' in result.tradingApiData
      ? (result.tradingApiData as { sku?: string }).sku
      : undefined;

    if (!sku) {
      result.inventoryApiSkipped = 'No SKU found for listing';
      return NextResponse.json(result);
    }

    result.sku = sku;

    // Step 2: Get inventory item from Inventory API using raw fetch
    try {
      const inventoryUrl = `https://api.ebay.com/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`;
      result.inventoryUrl = inventoryUrl;

      const fetchHeaders: Record<string, string> = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
      };

      result.requestHeaders = Object.keys(fetchHeaders);

      const response = await fetch(inventoryUrl, {
        method: 'GET',
        headers: fetchHeaders,
      });

      result.responseStatus = response.status;
      result.responseStatusText = response.statusText;
      result.responseHeaders = Object.fromEntries(response.headers.entries());

      const responseBody = await response.text();

      if (response.ok) {
        result.inventoryApiSuccess = true;
        result.inventoryItem = JSON.parse(responseBody);
      } else {
        result.inventoryApiSuccess = false;
        result.inventoryApiError = responseBody;
      }
    } catch (inventoryError) {
      result.inventoryApiSuccess = false;
      result.inventoryApiError = inventoryError instanceof Error ? inventoryError.message : 'Unknown error';
      result.inventoryApiStack = inventoryError instanceof Error ? inventoryError.stack : undefined;
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Debug] Error:', error);
    return NextResponse.json({
      ...result,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    }, { status: 500 });
  }
}
