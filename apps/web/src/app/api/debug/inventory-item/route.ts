/**
 * Debug endpoint to inspect eBay Inventory API response
 * GET /api/debug/inventory-item?itemId=177815885004
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { EbayApiAdapter } from '@/lib/ebay/ebay-api.adapter';
import { EbayTradingClient } from '@/lib/ebay/trading-client';
import { EbayAuthService } from '@/lib/ebay/ebay-auth.service';

export async function GET(request: NextRequest) {
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

    // Get eBay access token
    const ebayAuth = new EbayAuthService();
    const accessToken = await ebayAuth.getAccessToken(user.id);

    if (!accessToken) {
      return NextResponse.json({ error: 'No eBay access token' }, { status: 400 });
    }

    // First get SKU from Trading API
    const tradingClient = new EbayTradingClient(accessToken);
    const listing = await tradingClient.getItem(itemId);

    if (!listing.sku) {
      return NextResponse.json({
        error: 'No SKU found for listing',
        listing: {
          itemId: listing.itemId,
          title: listing.title,
          sku: listing.sku,
        }
      }, { status: 400 });
    }

    // Now get inventory item from Inventory API
    const adapter = new EbayApiAdapter({
      accessToken,
      marketplaceId: 'EBAY_GB',
      userId: user.id,
    });

    const inventoryItem = await adapter.getInventoryItem(listing.sku);

    return NextResponse.json({
      itemId,
      sku: listing.sku,
      inventoryItem,
    });
  } catch (error) {
    console.error('[Debug] Error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    }, { status: 500 });
  }
}
