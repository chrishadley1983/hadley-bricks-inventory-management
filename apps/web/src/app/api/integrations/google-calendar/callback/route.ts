import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { googleCalendarAuthService } from '@/lib/google-calendar';

/**
 * Get the base URL from request headers (handles proxies like ngrok)
 */
async function getBaseUrl(request: NextRequest): Promise<string> {
  const headersList = await headers();

  // Check for forwarded host (ngrok, load balancers, etc.)
  const forwardedHost = headersList.get('x-forwarded-host');
  const forwardedProto = headersList.get('x-forwarded-proto') || 'https';

  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  // Check for original host header
  const host = headersList.get('host');
  if (host && !host.includes('localhost')) {
    return `https://${host}`;
  }

  // Fallback to request origin
  return request.nextUrl.origin;
}

/**
 * GET /api/integrations/google-calendar/callback
 * Handle Google OAuth callback after user authorization
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    // Get the correct base URL (handles ngrok/proxies)
    const baseUrl = await getBaseUrl(request);

    // Handle error from Google
    if (error) {
      console.error('[Google Calendar OAuth Callback] Error from Google:', error, errorDescription);
      const errorUrl = new URL('/settings/integrations', baseUrl);
      errorUrl.searchParams.set('google_calendar_error', errorDescription || error);
      return NextResponse.redirect(errorUrl);
    }

    // Validate required parameters
    if (!code || !state) {
      const errorUrl = new URL('/settings/integrations', baseUrl);
      errorUrl.searchParams.set('google_calendar_error', 'Missing authorization code or state');
      return NextResponse.redirect(errorUrl);
    }

    // Exchange code for tokens
    const result = await googleCalendarAuthService.handleCallback(code, state);

    if (!result.success) {
      const errorUrl = new URL('/settings/integrations', baseUrl);
      errorUrl.searchParams.set('google_calendar_error', result.error || 'Failed to connect Google Calendar');
      return NextResponse.redirect(errorUrl);
    }

    // Redirect to return URL or integrations settings with success message
    const returnUrl = result.returnUrl || '/settings/integrations';
    const successUrl = new URL(returnUrl, baseUrl);
    successUrl.searchParams.set('google_calendar_success', 'true');

    return NextResponse.redirect(successUrl);
  } catch (error) {
    console.error('[GET /api/integrations/google-calendar/callback] Error:', error);
    const baseUrl = await getBaseUrl(request);
    const errorUrl = new URL('/settings/integrations', baseUrl);
    errorUrl.searchParams.set(
      'google_calendar_error',
      error instanceof Error ? error.message : 'An unexpected error occurred'
    );
    return NextResponse.redirect(errorUrl);
  }
}
