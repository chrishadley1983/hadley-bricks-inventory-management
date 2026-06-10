/**
 * GET /api/ebay-stock/sku-issues
 *
 * Get SKU validation issues (empty and duplicate SKUs).
 * These need to be fixed on eBay before accurate stock comparison is possible.
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { EbayStockService } from '@/lib/platform-stock/ebay';
import { EbayAuthService } from '@/lib/ebay/ebay-auth.service';

export async function GET() {
  try {
    // 1. Auth check
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    // 2. Get SKU issues
    const service = new EbayStockService(supabase, user.id, new EbayAuthService());
    const result = await service.getSkuIssues();

    // 3. Return response
    return NextResponse.json({
      data: {
        issues: result.issues,
        summary: {
          emptySkuCount: result.emptySkuCount,
          duplicateSkuCount: result.duplicateSkuCount,
          totalIssueCount: result.totalIssueCount,
        },
      },
    });
  } catch (error) {
    console.error('[GET /api/ebay-stock/sku-issues] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
