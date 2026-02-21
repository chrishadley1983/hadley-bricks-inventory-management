/**
 * Amazon Listings Import API
 *
 * POST /api/platform-stock/amazon/import - Trigger a new Amazon listings import
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { AmazonStockService } from '@/lib/platform-stock';

export async function POST(_request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const service = new AmazonStockService(supabase, user.id);

    console.log(`[POST /api/platform-stock/amazon/import] User ${user.id} triggering import`);

    // Trigger the import (this can take several minutes)
    const importResult = await service.triggerImport();

    return NextResponse.json(
      {
        data: {
          import: importResult,
          message: 'Import completed successfully',
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/platform-stock/amazon/import] Error:', error);

    // Check for specific error types
    if (error instanceof Error) {
      if (error.message.includes('credentials not configured')) {
        return NextResponse.json(
          {
            error: 'Amazon credentials not configured',
            details: 'Please set up Amazon integration in Settings > Integrations first.',
          },
          { status: 400 }
        );
      }

      if (error.message.includes('Failed to refresh token')) {
        return NextResponse.json(
          {
            error: 'Amazon authentication failed',
            details:
              'Your Amazon credentials may have expired. Please reconnect your Amazon account.',
          },
          { status: 401 }
        );
      }
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Import failed',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/platform-stock/amazon/import - Get import history
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '10', 10), 50);

    const service = new AmazonStockService(supabase, user.id);
    const history = await service.getImportHistory(limit);

    return NextResponse.json({ data: { imports: history } });
  } catch (error) {
    console.error('[GET /api/platform-stock/amazon/import] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
