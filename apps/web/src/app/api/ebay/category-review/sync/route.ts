/**
 * eBay Category Review Sync API Route
 *
 * POST /api/ebay/category-review/sync - Sync all eBay offer categories
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { EbayCategoryReviewService } from '@/lib/ebay/ebay-category-review.service';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const service = new EbayCategoryReviewService(supabase, user.id);
    const result = await service.syncCategories();

    return NextResponse.json({ data: result }, { status: 200 });
  } catch (error) {
    console.error('[POST /api/ebay/category-review/sync] Error:', error);
    return NextResponse.json({ error: 'Failed to sync eBay categories' }, { status: 500 });
  }
}
