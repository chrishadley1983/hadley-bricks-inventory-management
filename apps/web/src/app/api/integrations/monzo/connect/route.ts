/**
 * Monzo Connect Route
 *
 * Initiates OAuth 2.0 flow by redirecting user to Monzo authorization page.
 * GET /api/integrations/monzo/connect?returnUrl=/settings/integrations
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { monzoAuthService } from '@/lib/monzo';

export async function GET(request: NextRequest) {
  try {
    // 1. Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Get return URL from query params
    const { searchParams } = new URL(request.url);
    const returnUrl = searchParams.get('returnUrl') || '/settings/integrations';

    // 3. Generate authorization URL
    const authUrl = monzoAuthService.getAuthorizationUrl(user.id, returnUrl);

    // 4. Redirect to Monzo
    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error('[GET /api/integrations/monzo/connect] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
