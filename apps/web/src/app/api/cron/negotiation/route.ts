/**
 * POST /api/cron/negotiation
 *
 * Cron endpoint for automated negotiation offer sending.
 * Runs every 4 hours between 8am-8pm UK time (8:00, 12:00, 16:00, 20:00).
 *
 * This endpoint is called by Vercel Cron Jobs.
 *
 * Flow:
 * 1. Sync offer statuses (detect accepted offers from orders, mark expired)
 * 2. Process and send new offers to eligible listings
 * 3. Send notifications
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getNegotiationService } from '@/lib/ebay/negotiation.service';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max

export async function POST(request: NextRequest) {
  try {
    // Verify cron secret (Vercel adds Authorization header for cron jobs)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      console.warn('[Cron Negotiation] CRON_SECRET not configured - running without auth check');
    } else if (authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[Cron Negotiation] Unauthorized request - invalid or missing Authorization header');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[Cron Negotiation] Starting automated offer processing');

    const supabase = createServiceRoleClient();

    // Get all users with automation enabled
    const { data: configs, error: configError } = await supabase
      .from('negotiation_config')
      .select('user_id')
      .eq('automation_enabled', true);

    if (configError) {
      console.error('[Cron Negotiation] Error fetching configs:', configError);
      throw configError;
    }

    if (!configs || configs.length === 0) {
      console.log('[Cron Negotiation] No users with automation enabled');
      return NextResponse.json({
        success: true,
        message: 'No users with automation enabled',
        usersProcessed: 0,
        totalOffersSent: 0,
      });
    }

    console.log(`[Cron Negotiation] Processing ${configs.length} user(s)`);

    let totalOffersSent = 0;
    let totalOffersFailed = 0;
    let totalStatusSynced = 0;
    const userResults: Array<{
      userId: string;
      statusSync: { accepted: number; expired: number };
      offersSent: number;
      offersFailed: number;
      error?: string;
    }> = [];

    for (const config of configs) {
      try {
        const service = getNegotiationService();
        const initialized = await service.init(config.user_id);

        if (!initialized) {
          console.warn(
            `[Cron Negotiation] Failed to initialize for user ${config.user_id}`
          );
          userResults.push({
            userId: config.user_id,
            statusSync: { accepted: 0, expired: 0 },
            offersSent: 0,
            offersFailed: 0,
            error: 'Failed to connect to eBay',
          });
          continue;
        }

        // Step 1: Sync offer statuses (detect accepted, mark expired)
        console.log(`[Cron Negotiation] Syncing offer statuses for user ${config.user_id}`);
        const syncResult = await service.syncOfferStatuses(config.user_id);
        totalStatusSynced += syncResult.total;

        console.log(
          `[Cron Negotiation] User ${config.user_id} status sync: ` +
          `${syncResult.accepted} accepted, ${syncResult.expired} expired`
        );

        // Step 2: Process and send new offers
        const result = await service.processOffers(config.user_id, 'automated');

        totalOffersSent += result.offersSent;
        totalOffersFailed += result.offersFailed;

        userResults.push({
          userId: config.user_id,
          statusSync: { accepted: syncResult.accepted, expired: syncResult.expired },
          offersSent: result.offersSent,
          offersFailed: result.offersFailed,
        });

        // Step 3: Send notification for this user
        if (result.offersSent > 0 || result.offersFailed > 0) {
          await service.sendAutomatedRunNotification(result);
        }

        console.log(
          `[Cron Negotiation] User ${config.user_id}: ${result.offersSent} sent, ${result.offersFailed} failed`
        );
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : 'Unknown error';
        console.error(
          `[Cron Negotiation] Error processing user ${config.user_id}:`,
          error
        );
        userResults.push({
          userId: config.user_id,
          statusSync: { accepted: 0, expired: 0 },
          offersSent: 0,
          offersFailed: 0,
          error: errorMsg,
        });
      }
    }

    console.log(
      `[Cron Negotiation] Complete: ${totalStatusSynced} statuses synced, ` +
      `${totalOffersSent} offers sent, ${totalOffersFailed} failed`
    );

    return NextResponse.json({
      success: true,
      usersProcessed: configs.length,
      totalStatusSynced,
      totalOffersSent,
      totalOffersFailed,
      userResults,
    });
  } catch (error) {
    console.error('[Cron Negotiation] Error:', error);
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
