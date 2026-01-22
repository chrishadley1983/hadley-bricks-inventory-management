/**
 * Sales Rank Bootstrap API
 *
 * POST - Trigger sales rank collection from Amazon SP-API
 *
 * This endpoint fetches sales rankings for seeded ASINs to enable
 * prioritisation of popular retired sets in the Vinted watchlist.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { AmazonPricingClient } from '@/lib/amazon/amazon-pricing.client';
import { CredentialsRepository } from '@/lib/repositories/credentials.repository';
import type { AmazonCredentials } from '@/lib/amazon/types';
import { z } from 'zod';

// =============================================================================
// SCHEMAS
// =============================================================================

const BootstrapRequestSchema = z.object({
  /** Maximum number of batches to process (for testing) */
  batchLimit: z.number().int().positive().optional(),
  /** Skip first N batches */
  offset: z.number().int().nonnegative().optional().default(0),
  /** Dry run - don't save results */
  dryRun: z.boolean().optional().default(false),
});

// SP-API limit for competitive pricing requests
const BATCH_SIZE = 20;
// Delay between batches to respect rate limits (ms)
const BATCH_DELAY_MS = 1000;

// =============================================================================
// POST - Trigger sales rank collection
// =============================================================================

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // Check auth
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Parse request body
  let body: z.infer<typeof BootstrapRequestSchema>;
  try {
    const rawBody = await request.json();
    const parsed = BootstrapRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    body = parsed.data;
  } catch {
    body = { offset: 0, dryRun: false };
  }

  const { batchLimit, offset, dryRun } = body;

  try {
    // Get Amazon credentials
    const credentialsRepo = new CredentialsRepository(supabase);
    const credentials = await credentialsRepo.getCredentials<AmazonCredentials>(
      user.id,
      'amazon'
    );

    if (!credentials) {
      return NextResponse.json(
        { error: 'Amazon credentials not configured' },
        { status: 400 }
      );
    }

    // Get all seeded ASINs with status 'found'
    const { data: seededAsins, error: fetchError } = await supabase
      .from('seeded_asins')
      .select('id, asin')
      .eq('discovery_status', 'found')
      .not('asin', 'is', null);

    if (fetchError) {
      console.error('[sales-rank/bootstrap] Failed to fetch seeded ASINs:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch seeded ASINs' },
        { status: 500 }
      );
    }

    if (!seededAsins || seededAsins.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No seeded ASINs to process',
        processed: 0,
        rankings: 0,
      });
    }

    // Create Amazon client
    const amazonClient = new AmazonPricingClient(credentials);

    // Split into batches of 20 (SP-API limit)
    const asinsWithIds = seededAsins.map((sa) => ({
      id: sa.id,
      asin: sa.asin!,
    }));

    const batches: typeof asinsWithIds[] = [];
    for (let i = 0; i < asinsWithIds.length; i += BATCH_SIZE) {
      batches.push(asinsWithIds.slice(i, i + BATCH_SIZE));
    }

    // Apply offset and limit
    const startBatch = offset;
    const endBatch = batchLimit ? Math.min(startBatch + batchLimit, batches.length) : batches.length;
    const batchesToProcess = batches.slice(startBatch, endBatch);

    console.log(
      `[sales-rank/bootstrap] Processing ${batchesToProcess.length} batches (${startBatch}-${endBatch} of ${batches.length})`
    );

    const results: Array<{
      seeded_asin_id: string;
      asin: string;
      sales_rank: number | null;
      fetched_at: string;
    }> = [];

    // Process each batch
    for (let batchIndex = 0; batchIndex < batchesToProcess.length; batchIndex++) {
      const batch = batchesToProcess[batchIndex];
      const asins = batch.map((b) => b.asin);

      try {
        // Fetch competitive pricing (includes sales rank)
        const pricingData = await amazonClient.getCompetitivePricing(asins);

        // Map results
        for (const pricing of pricingData) {
          const seededAsin = batch.find((b) => b.asin === pricing.asin);
          if (seededAsin) {
            results.push({
              seeded_asin_id: seededAsin.id,
              asin: pricing.asin,
              sales_rank: pricing.salesRank || null,
              fetched_at: new Date().toISOString(),
            });
          }
        }
      } catch (err) {
        console.warn(`[sales-rank/bootstrap] Batch ${batchIndex + startBatch} failed:`, err);
        // Continue with next batch
      }

      // Delay between batches (except for last batch)
      if (batchIndex < batchesToProcess.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    // Store results if not dry run
    if (!dryRun && results.length > 0) {
      const { error: insertError } = await supabase
        .from('seeded_asin_rankings')
        .insert(results);

      if (insertError) {
        console.error('[sales-rank/bootstrap] Failed to insert rankings:', insertError);
        return NextResponse.json(
          { error: 'Failed to store rankings' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      message: dryRun ? 'Dry run completed' : 'Bootstrap completed',
      processed: batchesToProcess.length * BATCH_SIZE,
      rankings: results.length,
      rankingsWithValue: results.filter((r) => r.sales_rank !== null).length,
      batchesProcessed: batchesToProcess.length,
      totalBatches: batches.length,
      dryRun,
    });
  } catch (error) {
    console.error('[sales-rank/bootstrap] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
