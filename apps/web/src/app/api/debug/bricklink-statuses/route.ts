/**
 * Debug API to check BrickLink order statuses
 * GET /api/debug/bricklink-statuses
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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

    // Get distinct order statuses with counts for Jan-Jun 2025
    const { data: statusCounts, error: statusError } = await supabase
      .from('bricklink_transactions')
      .select('order_status, order_date')
      .eq('user_id', user.id)
      .gte('order_date', '2025-01-01')
      .lte('order_date', '2025-06-30');

    if (statusError) {
      return NextResponse.json({ error: statusError.message }, { status: 500 });
    }

    // Aggregate by status
    const statusMap = new Map<string, number>();
    for (const row of statusCounts || []) {
      const status = row.order_status || 'NULL';
      statusMap.set(status, (statusMap.get(status) || 0) + 1);
    }

    // Get a sample of transactions to see the actual status values
    const { data: samples, error: sampleError } = await supabase
      .from('bricklink_transactions')
      .select('bricklink_order_id, order_date, order_status, base_grand_total')
      .eq('user_id', user.id)
      .gte('order_date', '2025-01-01')
      .lte('order_date', '2025-06-30')
      .limit(10);

    if (sampleError) {
      return NextResponse.json({ error: sampleError.message }, { status: 500 });
    }

    return NextResponse.json({
      dateRange: '2025-01-01 to 2025-06-30',
      totalTransactions: statusCounts?.length || 0,
      statusCounts: Object.fromEntries(statusMap),
      samples,
    });
  } catch (error) {
    console.error('[GET /api/debug/bricklink-statuses] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
