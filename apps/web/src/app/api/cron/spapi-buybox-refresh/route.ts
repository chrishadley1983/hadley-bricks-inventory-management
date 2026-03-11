/**
 * POST /api/cron/spapi-buybox-refresh
 *
 * Lightweight SP-API refresh for ASINs that were recently repriced via Amazon sync.
 * Only processes ASINs flagged with spapi_refresh_needed = true on tracked_asins.
 *
 * If no ASINs need refresh, exits immediately (< 1s).
 * Typically processes 1-10 ASINs (vs 232 for the full daily overlay).
 *
 * Schedule: Every 30 minutes via GCP Cloud Scheduler
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { createAmazonPricingClient } from '@/lib/amazon';
import { CredentialsRepository } from '@/lib/repositories';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';
import type { AmazonCredentials } from '@/lib/amazon';

export const runtime = 'nodejs';
export const maxDuration = 300;

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

    const supabase = createServiceRoleClient();

    // Check for ASINs needing refresh (limit 100 — realistically 1-10 per cycle)
    const { data: flaggedAsins, error: fetchError } = await supabase
      .from('tracked_asins')
      .select('asin')
      .eq('user_id', DEFAULT_USER_ID)
      .eq('spapi_refresh_needed', true)
      .eq('status', 'active')
      .gt('quantity', 0)
      .limit(100);

    if (fetchError) throw new Error(`Failed to fetch flagged ASINs: ${fetchError.message}`);

    if (!flaggedAsins || flaggedAsins.length === 0) {
      // Nothing to do — exit fast
      return NextResponse.json({ success: true, message: 'No ASINs need refresh', processed: 0 });
    }

    const asinList = flaggedAsins.map((r) => r.asin);
    console.log(`[SP-API Refresh] ${asinList.length} ASINs need refresh: ${asinList.join(', ')}`);

    execution = await jobExecutionService.start('spapi-buybox-refresh', 'cron');

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
    const pricingData = await pricingClient.getCompetitivePricing(asinList);

    const today = new Date().toISOString().split('T')[0];
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
        console.error(`[SP-API Refresh] Upsert error:`, upsertError.message);
        failed += batch.length;
      } else {
        updated += batch.length;
      }
    }

    // Update tracked_asins.price with SP-API yourPrice
    const priceUpdates = pricingData.filter((p) => p.yourPrice !== null);
    for (const pricing of priceUpdates) {
      await supabase
        .from('tracked_asins')
        .update({ price: pricing.yourPrice })
        .eq('user_id', DEFAULT_USER_ID)
        .eq('asin', pricing.asin);
    }

    // Clear the refresh flag for all processed ASINs
    await supabase
      .from('tracked_asins')
      .update({ spapi_refresh_needed: false })
      .eq('user_id', DEFAULT_USER_ID)
      .in('asin', asinList);

    const duration = Date.now() - startTime;
    const buyBoxYoursCount = pricingData.filter((p) => p.buyBoxIsYours).length;

    console.log(
      `[SP-API Refresh] Done in ${Math.round(duration / 1000)}s: ${updated} updated, ${failed} failed, ${buyBoxYoursCount} own buy box`
    );

    await execution.complete(
      { processed: asinList.length, updated, buyBoxYoursCount },
      200,
      updated,
      failed
    );

    return NextResponse.json({
      success: true,
      processed: asinList.length,
      updated,
      failed,
      buyBoxYoursCount,
      duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    console.error('[SP-API Refresh] Error:', error);
    await execution.fail(error, 500);

    return NextResponse.json(
      { error: errorMsg, duration },
      { status: 500 }
    );
  }
}

// Support GET for manual testing
export async function GET(request: NextRequest) {
  return POST(request);
}
