import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { BrickLinkSyncService } from '@/lib/services';
import type { BrickLinkCredentials } from '@/lib/bricklink';

const CredentialsSchema = z.object({
  consumerKey: z.string().min(1, 'Consumer Key is required'),
  consumerSecret: z.string().min(1, 'Consumer Secret is required'),
  tokenValue: z.string().min(1, 'Token Value is required'),
  tokenSecret: z.string().min(1, 'Token Secret is required'),
});

/**
 * GET /api/integrations/bricklink/credentials
 * Check if BrickLink credentials are configured
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

    const syncService = new BrickLinkSyncService(supabase);
    const isConfigured = await syncService.isConfigured(user.id);

    return NextResponse.json({
      configured: isConfigured,
    });
  } catch (error) {
    console.error('[GET /api/integrations/bricklink/credentials] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/integrations/bricklink/credentials
 * Save BrickLink credentials
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
    const parsed = CredentialsSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const credentials: BrickLinkCredentials = parsed.data;
    const syncService = new BrickLinkSyncService(supabase);

    // Test connection FIRST with provided credentials (before saving)
    const connectionValid = await syncService.testConnectionWithCredentials(credentials);

    if (!connectionValid) {
      return NextResponse.json(
        { error: 'Connection test failed. Please verify your credentials are correct.' },
        { status: 400 }
      );
    }

    // Save credentials only if connection test passed
    await syncService.saveCredentials(user.id, credentials);

    return NextResponse.json({
      success: true,
      message: 'BrickLink credentials saved and verified',
    });
  } catch (error) {
    console.error('[POST /api/integrations/bricklink/credentials] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * DELETE /api/integrations/bricklink/credentials
 * Remove BrickLink credentials
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

    const { CredentialsRepository } = await import('@/lib/repositories');
    const credentialsRepo = new CredentialsRepository(supabase);
    await credentialsRepo.deleteCredentials(user.id, 'bricklink');

    return NextResponse.json({
      success: true,
      message: 'BrickLink credentials removed',
    });
  } catch (error) {
    console.error('[DELETE /api/integrations/bricklink/credentials] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
