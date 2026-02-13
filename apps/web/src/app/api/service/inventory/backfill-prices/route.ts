/**
 * Service API: Backfill Missing Prices
 *
 * POST/GET - Find inventory items with NULL listing_value and non-NULL amazon_asin,
 * then resolve prices via Keepa (DB snapshots first, then API fallback).
 *
 * Query params:
 *   - limit: Max items to process (default 50, max 200)
 *   - dryRun: If "true", report what would be updated without writing (default false)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withServiceAuth } from '@/lib/middleware/service-auth';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { KeepaClient } from '@/lib/keepa/keepa-client';

export async function POST(request: NextRequest) {
  return withServiceAuth(request, ['read', 'write'], async () => {
    return handleBackfill(request);
  });
}

export async function GET(request: NextRequest) {
  return withServiceAuth(request, ['read'], async () => {
    return handleBackfill(request);
  });
}

async function handleBackfill(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get('limit') ?? '50'), 200);
  const dryRun = searchParams.get('dryRun') === 'true';

  const supabase = createServiceRoleClient();

  // 1. Find inventory items missing listing_value that have an ASIN
  const { data: items, error: fetchError } = await supabase
    .from('inventory_items')
    .select('id, set_number, amazon_asin, listing_value')
    .is('listing_value', null)
    .not('amazon_asin', 'is', null)
    .limit(limit);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  if (!items || items.length === 0) {
    return NextResponse.json({
      success: true,
      message: 'No items with missing prices found',
      processed: 0,
      updated: 0,
    });
  }

  console.log(`[Backfill Prices] Found ${items.length} items missing listing_value`);

  const results: Array<{
    id: string;
    set_number: string;
    asin: string;
    price: number | null;
    source: string;
  }> = [];

  // 2. Tier 1: Check price_snapshots for existing Keepa data
  //    Process in batches of 15 set_nums to stay well under Supabase 1000-row limit
  //    (each set can have 30+ snapshots, so 15 × 30 = ~450 rows per batch)
  const setNums = items.map(i => `${i.set_number}-1`);
  const dbPriceMap = new Map<string, number>();

  for (let i = 0; i < setNums.length; i += 15) {
    const batch = setNums.slice(i, i + 15);
    const { data: snapshots } = await supabase
      .from('price_snapshots')
      .select('set_num, price_gbp')
      .in('set_num', batch)
      .eq('source', 'keepa_amazon_buybox')
      .order('date', { ascending: false });

    if (snapshots) {
      for (const snap of snapshots) {
        if (!dbPriceMap.has(snap.set_num)) {
          dbPriceMap.set(snap.set_num, Number(snap.price_gbp));
        }
      }
    }
  }

  const stillMissing: typeof items = [];
  for (const item of items) {
    const dbPrice = dbPriceMap.get(`${item.set_number}-1`);
    if (dbPrice) {
      results.push({
        id: item.id,
        set_number: item.set_number,
        asin: item.amazon_asin!,
        price: dbPrice,
        source: 'keepa_db',
      });
    } else {
      stillMissing.push(item);
    }
  }

  console.log(`[Backfill Prices] Keepa DB resolved ${results.length}/${items.length}, ${stillMissing.length} need API lookup`);

  // 3. Tier 2: Keepa API for remaining items
  if (stillMissing.length > 0) {
    const keepaClient = new KeepaClient();
    if (keepaClient.isConfigured()) {
      const asins = stillMissing.map(i => i.amazon_asin!);

      for (let i = 0; i < asins.length; i += 10) {
        const batch = asins.slice(i, i + 10);
        console.log(`[Backfill Prices] Keepa API batch ${Math.floor(i / 10) + 1}: ${batch.join(', ')}`);

        try {
          const products = await keepaClient.fetchProducts(batch);

          for (const product of products) {
            const pricing = keepaClient.extractCurrentPricing(product);
            const price = pricing.buyBoxPrice ?? pricing.lowestNewPrice;
            const item = stillMissing.find(m => m.amazon_asin === product.asin);

            if (item) {
              results.push({
                id: item.id,
                set_number: item.set_number,
                asin: item.amazon_asin!,
                price: price,
                source: price ? 'keepa_api' : 'keepa_api_no_price',
              });
            }
          }

          // Mark any ASINs not returned by Keepa
          for (const asin of batch) {
            if (!results.some(r => r.asin === asin)) {
              const item = stillMissing.find(m => m.amazon_asin === asin);
              if (item) {
                results.push({
                  id: item.id,
                  set_number: item.set_number,
                  asin,
                  price: null,
                  source: 'keepa_api_not_found',
                });
              }
            }
          }
        } catch (err) {
          console.warn(`[Backfill Prices] Keepa API batch failed:`, err);
          for (const asin of batch) {
            const item = stillMissing.find(m => m.amazon_asin === asin);
            if (item && !results.some(r => r.id === item.id)) {
              results.push({
                id: item.id,
                set_number: item.set_number,
                asin,
                price: null,
                source: 'keepa_api_error',
              });
            }
          }
        }
      }
    } else {
      console.warn('[Backfill Prices] Keepa API key not configured');
      for (const item of stillMissing) {
        results.push({
          id: item.id,
          set_number: item.set_number,
          asin: item.amazon_asin!,
          price: null,
          source: 'no_keepa_key',
        });
      }
    }
  }

  // 4. Update inventory items with resolved prices
  let updatedCount = 0;
  if (!dryRun) {
    const toUpdate = results.filter(r => r.price !== null && r.price > 0);

    for (const item of toUpdate) {
      const { error: updateError } = await supabase
        .from('inventory_items')
        .update({ listing_value: item.price })
        .eq('id', item.id);

      if (updateError) {
        console.warn(`[Backfill Prices] Failed to update ${item.set_number}: ${updateError.message}`);
      } else {
        updatedCount++;
        console.log(`[Backfill Prices] Updated ${item.set_number}: £${item.price!.toFixed(2)} (${item.source})`);
      }
    }
  }

  return NextResponse.json({
    success: true,
    dryRun,
    processed: items.length,
    updated: updatedCount,
    results: results.map(r => ({
      set_number: r.set_number,
      asin: r.asin,
      price: r.price,
      source: r.source,
    })),
  });
}
