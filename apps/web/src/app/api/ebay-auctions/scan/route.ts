/**
 * POST /api/ebay-auctions/scan
 *
 * Manual scan trigger for the eBay Auction Sniper dashboard.
 * Same logic as the cron endpoint but without CRON_SECRET auth
 * (intended for browser use from the dashboard).
 */

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { EbayAuctionScannerService } from '@/lib/ebay-auctions';
import { discordService } from '@/lib/notifications/discord.service';

export const runtime = 'nodejs';
export const maxDuration = 60;

const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';

export async function POST() {
  try {
    const supabase = createServiceRoleClient();
    const scanner = new EbayAuctionScannerService(supabase);

    const config = await scanner.loadConfig(DEFAULT_USER_ID);
    if (!config) {
      return NextResponse.json({ error: 'No config found' }, { status: 404 });
    }

    const result = await scanner.scan(config);

    // If skipped, just log and return
    if (result.skippedReason) {
      await scanner.saveScanLog(DEFAULT_USER_ID, result);
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
        console.error('[ManualScan] Failed to send alert:', err);
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
        console.error('[ManualScan] Failed to send joblot alert:', err);
        await scanner.saveJoblotAlert(DEFAULT_USER_ID, joblot, false);
      }
    }

    result.alertsSent = alertsSent;
    await scanner.saveScanLog(DEFAULT_USER_ID, result);

    return NextResponse.json({
      success: true,
      auctionsFound: result.auctionsFound,
      auctionsWithSets: result.auctionsWithSets,
      opportunitiesFound: result.opportunitiesFound,
      alertsSent,
      joblotsFound: result.joblotsFound,
      apiCallsMade: result.apiCallsMade,
      keepaCallsMade: result.keepaCallsMade,
      durationMs: result.durationMs,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[ManualScan] Error:', error);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
