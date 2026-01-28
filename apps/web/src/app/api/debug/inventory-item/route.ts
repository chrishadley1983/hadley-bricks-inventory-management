/**
 * Debug endpoint to inspect eBay Inventory API response
 * GET /api/debug/inventory-item?itemId=177815885004 - Test GET
 * GET /api/debug/inventory-item?itemId=177815885004&testPut=true - Test PUT (skip GET)
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
    const testPut = request.nextUrl.searchParams.get('testPut') === 'true';

    if (!itemId) {
      return NextResponse.json({ error: 'itemId required' }, { status: 400 });
    }

    result.itemId = itemId;
    result.testMode = testPut ? 'PUT (skip GET)' : 'GET';

    // Get eBay access token
    const ebayAuth = new EbayAuthService();
    const accessToken = await ebayAuth.getAccessToken(user.id);

    if (!accessToken) {
      return NextResponse.json({ error: 'No eBay access token' }, { status: 400 });
    }

    result.hasAccessToken = true;

    // Step 1: Get listing data from Trading API
    const tradingClient = new EbayTradingClient({ accessToken });
    let listing;
    try {
      listing = await tradingClient.getItem(itemId);
      result.tradingApiSuccess = true;
      result.tradingApiData = {
        itemId: listing.itemId,
        title: listing.title,
        sku: listing.sku,
        conditionId: listing.conditionId,
        conditionDescription: listing.conditionDescription,
        description: listing.description?.substring(0, 200) + '...',
        itemSpecifics: listing.itemSpecifics,
        pictureUrls: listing.pictureUrls,
      };
    } catch (tradingError) {
      result.tradingApiSuccess = false;
      result.tradingApiError = tradingError instanceof Error ? tradingError.message : 'Unknown error';
      return NextResponse.json(result);
    }

    const sku = listing.sku;
    if (!sku) {
      result.inventoryApiSkipped = 'No SKU found for listing';
      return NextResponse.json(result);
    }

    result.sku = sku;

    const inventoryUrl = `https://api.ebay.com/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`;
    result.inventoryUrl = inventoryUrl;

    const fetchHeaders: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
    };

    if (testPut) {
      // TEST PUT: Build payload from Trading API data, skip GET entirely
      fetchHeaders['Content-Language'] = 'en-GB';
      result.requestHeaders = Object.keys(fetchHeaders);

      // Map condition ID to enum
      const conditionMap: Record<number, string> = {
        1000: 'NEW',
        1500: 'NEW_OTHER',
        3000: 'USED_GOOD',
      };
      const conditionEnum = conditionMap[listing.conditionId || 3000] || 'USED_GOOD';

      // Build inventory item from Trading API data
      const inventoryItem = {
        product: {
          title: listing.title,
          description: listing.description,
          aspects: listing.itemSpecifics?.reduce((acc: Record<string, string[]>, spec: { name: string; value: string }) => {
            acc[spec.name] = [spec.value];
            return acc;
          }, {} as Record<string, string[]>) || {},
          imageUrls: listing.pictureUrls || [],
        },
        condition: conditionEnum,
        conditionDescription: listing.conditionDescription,
        availability: {
          shipToLocationAvailability: {
            quantity: 1,
          },
        },
      };

      result.putPayload = {
        condition: inventoryItem.condition,
        conditionDescription: inventoryItem.conditionDescription,
        productTitle: inventoryItem.product.title?.substring(0, 50) + '...',
        aspectCount: Object.keys(inventoryItem.product.aspects).length,
        imageCount: inventoryItem.product.imageUrls.length,
      };

      try {
        const response = await fetch(inventoryUrl, {
          method: 'PUT',
          headers: fetchHeaders,
          body: JSON.stringify(inventoryItem),
        });

        result.responseStatus = response.status;
        result.responseStatusText = response.statusText;

        const responseBody = await response.text();

        if (response.ok || response.status === 204) {
          result.inventoryApiSuccess = true;
          result.inventoryApiMessage = 'PUT succeeded! Can update existing SKU without GET.';
        } else {
          result.inventoryApiSuccess = false;
          result.inventoryApiError = responseBody;
        }
      } catch (putError) {
        result.inventoryApiSuccess = false;
        result.inventoryApiError = putError instanceof Error ? putError.message : 'Unknown error';
      }
    } else {
      // TEST GET: Original behavior
      result.requestHeaders = Object.keys(fetchHeaders);

      try {
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
      } catch (getError) {
        result.inventoryApiSuccess = false;
        result.inventoryApiError = getError instanceof Error ? getError.message : 'Unknown error';
      }
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
