/**
 * GET /api/bricklink/usage
 *
 * Returns today's BrickLink API call count + per-caller breakdown.
 *
 * BL's 5000/day quota has no real-time enforcement (no 429, no usage endpoint,
 * no rate-limit headers) so this counter is our only visibility. The number
 * here is what *our* codebase has spent; Bricqer's share is invisible.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const BL_DAILY_LIMIT = 5000;

interface DailyCountRow {
  count: number;
  by_caller: Record<string, number> | null;
  last_call_at: string | null;
  updated_at: string;
}

export async function GET() {
  const supabase = await createClient();

  // Auth check — any authenticated user can see usage
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);

  // Cast to any: bricklink_api_calls_daily is added in this PR's migration
  // and is not yet in generated DB types until `npm run db:types` runs post-merge.
  const { data, error } = await (supabase as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: DailyCountRow | null; error: { message: string } | null }>;
        };
      };
    };
  })
    .from('bricklink_api_calls_daily')
    .select('count, by_caller, last_call_at, updated_at')
    .eq('call_date', today)
    .maybeSingle();

  if (error) {
    console.error('[api/bricklink/usage] Read error:', error);
    return NextResponse.json({ error: 'Failed to read usage' }, { status: 500 });
  }

  const count = data?.count ?? 0;
  const byCaller = data?.by_caller ?? {};

  return NextResponse.json({
    date: today,
    count,
    byCaller,
    dailyLimit: BL_DAILY_LIMIT,
    remainingTotal: Math.max(0, BL_DAILY_LIMIT - count),
    lastCallAt: data?.last_call_at ?? null,
    updatedAt: data?.updated_at ?? null,
    note:
      'count covers only calls made by this codebase. Bricqer (and any other app sharing the consumer key) is not counted here — BL exposes no endpoint to see their share.',
  });
}
