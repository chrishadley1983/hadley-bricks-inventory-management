/**
 * Vinted Data Cleanup Cron Job
 *
 * POST - Run cleanup tasks for Vinted scanner data
 *
 * Cleanup tasks:
 * 1. Expire active opportunities older than 7 days
 * 2. Delete old scan logs (keep 30 days)
 * 3. Delete dismissed/expired opportunities (keep 14 days)
 * 4. Send daily summary notification
 *
 * Schedule: Daily at 00:00 UTC (via Vercel cron)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { pushoverService } from '@/lib/notifications/pushover.service';

// Lazy initialization to avoid build-time errors
let supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return supabase;
}

// Verify cron secret
function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return false;

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.warn('[vinted-cleanup] CRON_SECRET not configured');
    return false;
  }

  return authHeader === `Bearer ${cronSecret}`;
}

export async function POST(request: NextRequest) {
  // Verify cron secret
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    tasks: {},
  };

  try {
    // =========================================================================
    // Task 1: Expire old active opportunities (> 7 days)
    // =========================================================================
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: expiredOpps, error: expireError } = await getSupabase()
      .from('vinted_opportunities')
      .update({ status: 'expired' })
      .eq('status', 'active')
      .lt('found_at', sevenDaysAgo.toISOString())
      .select('id');

    results.tasks = {
      ...results.tasks as Record<string, unknown>,
      expireOpportunities: {
        success: !expireError,
        count: expiredOpps?.length ?? 0,
        error: expireError?.message,
      },
    };

    // =========================================================================
    // Task 2: Delete old scan logs (> 30 days)
    // =========================================================================
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: deletedLogs, error: logError } = await getSupabase()
      .from('vinted_scan_log')
      .delete()
      .lt('created_at', thirtyDaysAgo.toISOString())
      .select('id');

    results.tasks = {
      ...results.tasks as Record<string, unknown>,
      deleteScanLogs: {
        success: !logError,
        count: deletedLogs?.length ?? 0,
        error: logError?.message,
      },
    };

    // =========================================================================
    // Task 3: Delete old dismissed/expired opportunities (> 14 days)
    // =========================================================================
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const { data: deletedOpps, error: deleteOppError } = await getSupabase()
      .from('vinted_opportunities')
      .delete()
      .in('status', ['dismissed', 'expired'])
      .lt('found_at', fourteenDaysAgo.toISOString())
      .select('id');

    results.tasks = {
      ...results.tasks as Record<string, unknown>,
      deleteOldOpportunities: {
        success: !deleteOppError,
        count: deletedOpps?.length ?? 0,
        error: deleteOppError?.message,
      },
    };

    // =========================================================================
    // Task 4: Generate and send daily summary
    // =========================================================================
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get yesterday's stats (aggregate across all users for single-user system)
    const { data: dailyStats } = await getSupabase()
      .from('vinted_scan_log')
      .select('scan_type, status, opportunities_found')
      .gte('created_at', yesterday.toISOString())
      .lt('created_at', today.toISOString());

    if (dailyStats && dailyStats.length > 0) {
      const broadSweeps = dailyStats.filter(
        (s) => s.scan_type === 'broad_sweep' && s.status === 'success'
      ).length;
      const watchlistScans = dailyStats.filter(
        (s) => s.scan_type === 'watchlist' && s.status === 'success'
      ).length;
      const opportunitiesFound = dailyStats.reduce(
        (sum, s) => sum + (s.opportunities_found || 0),
        0
      );

      // Get near misses count from yesterday
      const { data: nearMisses } = await getSupabase()
        .from('vinted_watchlist_stats')
        .select('near_miss_found')
        .gte('updated_at', yesterday.toISOString())
        .lt('updated_at', today.toISOString());

      const nearMissesFound = nearMisses?.reduce(
        (sum, s) => sum + (s.near_miss_found || 0),
        0
      ) || 0;

      // Send daily summary via Pushover
      await pushoverService.sendVintedDailySummary({
        broadSweeps,
        watchlistScans,
        opportunitiesFound,
        nearMissesFound,
      });

      results.tasks = {
        ...results.tasks as Record<string, unknown>,
        dailySummary: {
          success: true,
          broadSweeps,
          watchlistScans,
          opportunitiesFound,
          nearMissesFound,
        },
      };
    } else {
      results.tasks = {
        ...results.tasks as Record<string, unknown>,
        dailySummary: {
          success: true,
          skipped: true,
          reason: 'No scans yesterday',
        },
      };
    }

    results.completedAt = new Date().toISOString();
    return NextResponse.json(results);
  } catch (error) {
    console.error('[vinted-cleanup] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        results,
      },
      { status: 500 }
    );
  }
}
