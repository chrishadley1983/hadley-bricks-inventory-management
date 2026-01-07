/**
 * Monzo Manual Token Route
 *
 * POST /api/integrations/monzo/token - Store a manually entered access token
 *
 * This is used when OAuth client creation is not available (Monzo Developer API limitation).
 * Users can paste their Playground access token instead.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { monzoAuthService } from '@/lib/monzo';
import { monzoApiService } from '@/lib/monzo';

const TokenSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
});

export async function POST(request: NextRequest) {
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

    // 2. Parse and validate body
    const body = await request.json();
    const parsed = TokenSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // 3. Store the token
    const result = await monzoAuthService.storeManualToken(user.id, parsed.data.accessToken);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // 4. Trigger full sync for new connections
    let syncResult = null;
    if (result.requiresFullSync) {
      try {
        syncResult = await monzoApiService.performFullSync(user.id);
      } catch (syncError) {
        console.error('[POST /api/integrations/monzo/token] Sync error:', syncError);
        // Don't fail the connection if sync fails - token is already stored
      }
    }

    return NextResponse.json({
      data: {
        success: true,
        message: 'Monzo connected successfully',
        syncedTransactions: syncResult?.transactionsProcessed || 0,
      },
    });
  } catch (error) {
    console.error('[POST /api/integrations/monzo/token] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
