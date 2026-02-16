/**
 * One-off Keepa sync for ASINs with eBay pricing opportunities.
 * Fetches current pricing (buy_box, sales_rank, was_price_90d, offer_count, lowest_offer)
 * for all ASINs where ebay_margin_percent >= 50%.
 *
 * Run from apps/web: npx tsx scripts/keepa-sync-ebay-opportunities.ts
 *
 * Uses KEEPA_TOKENS_PER_MINUTE=60 (EUR 129 plan rate).
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { KeepaClient } from '../src/lib/keepa/keepa-client';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const keepaApiKey = process.env.KEEPA_API_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!keepaApiKey) {
  console.error('Missing KEEPA_API_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  const TOKENS_PER_MINUTE = 60;
  const BATCH_SIZE = 10;
  const USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';
  const today = new Date().toISOString().split('T')[0];

  console.log(`[Keepa Sync] Starting targeted sync for eBay opportunity ASINs`);
  console.log(`[Keepa Sync] Rate: ${TOKENS_PER_MINUTE} tokens/min, batch size: ${BATCH_SIZE}`);
  console.log(`[Keepa Sync] Date: ${today}\n`);

  // Step 1: Get ASINs with eBay opportunities from the arbitrage view
  console.log('[Step 1] Fetching ASINs with eBay opportunities (ebay_margin_percent >= 50)...');

  const PAGE_SIZE = 1000;
  const asins: string[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('arbitrage_current_view')
      .select('asin')
      .eq('user_id', USER_ID)
      .gte('ebay_margin_percent', 50)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) {
      console.error('Error fetching ASINs:', error.message);
      process.exit(1);
    }

    const pageAsins = (data ?? []).map((r: { asin: string }) => r.asin).filter((a: string | null): a is string => !!a);
    asins.push(...pageAsins);
    hasMore = (data?.length ?? 0) === PAGE_SIZE;
    page++;
  }

  // Deduplicate
  const uniqueAsins = [...new Set(asins)];
  console.log(`[Step 1] Found ${uniqueAsins.length} unique ASINs with eBay opportunities\n`);

  if (uniqueAsins.length === 0) {
    console.log('No ASINs to process. Done.');
    return;
  }

  // Step 2: Process in batches of 10 via Keepa
  const keepa = new KeepaClient(keepaApiKey, TOKENS_PER_MINUTE);
  const totalBatches = Math.ceil(uniqueAsins.length / BATCH_SIZE);
  let updated = 0;
  let failed = 0;
  const startTime = Date.now();

  console.log(`[Step 2] Processing ${uniqueAsins.length} ASINs in ${totalBatches} batches...\n`);

  for (let i = 0; i < uniqueAsins.length; i += BATCH_SIZE) {
    const batch = uniqueAsins.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    try {
      const products = await keepa.fetchProducts(batch);

      const upsertData: {
        user_id: string;
        asin: string;
        snapshot_date: string;
        buy_box_price: number | null;
        sales_rank: number | null;
        was_price_90d: number | null;
        offer_count: number | null;
        lowest_offer_price: number | null;
      }[] = [];

      for (const product of products) {
        const pricing = keepa.extractCurrentPricing(product);

        upsertData.push({
          user_id: USER_ID,
          asin: product.asin,
          snapshot_date: today,
          buy_box_price: pricing.buyBoxPrice,
          sales_rank: pricing.salesRank,
          was_price_90d: pricing.was90dAvg,
          offer_count: pricing.offerCount,
          lowest_offer_price: pricing.lowestNewPrice,
        });
      }

      if (upsertData.length > 0) {
        const { error: upsertError } = await supabase
          .from('amazon_arbitrage_pricing')
          .upsert(upsertData, { onConflict: 'asin,snapshot_date' });

        if (upsertError) {
          console.error(`  Batch ${batchNum}/${totalBatches}: Upsert error: ${upsertError.message}`);
          failed += batch.length;
        } else {
          updated += upsertData.length;
        }
      }

      // Count missing
      const foundAsins = new Set(products.map((p) => p.asin));
      const notFound = batch.filter((a) => !foundAsins.has(a));
      if (notFound.length > 0) {
        failed += notFound.length;
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const pct = Math.round(((i + batch.length) / uniqueAsins.length) * 100);
      console.log(
        `  Batch ${batchNum}/${totalBatches}: ${products.length}/${batch.length} found, ` +
        `${updated} updated total, ${elapsed}s elapsed (${pct}%) | tokens left: ${keepa.remainingTokens}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  Batch ${batchNum}/${totalBatches}: ERROR - ${msg}`);
      failed += batch.length;
    }
  }

  const duration = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n[Done] ${updated} updated, ${failed} failed in ${duration}s`);
  console.log(`[Done] ${Math.round(duration / 60)} minutes total`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
