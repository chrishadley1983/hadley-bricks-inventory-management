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
// Burst cycles (backlog drains) can send 20+ throttled alerts; runs locally
// where this is moot, but keep Vercel headroom for manual triggers.
export const maxDuration = 300;

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
        // Durability: persist the opportunity BEFORE attempting Discord — the
        // scan cursor has already advanced, so a throw after this point must
        // not lose the row (it would be permanently behind the cursor).
        await scanner.saveAlert(DEFAULT_USER_ID, opp, false);
        const discordResult = await discordService.sendEbayBinPartoutAlert({
          conditionMode: opp.conditionMode,
          sets: opp.sets.map((s) => ({
            setNumber: s.setNumber,
            setName: s.setName,
            theme: s.theme,
            yearFrom: s.yearFrom,
            rrpGbp: s.rrpGbp,
            usedPovGbp: s.usedPovGbp,
            newPovGbp: s.newPovGbp,
            figSharePct: s.figSharePct,
            ebayFloorGbp: s.ebayFloorGbp,
          })),
          title: opp.title,
          priceGbp: opp.priceGbp,
          postageGbp: opp.postageGbp,
          totalCostGbp: opp.totalCostGbp,
          povTotal: opp.povTotal,
          multiple: opp.multiple,
          amazonPriceGbp: opp.amazon?.amazonPriceGbp ?? null,
          amazonProfitGbp: opp.amazonProfitGbp,
          amazonMarginPct: opp.amazonMarginPct,
          amazon90dGbp: opp.amazon?.was90dGbp ?? null,
          salesRank: opp.amazon?.salesRank ?? null,
          asin: opp.amazon?.asin ?? null,
          signals: opp.signals,
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
        if (discordResult.success) {
          await scanner.saveAlert(DEFAULT_USER_ID, opp, true);
          alertsSent++;
        }
      } catch (e) {
        console.error('[ebay-bin-partout] alert failed:', (e as Error).message);
      }
      // Discord webhooks rate-limit rapid sequential posts (observed: 6 of 28
      // burst sends failed). Space them out — the run budget easily allows it.
      await new Promise((r) => setTimeout(r, 600));
    }

    // Retry sweep: pre-saved alerts whose Discord send failed (rate limit,
    // transient network) would otherwise be stuck forever behind the dedupe.
    alertsSent += await retryUnsentBinAlerts(supabase);

    const body = { success: true, ...summary(result), alertsSent, durationMs: Date.now() - startTime };
    await execution.complete(body, 200);
    return NextResponse.json(body);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await execution.complete({ error: errorMsg }, 500);
    return NextResponse.json({ error: errorMsg, durationMs: Date.now() - startTime }, { status: 500 });
  }
}

/**
 * Re-send BIN alerts whose Discord delivery failed (pre-saved with
 * discord_sent=false). Without this they are stuck forever: the dedupe sees
 * the saved row and skips them on every future cycle. Card params are
 * rebuilt from the alert row + hit-list metadata. Bounded and throttled.
 */
async function retryUnsentBinAlerts(
  supabase: ReturnType<typeof createServiceRoleClient>
): Promise<number> {
  const { data: stuck } = await supabase
    .from('ebay_auction_alerts')
    .select('*')
    .eq('user_id', DEFAULT_USER_ID)
    .eq('listing_type', 'bin')
    .eq('discord_sent', false)
    .gte('created_at', new Date(Date.now() - 24 * 3_600_000).toISOString())
    .order('created_at', { ascending: true })
    .limit(10);
  if (!stuck || stuck.length === 0) return 0;

  const setNumbers = [...new Set(stuck.flatMap((r) => String(r.set_number).split('+')))];
  const { data: hitRows } = await supabase
    .from('ebay_bin_hitlist')
    .select('*')
    .in('set_number', setNumbers);
  const hits = new Map((hitRows ?? []).map((h) => [h.set_number, h]));

  let resent = 0;
  for (const row of stuck) {
    try {
      const sets = String(row.set_number)
        .split('+')
        .map((sn) => {
          const h = hits.get(sn);
          return {
            setNumber: sn,
            setName: (h?.set_name as string | null) ?? row.set_name ?? null,
            theme: (h?.theme as string | null) ?? null,
            yearFrom: (h?.year_from as number | null) ?? null,
            rrpGbp: h?.rrp_gbp != null ? Number(h.rrp_gbp) : null,
            usedPovGbp: h?.used_pov_gbp != null ? Number(h.used_pov_gbp) : 0,
            newPovGbp: h?.new_pov_gbp != null ? Number(h.new_pov_gbp) : null,
            figSharePct: h?.fig_share_pct != null ? Number(h.fig_share_pct) : null,
            ebayFloorGbp: h?.ebay_floor_gbp != null ? Number(h.ebay_floor_gbp) : null,
          };
        });
      const result = await discordService.sendEbayBinPartoutAlert({
        conditionMode: (row.pov_condition as 'used' | 'new') ?? 'used',
        sets,
        title: `${row.ebay_title} (delayed alert — Discord retry)`,
        priceGbp: Number(row.current_bid_gbp),
        postageGbp: Number(row.postage_gbp ?? 0),
        totalCostGbp: Number(row.total_cost_gbp),
        povTotal: row.pov_sold_gbp != null ? Number(row.pov_sold_gbp) : 0,
        multiple: row.pov_multiple != null ? Number(row.pov_multiple) : null,
        amazonPriceGbp: row.amazon_price_gbp != null ? Number(row.amazon_price_gbp) : null,
        amazonProfitGbp: row.profit_gbp != null ? Number(row.profit_gbp) : null,
        amazonMarginPct: row.margin_percent != null ? Number(row.margin_percent) : null,
        amazon90dGbp: row.amazon_90d_avg_gbp != null ? Number(row.amazon_90d_avg_gbp) : null,
        asin: row.amazon_asin ?? null,
        signals: row.buy_signal ? String(row.buy_signal).split(' + ') : [],
        tier: (row.alert_tier as 'great' | 'good') ?? 'good',
        bestOfferEnabled: row.offer_suggestion_gbp != null,
        offerSuggestionGbp: row.offer_suggestion_gbp != null ? Number(row.offer_suggestion_gbp) : null,
        flags: row.flags ? String(row.flags).split(' | ') : [],
        sellerUsername: null,
        sellerScore: null,
        itemUrl: row.ebay_url ?? undefined,
        imageUrl: row.ebay_image_url ?? undefined,
        condition: undefined,
      });
      if (result.success) {
        await supabase
          .from('ebay_auction_alerts')
          .update({ discord_sent: true, discord_sent_at: new Date().toISOString() })
          .eq('id', row.id);
        resent++;
      }
    } catch (e) {
      console.error('[ebay-bin-partout] retry send failed:', (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  if (resent > 0) console.log(`[ebay-bin-partout] re-sent ${resent} previously unsent alert(s)`);
  return resent;
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
