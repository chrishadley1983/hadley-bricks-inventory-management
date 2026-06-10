import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { paypalAuthService } from '@/lib/paypal';

/**
 * POST /api/integrations/paypal/test
 * Test PayPal connection by attempting to get an access token
 */
export async function POST() {
  try {
    const { user, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const result = await paypalAuthService.testConnection(user.id);

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: 'Connection successful' });
  } catch (error) {
    console.error('[POST /api/integrations/paypal/test] Error:', error);
    return NextResponse.json({ success: false, error: 'Connection test failed' }, { status: 500 });
  }
}
