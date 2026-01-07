import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { paypalAuthService } from '@/lib/paypal';

/**
 * POST /api/integrations/paypal/test
 * Test PayPal connection by attempting to get an access token
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await paypalAuthService.testConnection(user.id);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, message: 'Connection successful' });
  } catch (error) {
    console.error('[POST /api/integrations/paypal/test] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Connection test failed' },
      { status: 500 }
    );
  }
}
