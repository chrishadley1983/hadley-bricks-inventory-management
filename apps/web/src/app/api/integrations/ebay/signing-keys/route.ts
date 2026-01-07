import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { EbayAuthService, ebaySignatureService } from '@/lib/ebay';

/**
 * GET /api/integrations/ebay/signing-keys
 * Check signing key status
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

    const hasKeys = await ebaySignatureService.hasSigningKeys(user.id);

    // Get key details (without sensitive data)
    // Type assertion needed until database types are regenerated
    const { data: credentials } = await supabase
      .from('ebay_credentials')
      .select('signing_key_id, signing_key_expires_at')
      .eq('user_id', user.id)
      .single() as { data: { signing_key_id: string | null; signing_key_expires_at: string | null } | null };

    return NextResponse.json({
      hasKeys,
      signingKeyId: credentials?.signing_key_id || null,
      expiresAt: credentials?.signing_key_expires_at || null,
    });
  } catch (error) {
    console.error('[GET /api/integrations/ebay/signing-keys] Error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to check signing keys',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/integrations/ebay/signing-keys
 * Regenerate signing keys
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

    // Get access token
    const authService = new EbayAuthService();
    const accessToken = await authService.getAccessToken(user.id);

    if (!accessToken) {
      return NextResponse.json(
        { error: 'Not connected to eBay or failed to get access token' },
        { status: 400 }
      );
    }

    // Regenerate signing keys
    const keys = await ebaySignatureService.regenerateSigningKeys(user.id, accessToken);

    if (!keys) {
      return NextResponse.json(
        { error: 'Failed to regenerate signing keys' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      signingKeyId: keys.signingKeyId,
      expiresAt: keys.expiresAt,
    });
  } catch (error) {
    console.error('[POST /api/integrations/ebay/signing-keys] Error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to regenerate signing keys',
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/integrations/ebay/signing-keys
 * Delete signing keys
 */
export async function DELETE() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await ebaySignatureService.deleteSigningKeys(user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/integrations/ebay/signing-keys] Error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to delete signing keys',
      },
      { status: 500 }
    );
  }
}
