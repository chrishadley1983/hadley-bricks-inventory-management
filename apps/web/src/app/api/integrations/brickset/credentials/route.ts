import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { BricksetCredentialsService } from '@/lib/services';
import type { BricksetCredentials } from '@/lib/brickset';

const CredentialsSchema = z.object({
  apiKey: z.string().min(1, 'API Key is required'),
});

/**
 * GET /api/integrations/brickset/credentials
 * Check if Brickset credentials are configured
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

    const credentialsService = new BricksetCredentialsService(supabase);
    const isConfigured = await credentialsService.isConfigured(user.id);

    return NextResponse.json({
      configured: isConfigured,
    });
  } catch (error) {
    console.error('[GET /api/integrations/brickset/credentials] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/integrations/brickset/credentials
 * Save Brickset credentials
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

    const credentials: BricksetCredentials = parsed.data;
    const credentialsService = new BricksetCredentialsService(supabase);

    // Test connection FIRST with provided credentials (before saving)
    const connectionValid = await credentialsService.testConnectionWithCredentials(credentials);

    if (!connectionValid) {
      return NextResponse.json(
        { error: 'Connection test failed. Please verify your API key is correct.' },
        { status: 400 }
      );
    }

    // Save credentials only if connection test passed
    await credentialsService.saveCredentials(user.id, credentials);

    return NextResponse.json({
      success: true,
      message: 'Brickset credentials saved and verified',
    });
  } catch (error) {
    console.error('[POST /api/integrations/brickset/credentials] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * DELETE /api/integrations/brickset/credentials
 * Remove Brickset credentials
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

    const credentialsService = new BricksetCredentialsService(supabase);
    await credentialsService.deleteCredentials(user.id);

    return NextResponse.json({
      success: true,
      message: 'Brickset credentials removed',
    });
  } catch (error) {
    console.error('[DELETE /api/integrations/brickset/credentials] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
