/**
 * POST /api/cron/spapi-buybox-overlay
 *
 * Daily SP-API overlay for in-stock ASINs (~232).
 * Calls getCompetitivePricing to get accurate buy_box_is_yours, buy_box_price,
 * your_price, and offer_count — data that Keepa cannot provide (no seller identity).
 *
 * Timing: 232 ASINs = 12 batches of 20 x 10s delay = ~2 min (within 5-min Vercel limit)
 * Schedule: Daily at 6am UTC (after Keepa has had overnight to backfill)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { createAmazonPricingClient } from '@/lib/amazon';
import { CredentialsRepository } from '@/lib/repositories';
import { discordService } from '@/lib/notifications';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';
import type { AmazonCredentials } from '@/lib/amazon';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes

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

    execution = await jobExecutionService.start('spapi-buybox-overlay', 'cron');

    const supabase = createServiceRoleClient();

    // Get all in-stock ASINs (qty >= 1)
    const inStockAsins: string[] = [];
    const PAGE_SIZE = 1000;
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from('tracked_asins')
        .select('asin')
        .eq('user_id', DEFAULT_USER_ID)
        .eq('status', 'active')
        .gt('quantity', 0)
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (error) throw new Error(`Failed to fetch tracked ASINs: ${error.message}`);
      if (!data || data.length === 0) break;
      inStockAsins.push(...data.map((r) => r.asin));
      hasMore = data.length === PAGE_SIZE;
      page++;
    }

    console.log(`[SP-API Overlay] Found ${inStockAsins.length} in-stock ASINs`);

    if (inStockAsins.length === 0) {
      await execution.complete({ processed: 0 }, 200, 0, 0);
      return NextResponse.json({ success: true, complete: true, processed: 0 });
    }

    // Get Amazon credentials
    const credentialsRepo = new CredentialsRepository(supabase);
    const credentials = await credentialsRepo.getCredentials<AmazonCredentials>(
      DEFAULT_USER_ID,
      'amazon'
    );

    if (!credentials) {
      throw new Error('Amazon credentials not configured');
    }

    const pricingClient = createAmazonPricingClient(credentials);

    // Call SP-API getCompetitivePricing (auto-batches at 20 ASINs, 10s delays)
    console.log(`[SP-API Overlay] Calling getCompetitivePricing for ${inStockAsins.length} ASINs`);
    const pricingData = await pricingClient.getCompetitivePricing(inStockAsins);

    const today = new Date().toISOString().split('T')[0];
    let updated = 0;
    let failed = 0;

    // Upsert SP-API data into amazon_arbitrage_pricing
    // We only update the fields SP-API provides — Keepa fields are preserved
    const UPSERT_BATCH = 100;
    for (let i = 0; i < pricingData.length; i += UPSERT_BATCH) {
      const batch = pricingData.slice(i, i + UPSERT_BATCH);

      const upsertData = batch.map((pricing) => ({
        user_id: DEFAULT_USER_ID,
        asin: pricing.asin,
        snapshot_date: today,
        buy_box_price: pricing.buyBoxPrice,
        buy_box_is_yours: pricing.buyBoxIsYours,
        your_price: pricing.yourPrice,
        offer_count: (pricing.newOfferCount ?? 0) + (pricing.usedOfferCount ?? 0),
      }));

      const { error: upsertError } = await supabase
        .from('amazon_arbitrage_pricing')
        .upsert(upsertData, { onConflict: 'asin,snapshot_date' });

      if (upsertError) {
        console.error(`[SP-API Overlay] Upsert error:`, upsertError.message);
        failed += batch.length;
      } else {
        updated += batch.length;
      }
    }

    // Also update tracked_asins.price with SP-API yourPrice where available
    const priceUpdates = pricingData.filter((p) => p.yourPrice !== null);
    for (let i = 0; i < priceUpdates.length; i += 20) {
      const batch = priceUpdates.slice(i, i + 20);
      await Promise.all(
        batch.map((pricing) =>
          supabase
            .from('tracked_asins')
            .update({ price: pricing.yourPrice })
            .eq('user_id', DEFAULT_USER_ID)
            .eq('asin', pricing.asin)
        )
      );
    }

    const duration = Date.now() - startTime;
    const buyBoxYoursCount = pricingData.filter((p) => p.buyBoxIsYours).length;

    console.log(
      `[SP-API Overlay] Done in ${Math.round(duration / 1000)}s: ${updated} updated, ${failed} failed, ${buyBoxYoursCount} own buy box`
    );

    // Send Discord summary
    await discordService.sendSyncStatus({
      title: 'SP-API Buy Box Overlay',
      message: `${updated}/${inStockAsins.length} ASINs updated\n${buyBoxYoursCount} own the buy box\n${failed} failed\nDuration: ${Math.round(duration / 1000)}s`,
      success: failed === 0,
    });

    await execution.complete(
      { processed: inStockAsins.length, updated, buyBoxYoursCount },
      200,
      updated,
      failed
    );

    return NextResponse.json({
      success: true,
      complete: true,
      processed: inStockAsins.length,
      updated,
      failed,
      buyBoxYoursCount,
      duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    console.error('[SP-API Overlay] Error:', error);
    await execution.fail(error, 500);

    await discordService.sendAlert({
      title: 'SP-API Buy Box Overlay Failed',
      message: `Error: ${errorMsg}\nDuration: ${Math.round(duration / 1000)}s`,
      priority: 'high',
    });

    return NextResponse.json(
      { error: errorMsg, complete: true, duration },
      { status: 500 }
    );
  }
}

// Support GET for manual testing
export async function GET(request: NextRequest) {
  return POST(request);
}
