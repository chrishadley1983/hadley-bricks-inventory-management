import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { BricqerSyncService } from '@/lib/services';
import type { BricqerCredentials } from '@/lib/bricqer';

const CredentialsSchema = z.object({
  tenantUrl: z.string().min(1, 'Tenant URL is required'),
  apiKey: z.string().min(1, 'API Key is required'),
});

/**
 * GET /api/integrations/bricqer/credentials
 * Check if Bricqer credentials are configured
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

    const syncService = new BricqerSyncService(supabase);
    const isConfigured = await syncService.isConfigured(user.id);

    return NextResponse.json({
      configured: isConfigured,
    });
  } catch (error) {
    console.error('[GET /api/integrations/bricqer/credentials] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/integrations/bricqer/credentials
 * Save Bricqer credentials
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

    const credentials: BricqerCredentials = parsed.data;
    const syncService = new BricqerSyncService(supabase);

    // Test connection FIRST with provided credentials (before saving)
    const connectionValid = await syncService.testConnectionWithCredentials(credentials);

    if (!connectionValid) {
      return NextResponse.json(
        { error: 'Connection test failed. Please verify your tenant URL and API key are correct.' },
        { status: 400 }
      );
    }

    // Save credentials only if connection test passed
    await syncService.saveCredentials(user.id, credentials);

    return NextResponse.json({
      success: true,
      message: 'Bricqer credentials saved and verified',
    });
  } catch (error) {
    console.error('[POST /api/integrations/bricqer/credentials] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * DELETE /api/integrations/bricqer/credentials
 * Remove Bricqer credentials
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

    const syncService = new BricqerSyncService(supabase);
    await syncService.deleteCredentials(user.id);

    return NextResponse.json({
      success: true,
      message: 'Bricqer credentials removed',
    });
  } catch (error) {
    console.error('[DELETE /api/integrations/bricqer/credentials] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
