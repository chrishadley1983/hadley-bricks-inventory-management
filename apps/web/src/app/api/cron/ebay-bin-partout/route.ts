/**
 * POST /api/cron/ebay-bin-partout
 *
 * eBay BIN Part-Out Watcher — runs every 15 minutes from the LOCAL bot
 * (Windows task -> localhost; zero Vercel cost). Watches newly-listed USED
 * fixed-price LEGO listings for hit-list sets whose used part-out value
 * (BrickLink, capped at New) is a high multiple of the asking price.
 *
 * Flow: config -> hit-list freshness (self-refreshing from the POV cache)
 * -> one broad newlyListed search (cursor) -> hit-list match -> buy bar ->
 * getItem confidence + flags (flag-don't-suppress) -> Discord + alert row.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/api/cron-auth';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { EbayBinPartoutScannerService } from '@/lib/ebay-auctions/ebay-bin-partout-scanner.service';
import { discordService } from '@/lib/notifications/discord.service';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';

export const runtime = 'nodejs';
export const maxDuration = 60;

const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let execution: ExecutionHandle = noopHandle;

  try {
    const unauthorized = verifyCronAuth(request);
    if (unauthorized) return unauthorized;

    execution = await jobExecutionService.start('ebay-bin-partout', 'cron');

    const supabase = createServiceRoleClient();
    const scanner = new EbayBinPartoutScannerService(supabase);

    const config = await scanner.loadConfig(DEFAULT_USER_ID);
    if (!config) {
      await execution.complete({ skipped: 'no_config' }, 200);
      return NextResponse.json({ success: true, skipped: 'no_config' });
    }

    const result = await scanner.scan(config);

    if (result.skippedReason) {
      await execution.complete({ skipped: result.skippedReason }, 200);
      return NextResponse.json({ success: true, skipped: result.skippedReason });
    }
    if (result.error) {
      await execution.complete({ error: result.error }, 500);
      return NextResponse.json({ error: result.error, ...summary(result) }, { status: 500 });
    }

    let alertsSent = 0;
    for (const opp of result.opportunities) {
      try {
        const discordResult = await discordService.sendEbayBinPartoutAlert({
          sets: opp.sets.map((s) => ({
            setNumber: s.setNumber,
            setName: s.setName,
            theme: s.theme,
            yearFrom: s.yearFrom,
            rrpGbp: s.rrpGbp,
            usedPovGbp: s.usedPovGbp,
            figSharePct: s.figSharePct,
            ebayFloorGbp: s.ebayFloorGbp,
          })),
          title: opp.title,
          priceGbp: opp.priceGbp,
          postageGbp: opp.postageGbp,
          totalCostGbp: opp.totalCostGbp,
          povTotal: opp.povTotal,
          multiple: opp.multiple,
          tier: opp.tier,
          bestOfferEnabled: opp.bestOfferEnabled,
          offerSuggestionGbp: opp.offerSuggestionGbp,
          flags: opp.flags,
          sellerUsername: opp.sellerUsername,
          sellerScore: opp.sellerScore,
          itemUrl: opp.itemUrl,
          imageUrl: opp.imageUrl,
          condition: opp.condition,
        });
        await scanner.saveAlert(DEFAULT_USER_ID, opp, discordResult.success);
        if (discordResult.success) alertsSent++;
      } catch (e) {
        console.error('[ebay-bin-partout] alert failed:', (e as Error).message);
      }
    }

    const body = { success: true, ...summary(result), alertsSent, durationMs: Date.now() - startTime };
    await execution.complete(body, 200);
    return NextResponse.json(body);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await execution.complete({ error: errorMsg }, 500);
    return NextResponse.json({ error: errorMsg, durationMs: Date.now() - startTime }, { status: 500 });
  }
}

function summary(r: {
  itemsSeen: number;
  newItems: number;
  hitlistMatches: number;
  candidates: number;
  apiCallsMade: number;
  hitlistRefreshed: boolean;
  hitlistSize: number;
}) {
  return {
    itemsSeen: r.itemsSeen,
    newItems: r.newItems,
    hitlistMatches: r.hitlistMatches,
    candidates: r.candidates,
    apiCallsMade: r.apiCallsMade,
    hitlistRefreshed: r.hitlistRefreshed,
    hitlistSize: r.hitlistSize,
  };
}
