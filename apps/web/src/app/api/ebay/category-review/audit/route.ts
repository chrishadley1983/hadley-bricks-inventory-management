/**
 * eBay Category Audit API Route
 *
 * GET /api/ebay/category-review/audit - Run a full audit of item + store categories
 *
 * Fetches all active eBay listings via Trading API and checks:
 * 1. Item category correctness (complete sets not in Bricks/Parts)
 * 2. Store category completeness (no items in "Other Items" default)
 * 3. Store category correctness (assignment matches rules)
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { EbayCategoryReviewService } from '@/lib/ebay/ebay-category-review.service';

export const maxDuration = 120;

export async function GET() {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const service = new EbayCategoryReviewService(supabase, user.id);
    const report = await service.runFullAudit();

    return NextResponse.json({ data: report }, { status: 200 });
  } catch (error) {
    console.error('[GET /api/ebay/category-review/audit] Error:', error);
    const message = 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
