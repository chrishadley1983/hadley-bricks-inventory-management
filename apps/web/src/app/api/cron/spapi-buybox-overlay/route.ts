/**
 * POST /api/cron/spapi-buybox-overlay
 *
 * Resumable SP-API overlay for in-stock ASINs (~232).
 * Calls getCompetitivePricing to get accurate buy_box_is_yours, buy_box_price,
 * your_price, and offer_count — data that Keepa cannot provide (no seller identity).
 *
 * Processes CHUNK_SIZE ASINs per invocation (~40s) to stay within Vercel's 60s limit.
 * The GCP pricing-sync-driver calls this in a loop until { complete: true }.
 *
 * Schedule: Daily at 6am UTC via GCP pricing-sync-driver
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
export const maxDuration = 60;

const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';

/** Process 80 ASINs per call (4 batches of 20 × 10s delay = ~40s, under 60s limit) */
const CHUNK_SIZE = 80;

/**
 * Supabase table: spapi_overlay_progress
 * Tracks cursor across invocations for the same day.
 * We use a simple key-value approach via tracked_asins ordering.
 */

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

    const supabase = createServiceRoleClient();
    const today = new Date().toISOString().split('T')[0];

    // Get all in-stock ASINs (sorted for deterministic cursor)
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
        .order('asin', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (error) throw new Error(`Failed to fetch tracked ASINs: ${error.message}`);
      if (!data || data.length === 0) break;
      inStockAsins.push(...data.map((r) => r.asin));
      hasMore = data.length === PAGE_SIZE;
      page++;
    }

    if (inStockAsins.length === 0) {
      return NextResponse.json({ success: true, complete: true, processed: 0 });
    }

    // Determine which ASINs already have today's SP-API snapshot (buy_box_is_yours is not null/default)
    // We find ASINs that DON'T yet have a snapshot with your_price set today (SP-API sets your_price)
    const alreadyDone = new Set<string>();
    for (let i = 0; i < inStockAsins.length; i += 500) {
      const batch = inStockAsins.slice(i, i + 500);
      const { data } = await supabase
        .from('amazon_arbitrage_pricing')
        .select('asin')
        .in('asin', batch)
        .eq('snapshot_date', today)
        .not('your_price', 'is', null);

      if (data) {
        for (const row of data) {
          alreadyDone.add(row.asin);
        }
      }
    }

    const remaining = inStockAsins.filter((a) => !alreadyDone.has(a));

    console.log(
      `[SP-API Overlay] ${inStockAsins.length} total, ${alreadyDone.size} already done today, ${remaining.length} remaining`
    );

    if (remaining.length === 0) {
      // All done — send summary and mark complete
      const { data: todaySnapshots } = await supabase
        .from('amazon_arbitrage_pricing')
        .select('buy_box_is_yours')
        .eq('snapshot_date', today)
        .in('asin', inStockAsins);

      const buyBoxYoursCount = todaySnapshots?.filter((r) => r.buy_box_is_yours).length ?? 0;

      await discordService.sendSyncStatus({
        title: 'SP-API Buy Box Overlay',
        message: `${inStockAsins.length}/${inStockAsins.length} ASINs updated\n${buyBoxYoursCount} own the buy box\n0 failed`,
        success: true,
      });

      return NextResponse.json({
        success: true,
        complete: true,
        processed: inStockAsins.length,
        remaining: 0,
        buyBoxYoursCount,
      });
    }

    // Process a chunk
    const chunk = remaining.slice(0, CHUNK_SIZE);
    const isFirstChunk = alreadyDone.size === 0;

    if (isFirstChunk) {
      execution = await jobExecutionService.start('spapi-buybox-overlay', 'cron');
    }

    console.log(`[SP-API Overlay] Processing chunk of ${chunk.length} ASINs`);

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
    const pricingData = await pricingClient.getCompetitivePricing(chunk);

    let updated = 0;
    let failed = 0;

    // Upsert SP-API data
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

    // Update tracked_asins.price with SP-API yourPrice
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
    const newRemaining = remaining.length - chunk.length;
    const isComplete = newRemaining <= 0;
    const buyBoxYoursCount = pricingData.filter((p) => p.buyBoxIsYours).length;

    console.log(
      `[SP-API Overlay] Chunk done in ${Math.round(duration / 1000)}s: ${updated} updated, ${failed} failed, ${buyBoxYoursCount} own buy box, ${newRemaining} remaining`
    );

    if (isComplete) {
      const totalProcessed = alreadyDone.size + chunk.length;

      await discordService.sendSyncStatus({
        title: 'SP-API Buy Box Overlay',
        message: `${totalProcessed}/${inStockAsins.length} ASINs updated\n${buyBoxYoursCount} own buy box in this chunk\n${failed} failed`,
        success: failed === 0,
      });

      if (isFirstChunk) {
        await execution.complete(
          { processed: totalProcessed, updated, buyBoxYoursCount },
          200,
          updated,
          failed
        );
      }
    }

    return NextResponse.json({
      success: true,
      complete: isComplete,
      processed: alreadyDone.size + chunk.length,
      updated,
      failed,
      remaining: newRemaining,
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
