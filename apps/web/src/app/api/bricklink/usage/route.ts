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
import { requireUser } from '@/lib/api/require-user';

export const runtime = 'nodejs';

const BL_DAILY_LIMIT = 5000;

export async function GET() {
  // Auth check — any authenticated user can see usage
  const { supabase, unauthorized } = await requireUser();
  if (unauthorized) return unauthorized;

  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('bricklink_api_calls_daily')
    .select('count, by_caller, last_call_at, updated_at')
    .eq('call_date', today)
    .maybeSingle();

  if (error) {
    console.error('[api/bricklink/usage] Read error:', error);
    return NextResponse.json({ error: 'Failed to read usage' }, { status: 500 });
  }

  const count = data?.count ?? 0;
  const byCaller = (data?.by_caller as Record<string, number> | null) ?? {};

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
