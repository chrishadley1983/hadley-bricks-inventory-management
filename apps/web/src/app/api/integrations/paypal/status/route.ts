import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { paypalAuthService } from '@/lib/paypal';

/**
 * GET /api/integrations/paypal/status
 * Get PayPal connection status for the current user
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

    const status = await paypalAuthService.getConnectionStatus(user.id);

    return NextResponse.json(status);
  } catch (error) {
    console.error('[GET /api/integrations/paypal/status] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
