/**
 * GET /api/purchases/review-queue
 *
 * Fetch skipped email purchases that need manual review.
 * Returns items from processed_purchase_emails where status = 'skipped'.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '50', 10)));
    const offset = (page - 1) * pageSize;

    // Fetch skipped items
    const { data, error, count } = await supabase
      .from('processed_purchase_emails')
      .select('id, email_id, source, order_reference, email_subject, email_date, item_name, cost, seller_username, skip_reason, processed_at', { count: 'exact' })
      .eq('status', 'skipped')
      .order('processed_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('[GET /api/purchases/review-queue] Error:', error);
      return NextResponse.json({ error: 'Failed to fetch review queue' }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        items: data ?? [],
        page,
        pageSize,
        total: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / pageSize),
      },
    });
  } catch (error) {
    console.error('[GET /api/purchases/review-queue] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
