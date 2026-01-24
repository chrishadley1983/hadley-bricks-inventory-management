import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { EbayAuthService } from '@/lib/ebay';

/**
 * GET /api/integrations/ebay/debug
 * Debug endpoint to show the OAuth URL without redirecting
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
    const authUrl = authService.getAuthorizationUrl(user.id, '/settings/integrations', 'EBAY_GB');

    // Parse the URL to show components
    const url = new URL(authUrl);
    const params: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      params[key] = value;
    });

    return NextResponse.json({
      fullUrl: authUrl,
      baseUrl: `${url.protocol}//${url.host}${url.pathname}`,
      params,
      env: {
        EBAY_REDIRECT_URI: process.env.EBAY_REDIRECT_URI,
        EBAY_CLIENT_ID: process.env.EBAY_CLIENT_ID ? `${process.env.EBAY_CLIENT_ID.substring(0, 10)}...` : 'NOT SET',
        EBAY_SANDBOX: process.env.EBAY_SANDBOX,
      },
    });
  } catch (error) {
    console.error('[GET /api/integrations/ebay/debug] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
