import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { EbayAuthService, EbayApiAdapter } from '@/lib/ebay';

/**
 * GET /api/integrations/ebay/test
 * Test the eBay connection by making a simple API call
 */
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

    const authService = new EbayAuthService();

    // Check connection status
    const status = await authService.getConnectionStatus(user.id);
    if (!status.isConnected) {
      return NextResponse.json(
        { success: false, error: 'Not connected to eBay' },
        { status: 400 }
      );
    }

    // Get access token
    const accessToken = await authService.getAccessToken(user.id);
    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: 'Failed to get access token' },
        { status: 400 }
      );
    }

    // Try to fetch orders (limit 1) to test the connection
    const api = new EbayApiAdapter({
      accessToken,
      marketplaceId: status.marketplaceId || 'EBAY_GB',
      sandbox: process.env.EBAY_SANDBOX === 'true',
    });

    const orders = await api.getOrders({ limit: 1 });

    return NextResponse.json({
      success: true,
      message: 'Connection successful',
      details: {
        marketplace: status.marketplaceId,
        ebayUsername: status.ebayUsername,
        ordersAvailable: orders.total,
      },
    });
  } catch (error) {
    console.error('[GET /api/integrations/ebay/test] Error:', error);

    const message = error instanceof Error ? error.message : 'Connection test failed';

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
