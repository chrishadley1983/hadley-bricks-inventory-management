/**
 * eBay Category Review API Route
 *
 * GET /api/ebay/category-review - Get comparison report of eBay categories
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { EbayCategoryReviewService } from '@/lib/ebay/ebay-category-review.service';

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

    const service = new EbayCategoryReviewService(supabase, user.id);
    const report = await service.getComparisonReport();

    return NextResponse.json({ data: report }, { status: 200 });
  } catch (error) {
    console.error('[GET /api/ebay/category-review] Error:', error);
    return NextResponse.json({ error: 'Failed to generate category review report' }, { status: 500 });
  }
}
