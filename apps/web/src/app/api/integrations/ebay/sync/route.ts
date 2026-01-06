import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { EbayFulfilmentService, EbayFinancesService } from '@/lib/ebay';

const SyncSchema = z.object({
  type: z.enum(['orders', 'transactions', 'payouts', 'all']).default('orders'),
  sinceDate: z.string().datetime().optional(),
  fullSync: z.boolean().optional(),
  limit: z.number().positive().optional(),
});

/**
 * POST /api/integrations/ebay/sync
 * Trigger a sync of eBay data
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = SyncSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { type, sinceDate, fullSync, limit } = parsed.data;

    const fulfilmentService = new EbayFulfilmentService();
    const financesService = new EbayFinancesService();

    const results: Record<string, unknown> = {};

    // Sync orders
    if (type === 'orders' || type === 'all') {
      const orderResult = await fulfilmentService.syncOrders(user.id, {
        sinceDate: sinceDate ? new Date(sinceDate) : undefined,
        fullSync,
        limit,
      });
      results.orders = orderResult;
    }

    // Sync transactions
    if (type === 'transactions' || type === 'all') {
      const transactionResult = await financesService.syncTransactions(user.id, {
        sinceDate: sinceDate ? new Date(sinceDate) : undefined,
        limit,
      });
      results.transactions = transactionResult;
    }

    // Sync payouts
    if (type === 'payouts' || type === 'all') {
      const payoutResult = await financesService.syncPayouts(user.id, {
        sinceDate: sinceDate ? new Date(sinceDate) : undefined,
        limit,
      });
      results.payouts = payoutResult;
    }

    // Check for any failures
    const hasFailures = Object.values(results).some(
      (r) => typeof r === 'object' && r !== null && 'success' in r && !(r as { success: boolean }).success
    );

    return NextResponse.json({
      success: !hasFailures,
      results,
    });
  } catch (error) {
    console.error('[POST /api/integrations/ebay/sync] Error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Sync failed',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/integrations/ebay/sync
 * Get sync history/status
 */
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

    // Get recent sync logs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: syncLogs, error } = await (supabase as any)
      .from('ebay_sync_log')
      .select('*')
      .eq('user_id', user.id)
      .order('started_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('[GET /api/integrations/ebay/sync] Error fetching logs:', error);
      return NextResponse.json({ error: 'Failed to fetch sync logs' }, { status: 500 });
    }

    return NextResponse.json({
      logs: syncLogs || [],
    });
  } catch (error) {
    console.error('[GET /api/integrations/ebay/sync] Error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch sync status',
      },
      { status: 500 }
    );
  }
}
