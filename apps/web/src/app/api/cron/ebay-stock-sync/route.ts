/**
 * POST /api/cron/ebay-stock-sync
 *
 * Cron endpoint that refreshes the `platform_listings` snapshot from eBay.
 *
 * This is the data the eBay negotiation (offer) engine reads to decide which
 * listings it can send offers on. `getEligibleItems` silently drops any
 * eBay-eligible listing that isn't present in `platform_listings`, so if this
 * snapshot goes stale, newly-listed items never receive offers even when eBay
 * reports interested buyers. Keeping it fresh on a schedule is the fix.
 *
 * Runs daily, before the first negotiation run of the day (08:00 UK), so each
 * day's offer passes see the current set of active listings.
 *
 * Called by Vercel Cron (Authorization: Bearer <CRON_SECRET>).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { EbayStockService } from '@/lib/platform-stock/ebay';
import { EbayAuthService } from '@/lib/ebay/ebay-auth.service';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max — full active-listings fetch can be slow

export async function POST(request: NextRequest) {
  let execution: ExecutionHandle = noopHandle;
  try {
    // Verify cron secret (Vercel adds Authorization header for cron jobs)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[Cron eBay Stock Sync] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    execution = await jobExecutionService.start('ebay-stock-sync', 'cron');

    console.log('[Cron eBay Stock Sync] Starting eBay listings import');

    const supabase = createServiceRoleClient();

    // Refresh listings for the same users the offer engine runs for, so the
    // negotiation cron always has a fresh snapshot to read.
    const { data: configs, error: configError } = await supabase
      .from('negotiation_config')
      .select('user_id')
      .eq('automation_enabled', true);

    if (configError) {
      console.error('[Cron eBay Stock Sync] Error fetching configs:', configError);
      throw configError;
    }

    if (!configs || configs.length === 0) {
      console.log('[Cron eBay Stock Sync] No users with automation enabled');
      await execution.complete({ usersProcessed: 0, totalListings: 0 }, 200, 0, 0);
      return NextResponse.json({
        success: true,
        message: 'No users with automation enabled',
        usersProcessed: 0,
        totalListings: 0,
      });
    }

    console.log(`[Cron eBay Stock Sync] Processing ${configs.length} user(s)`);

    let totalListings = 0;
    let usersFailed = 0;
    const userResults: Array<{
      userId: string;
      status: string;
      listings?: number;
      error?: string;
    }> = [];

    for (const config of configs) {
      try {
        // Service-role client lets EbayStockService read eBay credentials and
        // write platform_listings without a user session. EbayAuthService must
        // also receive the service-role client — otherwise it falls back to a
        // cookie-based client with no session and can't read ebay_credentials
        // (RLS), failing with "eBay not connected".
        const service = new EbayStockService(
          supabase,
          config.user_id,
          new EbayAuthService(undefined, supabase)
        );

        // Don't stack imports if one is already running for this user.
        const latestImport = await service.getLatestImport();
        if (latestImport?.status === 'processing') {
          console.log(
            `[Cron eBay Stock Sync] Import already in progress for user ${config.user_id}, skipping`
          );
          userResults.push({ userId: config.user_id, status: 'skipped_in_progress' });
          continue;
        }

        const result = await service.triggerImport();
        const count = result.processedRows ?? result.totalRows ?? 0;
        totalListings += count;

        userResults.push({ userId: config.user_id, status: result.status, listings: count });
        console.log(
          `[Cron eBay Stock Sync] User ${config.user_id}: imported ${count} listings (${result.status})`
        );
      } catch (error) {
        usersFailed++;
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(
          `[Cron eBay Stock Sync] Error importing for user ${config.user_id}:`,
          error
        );
        userResults.push({ userId: config.user_id, status: 'error', error: errorMsg });
      }
    }

    console.log(
      `[Cron eBay Stock Sync] Complete: ${totalListings} listings across ${configs.length} user(s), ${usersFailed} failed`
    );

    await execution.complete(
      { usersProcessed: configs.length, totalListings },
      200,
      totalListings,
      usersFailed
    );

    return NextResponse.json({
      success: true,
      usersProcessed: configs.length,
      totalListings,
      usersFailed,
      userResults,
    });
  } catch (error) {
    console.error('[Cron eBay Stock Sync] Error:', error);
    await execution.fail(error, 500);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 }
    );
  }
}

// Also support GET for manual testing (requires same auth)
export async function GET(request: NextRequest) {
  return POST(request);
}
