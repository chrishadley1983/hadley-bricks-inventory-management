import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { EbayAuthService } from '@/lib/ebay';

/**
 * GET /api/integrations/ebay/status
 * Get eBay connection status for the current user
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
    const status = await authService.getConnectionStatus(user.id);

    return NextResponse.json({
      isConnected: status.isConnected,
      ebayUsername: status.ebayUsername,
      marketplaceId: status.marketplaceId,
      expiresAt: status.expiresAt?.toISOString(),
      scopes: status.scopes,
      needsRefresh: status.needsRefresh,
    });
  } catch (error) {
    console.error('[GET /api/integrations/ebay/status] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
