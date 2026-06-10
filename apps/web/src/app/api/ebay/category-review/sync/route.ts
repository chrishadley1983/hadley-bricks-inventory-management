/**
 * eBay Category Review Sync API Route
 *
 * POST /api/ebay/category-review/sync - Sync all eBay offer categories
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { EbayCategoryReviewService } from '@/lib/ebay/ebay-category-review.service';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST() {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const service = new EbayCategoryReviewService(supabase, user.id);
    const result = await service.syncCategories();

    return NextResponse.json({ data: result }, { status: 200 });
  } catch (error) {
    console.error('[POST /api/ebay/category-review/sync] Error:', error);
    return NextResponse.json({ error: 'Failed to sync eBay categories' }, { status: 500 });
  }
}
