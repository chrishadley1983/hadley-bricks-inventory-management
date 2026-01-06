import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { EbayAuthService } from '@/lib/ebay';

/**
 * POST /api/integrations/ebay/disconnect
 * Disconnect eBay account by removing stored credentials
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

    const authService = new EbayAuthService();
    await authService.disconnect(user.id);

    return NextResponse.json({
      success: true,
      message: 'eBay account disconnected successfully',
    });
  } catch (error) {
    console.error('[POST /api/integrations/ebay/disconnect] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/integrations/ebay/disconnect
 * Alternative HTTP method for disconnect (for RESTful compatibility)
 */
export async function DELETE() {
  return POST();
}
