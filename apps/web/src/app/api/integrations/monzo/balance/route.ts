import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { validateAuth } from '@/lib/api/validate-auth';

/**
 * GET /api/integrations/monzo/balance
 * Latest Monzo balance snapshot plus recent history.
 * Query params: days (history window, default 30, max 365)
 *
 * Supports API-key auth (Peter bot) and session-cookie auth.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await validateAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isApiKeyAuth = !!request.headers.get('x-api-key');
    const supabase = isApiKeyAuth ? createServiceRoleClient() : await createClient();

    const days = Math.min(
      Math.max(parseInt(request.nextUrl.searchParams.get('days') || '30', 10) || 30, 1),
      365
    );
    const since = new Date();
    since.setDate(since.getDate() - days);

    const { data: history, error } = await supabase
      .from('monzo_balance_snapshots')
      .select(
        'snapshot_date, balance_pence, source, pot_total_pence, pots, latest_transaction_at, low_balance_alerted'
      )
      .eq('user_id', auth.userId)
      .gte('snapshot_date', since.toISOString().split('T')[0])
      .order('snapshot_date', { ascending: false });

    if (error) {
      console.error('[GET /api/integrations/monzo/balance] Error:', error);
      return NextResponse.json({ error: 'Failed to fetch balance snapshots' }, { status: 500 });
    }

    const latest = history?.[0] || null;
    return NextResponse.json({
      data: {
        latest: latest
          ? {
              ...latest,
              balance_gbp: Number(latest.balance_pence) / 100,
              pot_total_gbp:
                latest.pot_total_pence !== null ? Number(latest.pot_total_pence) / 100 : null,
            }
          : null,
        history: history || [],
      },
    });
  } catch (error) {
    console.error('[GET /api/integrations/monzo/balance] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
