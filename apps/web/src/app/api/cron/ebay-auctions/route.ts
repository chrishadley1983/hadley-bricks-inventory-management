/**
 * POST /api/cron/ebay-auctions
 *
 * Cron endpoint for eBay Auction Sniper.
 * Runs every 15 minutes to find LEGO auctions ending soon with arbitrage potential.
 *
 * Flow:
 * 1. Load config (thresholds, excluded sets, quiet hours)
 * 2. Search eBay Browse API for auctions ending within scan window
 * 3. Identify LEGO set numbers from titles
 * 4. Look up Amazon pricing from local DB (token-efficient)
 * 5. Calculate profit and filter by thresholds
 * 6. Send Discord alerts for new opportunities
 * 7. Log scan results
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { EbayAuctionScannerService } from '@/lib/ebay-auctions';
import { discordService } from '@/lib/notifications/discord.service';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';

export const runtime = 'nodejs';
export const maxDuration = 60; // 1 minute is plenty for this scan

const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let execution: ExecutionHandle = noopHandle;

  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    execution = await jobExecutionService.start('ebay-auction-sniper', 'cron');

    const supabase = createServiceRoleClient();
    const scanner = new EbayAuctionScannerService(supabase);

    // Load config
    const config = await scanner.loadConfig(DEFAULT_USER_ID);
    if (!config) {
      await execution.complete({ skipped: 'no_config' }, 200);
      return NextResponse.json({ success: true, skipped: 'no_config' });
    }

    // Run scan
    const result = await scanner.scan(config);

    // If skipped (quiet hours, disabled), just log and return
    if (result.skippedReason) {
      await scanner.saveScanLog(DEFAULT_USER_ID, result);
      await execution.complete({ skipped: result.skippedReason }, 200);
      return NextResponse.json({ success: true, skipped: result.skippedReason });
    }

    // Send Discord alerts for new opportunities
    let alertsSent = 0;

    for (const opp of result.opportunities) {
      try {
        const discordResult = await discordService.sendEbayAuctionAlert({
          setNumber: opp.setIdentification.setNumber,
          setName: opp.amazonData.setName,
          ebayTitle: opp.auction.title,
          currentBid: opp.auction.currentBidGbp,
          postage: opp.auction.postageGbp,
          totalCost: opp.auction.totalCostGbp,
          bidCount: opp.auction.bidCount,
          minutesRemaining: opp.auction.minutesRemaining,
          amazonPrice: opp.amazonData.amazonPrice,
          amazon90dAvg: opp.amazonData.was90dAvg,
          amazonAsin: opp.amazonData.asin,
          salesRank: opp.amazonData.salesRank,
          profit: opp.profitBreakdown.totalProfit,
          marginPercent: opp.profitBreakdown.profitMarginPercent,
          roiPercent: opp.profitBreakdown.roiPercent,
          alertTier: opp.alertTier,
          ebayUrl: opp.auction.itemUrl,
          imageUrl: opp.auction.imageUrl,
          ukRrp: opp.amazonData.ukRrp,
        });

        await scanner.saveAlert(DEFAULT_USER_ID, opp, discordResult.success);
        if (discordResult.success) alertsSent++;
      } catch (err) {
        console.error('[Cron EbayAuctions] Failed to send alert:', err);
        await scanner.saveAlert(DEFAULT_USER_ID, opp, false);
      }
    }

    // Send joblot alerts
    for (const joblot of result.joblots) {
      try {
        const discordResult = await discordService.sendEbayJoblotAlert({
          ebayTitle: joblot.auction.title,
          currentBid: joblot.auction.currentBidGbp,
          postage: joblot.auction.postageGbp,
          totalCost: joblot.totalCost,
          bidCount: joblot.auction.bidCount,
          minutesRemaining: joblot.auction.minutesRemaining,
          totalAmazonValue: joblot.totalAmazonValue,
          estimatedProfit: joblot.estimatedProfit,
          marginPercent: joblot.marginPercent,
          sets: joblot.sets,
          ebayUrl: joblot.auction.itemUrl,
          imageUrl: joblot.auction.imageUrl,
        });

        await scanner.saveJoblotAlert(DEFAULT_USER_ID, joblot, discordResult.success);
        if (discordResult.success) alertsSent++;
      } catch (err) {
        console.error('[Cron EbayAuctions] Failed to send joblot alert:', err);
        await scanner.saveJoblotAlert(DEFAULT_USER_ID, joblot, false);
      }
    }

    // Update result with actual alerts sent
    result.alertsSent = alertsSent;

    // Save scan log
    await scanner.saveScanLog(DEFAULT_USER_ID, result);

    const duration = Date.now() - startTime;
    console.log(
      `[Cron EbayAuctions] Scan complete: ${result.auctionsFound} auctions, ` +
      `${result.opportunitiesFound} opportunities, ${alertsSent} alerts sent (${duration}ms)`
    );

    await execution.complete(
      {
        auctionsFound: result.auctionsFound,
        opportunities: result.opportunitiesFound,
        alertsSent,
        joblots: result.joblotsFound,
      },
      200,
      result.auctionsFound,
      0
    );

    // Include debug flag to return evaluations for testing
    const isDebug = request.nextUrl.searchParams.get('debug') === '1';

    return NextResponse.json({
      success: true,
      auctionsFound: result.auctionsFound,
      auctionsWithSets: result.auctionsWithSets,
      opportunitiesFound: result.opportunitiesFound,
      alertsSent,
      joblotsFound: result.joblotsFound,
      apiCallsMade: result.apiCallsMade,
      keepaCallsMade: result.keepaCallsMade,
      durationMs: duration,
      ...(isDebug && { evaluations: result.evaluations }),
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);

    console.error('[Cron EbayAuctions] Error:', error);
    await execution.fail(error, 500);

    await discordService.sendAlert({
      title: '🔴 eBay Auction Sniper Failed',
      message: `Error: ${errorMsg}\nDuration: ${Math.round(duration / 1000)}s`,
      priority: 'high',
    });

    return NextResponse.json({ error: errorMsg, durationMs: duration }, { status: 500 });
  }
}

// Support GET for manual testing
export async function GET(request: NextRequest) {
  return POST(request);
}
