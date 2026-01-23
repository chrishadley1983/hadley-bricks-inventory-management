import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { CredentialsRepository } from '@/lib/repositories';
import { QuickFileService } from '@/lib/services/quickfile.service';
import type { QuickFileCredentials } from '@/types/mtd-export';

const CredentialsSchema = z.object({
  accountNumber: z.string().min(1, 'Account Number is required'),
  apiKey: z.string().min(1, 'API Key is required'),
});

/**
 * GET /api/integrations/quickfile/credentials
 * Check if QuickFile credentials are configured
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

    const credentialsRepo = new CredentialsRepository(supabase);
    const hasCredentials = await credentialsRepo.hasCredentials(user.id, 'quickfile');

    return NextResponse.json({
      configured: hasCredentials,
    });
  } catch (error) {
    console.error('[GET /api/integrations/quickfile/credentials] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/integrations/quickfile/credentials
 * Save QuickFile credentials
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

    const credentials: QuickFileCredentials = parsed.data;

    // Test connection before saving
    const quickFileService = new QuickFileService(credentials);
    const connectionValid = await quickFileService.testConnection();

    if (!connectionValid) {
      return NextResponse.json(
        { error: 'Invalid QuickFile credentials. Please check your Account Number and API Key.' },
        { status: 400 }
      );
    }

    // Save credentials only if connection test passed
    const credentialsRepo = new CredentialsRepository(supabase);
    await credentialsRepo.saveCredentials(user.id, 'quickfile', credentials);

    return NextResponse.json({
      success: true,
      message: 'QuickFile credentials saved and verified',
    });
  } catch (error) {
    console.error('[POST /api/integrations/quickfile/credentials] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * DELETE /api/integrations/quickfile/credentials
 * Remove QuickFile credentials
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

    const credentialsRepo = new CredentialsRepository(supabase);
    await credentialsRepo.deleteCredentials(user.id, 'quickfile');

    return NextResponse.json({
      success: true,
      message: 'QuickFile credentials removed',
    });
  } catch (error) {
    console.error('[DELETE /api/integrations/quickfile/credentials] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
