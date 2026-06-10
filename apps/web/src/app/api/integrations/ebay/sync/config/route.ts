import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/require-user';
import { ebayAutoSyncService } from '@/lib/ebay';

const UpdateConfigSchema = z.object({
  autoSyncEnabled: z.boolean().optional(),
  autoSyncIntervalHours: z.number().min(1).max(168).optional(), // 1 hour to 1 week
});

/**
 * GET /api/integrations/ebay/sync/config
 * Get sync configuration
 */
export async function GET() {
  try {
    const { user, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const config = await ebayAutoSyncService.getConfig(user.id);

    return NextResponse.json({
      config: config || {
        autoSyncEnabled: false,
        autoSyncIntervalHours: 24,
      },
    });
  } catch (error) {
    console.error('[GET /api/integrations/ebay/sync/config] Error:', error);

    return NextResponse.json(
      {
        error: 'Internal server error',
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/integrations/ebay/sync/config
 * Update sync configuration
 */
export async function PUT(request: NextRequest) {
  try {
    const { user, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const body = await request.json();
    const parsed = UpdateConfigSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const config = await ebayAutoSyncService.updateConfig(user.id, parsed.data);

    return NextResponse.json({ config });
  } catch (error) {
    console.error('[PUT /api/integrations/ebay/sync/config] Error:', error);

    return NextResponse.json(
      {
        error: 'Internal server error',
      },
      { status: 500 }
    );
  }
}
