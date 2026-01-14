/**
 * GET /api/ebay/connection/scopes
 *
 * Check OAuth scopes for listing management
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ebayAuthService } from '@/lib/ebay/ebay-auth.service';

export async function GET(_request: NextRequest) {
  try {
    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check connection status
    const isConnected = await ebayAuthService.isConnected(user.id);

    if (!isConnected) {
      return NextResponse.json({
        data: {
          isConnected: false,
          hasScopes: false,
          missingScopes: [],
          currentScopes: [],
        },
      });
    }

    // Check listing management scopes
    const scopeResult = await ebayAuthService.hasListingManagementScopes(user.id);

    return NextResponse.json({
      data: {
        isConnected: true,
        hasScopes: scopeResult.hasScopes,
        missingScopes: scopeResult.missingScopes,
        currentScopes: scopeResult.currentScopes,
      },
    });
  } catch (error) {
    console.error('[GET /api/ebay/connection/scopes] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
