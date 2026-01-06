import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { EbayAuthService } from '@/lib/ebay';

const ConnectSchema = z.object({
  // Allow both full URLs and relative paths (starting with /)
  returnUrl: z.string().refine(
    (val) => val.startsWith('/') || val.startsWith('http://') || val.startsWith('https://'),
    { message: 'Must be a valid URL or relative path starting with /' }
  ).optional(),
  marketplaceId: z.enum(['EBAY_GB', 'EBAY_US', 'EBAY_DE', 'EBAY_AU']).optional(),
});

/**
 * GET /api/integrations/ebay/connect
 * Initiate eBay OAuth flow by redirecting to eBay authorization page
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const returnUrl = searchParams.get('returnUrl') || undefined;
    const marketplaceId = searchParams.get('marketplaceId') || 'EBAY_GB';

    // Validate parameters
    const parsed = ConnectSchema.safeParse({ returnUrl, marketplaceId });
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Generate authorization URL
    const authService = new EbayAuthService();
    const authUrl = authService.getAuthorizationUrl(
      user.id,
      parsed.data.returnUrl,
      parsed.data.marketplaceId || 'EBAY_GB'
    );

    // Redirect to eBay authorization
    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error('[GET /api/integrations/ebay/connect] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/integrations/ebay/connect
 * Get the authorization URL without redirecting (for client-side navigation)
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = ConnectSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const authService = new EbayAuthService();
    const authUrl = authService.getAuthorizationUrl(
      user.id,
      parsed.data.returnUrl,
      parsed.data.marketplaceId || 'EBAY_GB'
    );

    return NextResponse.json({ authUrl });
  } catch (error) {
    console.error('[POST /api/integrations/ebay/connect] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
