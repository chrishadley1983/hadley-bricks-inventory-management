import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { EbayAuthService } from '@/lib/ebay';

/**
 * GET /api/integrations/ebay/status
 * Get eBay connection status for the current user
 */
export async function GET() {
  try {
    const { user, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

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
