/**
 * POST /api/cron/spapi-buybox-overlay
 *
 * Resumable SP-API overlay for in-stock ASINs (~232).
 * Calls getCompetitivePricing to get accurate buy_box_is_yours, buy_box_price,
 * your_price, and offer_count — data that Keepa cannot provide (no seller identity).
 *
 * Processes CHUNK_SIZE ASINs per invocation (~40s) to stay within Vercel's 60s limit.
 * Uses cron_progress table to track cursor across invocations.
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
const JOB_NAME = 'spapi-buybox-overlay';

/** Process 80 ASINs per call (4 batches of 20 × 10s delay = ~40s, under 60s limit) */
const CHUNK_SIZE = 80;

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

    // Get cursor from cron_progress — last ASIN processed today
    const { data: progress } = await supabase
      .from('cron_progress')
      .select('last_cursor, run_date')
      .eq('job_name', JOB_NAME)
      .single();

    let cursorIndex = 0;
    if (progress && progress.run_date === today && progress.last_cursor) {
      // Find where we left off
      const idx = inStockAsins.indexOf(progress.last_cursor);
      if (idx >= 0) {
        cursorIndex = idx + 1; // Start after the last processed ASIN
      }
    } else if (progress && progress.run_date !== today) {
      // New day — reset cursor
      cursorIndex = 0;
    }

    // Check if we're done
    if (cursorIndex >= inStockAsins.length) {
      // All done — send summary
      const { count } = await supabase
        .from('amazon_arbitrage_pricing')
        .select('*', { count: 'exact', head: true })
        .eq('snapshot_date', today)
        .eq('buy_box_is_yours', true)
        .in('asin', inStockAsins.slice(0, 500)); // Check first batch for count

      await discordService.sendSyncStatus({
        title: 'SP-API Buy Box Overlay',
        message: `${inStockAsins.length} ASINs updated\n~${count ?? 0}+ own the buy box`,
        success: true,
      });

      return NextResponse.json({
        success: true,
        complete: true,
        processed: inStockAsins.length,
        remaining: 0,
      });
    }

    // Process a chunk
    const chunk = inStockAsins.slice(cursorIndex, cursorIndex + CHUNK_SIZE);
    const isFirstChunk = cursorIndex === 0;

    if (isFirstChunk) {
      execution = await jobExecutionService.start(JOB_NAME, 'cron');
    }

    console.log(
      `[SP-API Overlay] Processing ASINs ${cursorIndex + 1}-${cursorIndex + chunk.length} of ${inStockAsins.length}`
    );

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

    // Save cursor progress
    const lastAsin = chunk[chunk.length - 1];
    await supabase
      .from('cron_progress')
      .upsert(
        { job_name: JOB_NAME, last_cursor: lastAsin, run_date: today, updated_at: new Date().toISOString() },
        { onConflict: 'job_name' }
      );

    const duration = Date.now() - startTime;
    const newCursorIndex = cursorIndex + chunk.length;
    const isComplete = newCursorIndex >= inStockAsins.length;
    const buyBoxYoursCount = pricingData.filter((p) => p.buyBoxIsYours).length;

    console.log(
      `[SP-API Overlay] Chunk done in ${Math.round(duration / 1000)}s: ${updated} updated, ${failed} failed, ${buyBoxYoursCount} own buy box, ${inStockAsins.length - newCursorIndex} remaining`
    );

    if (isComplete) {
      await discordService.sendSyncStatus({
        title: 'SP-API Buy Box Overlay',
        message: `${inStockAsins.length} ASINs updated\n${buyBoxYoursCount} own buy box (last chunk)\n${failed} failed`,
        success: failed === 0,
      });

      if (isFirstChunk) {
        await execution.complete(
          { processed: inStockAsins.length, updated, buyBoxYoursCount },
          200,
          updated,
          failed
        );
      }
    }

    return NextResponse.json({
      success: true,
      complete: isComplete,
      processed: newCursorIndex,
      total: inStockAsins.length,
      updated,
      failed,
      remaining: inStockAsins.length - newCursorIndex,
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
