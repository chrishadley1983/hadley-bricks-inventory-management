/**
 * POST /api/cron/negotiation
 *
 * Cron endpoint for automated negotiation offer sending.
 * Runs every 4 hours between 8am-8pm UK time (8:00, 12:00, 16:00, 20:00).
 *
 * This endpoint is called by Vercel Cron Jobs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getNegotiationService } from '@/lib/ebay/negotiation.service';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max

export async function POST(request: NextRequest) {
  try {
    // Verify cron secret (Vercel adds Authorization header for cron jobs)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[Cron Negotiation] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[Cron Negotiation] Starting automated offer processing');

    const supabase = await createClient();

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
    const userResults: Array<{
      userId: string;
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
            offersSent: 0,
            offersFailed: 0,
            error: 'Failed to connect to eBay',
          });
          continue;
        }

        // Process offers for this user
        const result = await service.processOffers(config.user_id, 'automated');

        totalOffersSent += result.offersSent;
        totalOffersFailed += result.offersFailed;

        userResults.push({
          userId: config.user_id,
          offersSent: result.offersSent,
          offersFailed: result.offersFailed,
        });

        // Send notification for this user
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
          offersSent: 0,
          offersFailed: 0,
          error: errorMsg,
        });
      }
    }

    console.log(
      `[Cron Negotiation] Complete: ${totalOffersSent} offers sent, ${totalOffersFailed} failed`
    );

    return NextResponse.json({
      success: true,
      usersProcessed: configs.length,
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
