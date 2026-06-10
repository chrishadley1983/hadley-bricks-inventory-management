import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { paypalAuthService } from '@/lib/paypal';

/**
 * GET /api/integrations/paypal/status
 * Get PayPal connection status for the current user
 */
export async function GET() {
  try {
    const { user, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const status = await paypalAuthService.getConnectionStatus(user.id);

    return NextResponse.json(status);
  } catch (error) {
    console.error('[GET /api/integrations/paypal/status] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
