/**
 * eBay Category Review API Route
 *
 * GET /api/ebay/category-review - Get comparison report of eBay categories
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { EbayCategoryReviewService } from '@/lib/ebay/ebay-category-review.service';

export async function GET() {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const service = new EbayCategoryReviewService(supabase, user.id);
    const report = await service.getComparisonReport();

    return NextResponse.json({ data: report }, { status: 200 });
  } catch (error) {
    console.error('[GET /api/ebay/category-review] Error:', error);
    return NextResponse.json({ error: 'Failed to generate category review report' }, { status: 500 });
  }
}
