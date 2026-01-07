/**
 * Monzo OAuth Callback Route
 *
 * Handles the OAuth callback from Monzo, exchanges code for tokens,
 * and triggers full sync if this is a new connection.
 *
 * GET /api/integrations/monzo/callback?code=xxx&state=xxx
 *
 * IMPORTANT: Full sync is triggered immediately to capture all history
 * within Monzo's 5-minute window.
 */

import { NextRequest, NextResponse } from 'next/server';
import { monzoAuthService, monzoApiService } from '@/lib/monzo';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  // Handle OAuth errors
  if (error) {
    console.error('[MonzoCallback] OAuth error:', error, errorDescription);
    const returnUrl = new URL('/settings/integrations', request.url);
    returnUrl.searchParams.set('monzo_error', errorDescription || error);
    return NextResponse.redirect(returnUrl.toString());
  }

  // Validate required parameters
  if (!code || !state) {
    const returnUrl = new URL('/settings/integrations', request.url);
    returnUrl.searchParams.set('monzo_error', 'Missing authorization code or state');
    return NextResponse.redirect(returnUrl.toString());
  }

  try {
    // Handle the callback - exchanges code for tokens and stores credentials
    const result = await monzoAuthService.handleCallback(code, state);

    if (!result.success) {
      const returnUrl = new URL(result.returnUrl || '/settings/integrations', request.url);
      returnUrl.searchParams.set('monzo_error', result.error || 'Failed to connect');
      return NextResponse.redirect(returnUrl.toString());
    }

    // CRITICAL: If this is a new connection, trigger full sync immediately
    // Monzo restricts access to 90 days after 5 minutes from OAuth
    if (result.requiresFullSync) {
      // Decode state to get userId (needed for sync)
      const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());

      // Start full sync in background (don't await - redirect immediately)
      monzoApiService.performFullSync(stateData.userId).catch((err) => {
        console.error('[MonzoCallback] Background sync failed:', err);
      });
    }

    // Redirect to success
    const returnUrl = new URL(result.returnUrl || '/settings/integrations', request.url);
    returnUrl.searchParams.set('monzo_success', 'true');

    if (result.requiresFullSync) {
      returnUrl.searchParams.set('monzo_syncing', 'true');
    }

    return NextResponse.redirect(returnUrl.toString());
  } catch (error) {
    console.error('[MonzoCallback] Unexpected error:', error);
    const returnUrl = new URL('/settings/integrations', request.url);
    returnUrl.searchParams.set(
      'monzo_error',
      error instanceof Error ? error.message : 'An unexpected error occurred'
    );
    return NextResponse.redirect(returnUrl.toString());
  }
}
