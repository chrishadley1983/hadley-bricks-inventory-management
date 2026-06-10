/**
 * /api/ebay-stock/import
 *
 * POST: Trigger a new eBay listing import
 * GET: Get import history
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { EbayStockService } from '@/lib/platform-stock/ebay';
import { EbayAuthService } from '@/lib/ebay/ebay-auth.service';

/**
 * POST /api/ebay-stock/import
 * Trigger a new eBay listing import via Trading API
 */
export async function POST() {
  try {
    // 1. Auth check
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    // 2. Check if there's already an import in progress
    const service = new EbayStockService(supabase, user.id, new EbayAuthService());
    const latestImport = await service.getLatestImport();

    if (latestImport?.status === 'processing') {
      return NextResponse.json({ error: 'An import is already in progress' }, { status: 409 });
    }

    // 3. Trigger import
    const importResult = await service.triggerImport();

    // 4. Return response
    return NextResponse.json({
      data: {
        import: importResult,
        message: 'eBay listing import completed successfully',
      },
    });
  } catch (error) {
    console.error('[POST /api/ebay-stock/import] Error:', error);

    // Check for specific error types
    const errorMessage = 'Internal server error';

    if (errorMessage.includes('not connected')) {
      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * GET /api/ebay-stock/import
 * Get import history
 */
export async function GET(request: NextRequest) {
  try {
    // 1. Auth check
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    // 2. Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '10', 10);

    // 3. Get import history
    const service = new EbayStockService(supabase, user.id, new EbayAuthService());
    const imports = await service.getImportHistory(limit);

    // 4. Return response
    return NextResponse.json({
      data: {
        imports,
      },
    });
  } catch (error) {
    console.error('[GET /api/ebay-stock/import] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
