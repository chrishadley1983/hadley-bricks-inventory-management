/**
 * POST /api/ebay-auctions/scan
 *
 * Manual scan trigger for the eBay Auction Sniper dashboard.
 * Same logic as the cron endpoint but without CRON_SECRET auth
 * (intended for browser use from the dashboard).
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { EbayAuctionScannerService } from '@/lib/ebay-auctions';
import { calculateMaxBidForMargin } from '@/lib/ebay-auctions/auction-profit-calculator';
import { discordService } from '@/lib/notifications/discord.service';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST() {
  try {
    const { user, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const serviceSupabase = createServiceRoleClient();
    const scanner = new EbayAuctionScannerService(serviceSupabase);

    const config = await scanner.loadConfig(user.id);
    if (!config) {
      return NextResponse.json({ error: 'No config found' }, { status: 404 });
    }

    const result = await scanner.scan(config);

    // If skipped, just log and return
    if (result.skippedReason) {
      await scanner.saveScanLog(user.id, result);
      return NextResponse.json({ success: true, skipped: result.skippedReason });
    }

    // Send Discord alerts for new opportunities
    let alertsSent = 0;

    for (const opp of result.opportunities) {
      try {
        const maxBid = opp.amazonData
          ? calculateMaxBidForMargin(
              opp.auction.postageGbp,
              opp.amazonData.amazonPrice,
              config.minMarginPercent
            )
          : null;

        const discordResult = await discordService.sendEbayAuctionAlert({
          setNumber: opp.setIdentification.setNumber,
          setName: opp.amazonData?.setName ?? opp.pov?.setName ?? null,
          ebayTitle: opp.auction.title,
          currentBid: opp.auction.currentBidGbp,
          postage: opp.auction.postageGbp,
          totalCost: opp.auction.totalCostGbp,
          bidCount: opp.auction.bidCount,
          minutesRemaining: opp.auction.minutesRemaining,
          amazonPrice: opp.amazonData?.amazonPrice ?? null,
          amazon90dAvg: opp.amazonData?.was90dAvg ?? null,
          amazonAsin: opp.amazonData?.asin ?? null,
          salesRank: opp.amazonData?.salesRank ?? null,
          profit: opp.profitBreakdown?.totalProfit ?? null,
          marginPercent: opp.profitBreakdown?.profitMarginPercent ?? null,
          roiPercent: opp.profitBreakdown?.roiPercent ?? null,
          alertTier: opp.alertTier,
          ebayUrl: opp.auction.itemUrl,
          imageUrl: opp.auction.imageUrl,
          ukRrp: opp.amazonData?.ukRrp ?? opp.pov?.rrpGbp ?? null,
          maxBid,
          conditionMode: opp.conditionMode,
          povSoldGbp: opp.pov?.soldAvgGbp ?? null,
          povForSaleGbp: opp.pov?.forSaleAvgGbp ?? null,
          povMultiple: opp.povMultiple,
          povLots: opp.pov?.lots ?? null,
          signals: opp.signals,
        });

        await scanner.saveAlert(user.id, opp, discordResult.success);
        if (discordResult.success) alertsSent++;
      } catch (err) {
        console.error('[ManualScan] Failed to send alert:', err);
        await scanner.saveAlert(user.id, opp, false);
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

        await scanner.saveJoblotAlert(user.id, joblot, discordResult.success);
        if (discordResult.success) alertsSent++;
      } catch (err) {
        console.error('[ManualScan] Failed to send joblot alert:', err);
        await scanner.saveJoblotAlert(user.id, joblot, false);
      }
    }

    result.alertsSent = alertsSent;
    await scanner.saveScanLog(user.id, result);

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
    const errorMsg = 'Internal server error';
    console.error('[ManualScan] Error:', error);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
