// One-shot enrichment for inventory_items that were created by the
// backfill-missing-ebay-orders script before it learned to call the
// lookup-asin/brickset/competitive-summary endpoints. Looks for rows with
// notes that start with "Backfilled. " (the marker the backfill writes) and
// no amazon_asin yet, then runs the same enrichment chain the cron uses.
//
// Usage:
//   npx tsx scripts/enrich-backfilled-items.ts              # dry run
//   npx tsx scripts/enrich-backfilled-items.ts --apply
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import { KeepaClient } from '../src/lib/keepa/keepa-client';

const APPLY = process.argv.includes('--apply');
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  'https://hadley-bricks-inventory-management.vercel.app';
const SERVICE_API_KEY = process.env.SERVICE_API_KEY!;

if (!SERVICE_API_KEY) {
  console.error('SERVICE_API_KEY missing from .env.local');
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

async function fetchService(p: string): Promise<Response> {
  return fetch(`${APP_URL}${p}`, {
    headers: { 'x-api-key': SERVICE_API_KEY },
  });
}

interface Enrichment {
  asin?: string;
  set_name?: string;
  list_price?: number;
}

async function enrich(setNumber: string): Promise<Enrichment> {
  const out: Enrichment = {};

  const asinRes = await fetchService(
    `/api/service/inventory/lookup-asin?setNumber=${encodeURIComponent(setNumber)}`
  );
  if (asinRes.ok) {
    const j = await asinRes.json();
    out.asin = j.data?.asin;
    if (j.data?.title) out.set_name = j.data.title;
  }

  try {
    const bsRes = await fetchService(
      `/api/service/brickset/lookup?setNumber=${encodeURIComponent(setNumber)}`
    );
    if (bsRes.ok) {
      const j = await bsRes.json();
      // Brickset lookup returns `setName` (NOT `name`). The cron's email-import
      // path mistakenly reads `data.name` and silently falls back to the ASIN
      // title — fix the cron to mirror this once we ship it.
      const bsName = j.data?.setName ?? j.data?.name;
      if (bsName) out.set_name = bsName;
    }
  } catch {
    // optional
  }

  if (out.asin) {
    const pRes = await fetchService(
      `/api/service/amazon/competitive-summary?asins=${encodeURIComponent(out.asin)}`
    );
    if (pRes.ok) {
      const j = await pRes.json();
      const ap = j.data?.[out.asin];
      out.list_price = ap?.buyBoxPrice ?? ap?.lowestNewPrice;
    }
  }

  // Keepa price_snapshots fallback
  if (!out.list_price && out.asin) {
    const { data } = await supabase
      .from('price_snapshots')
      .select('price_gbp, date')
      .eq('set_num', `${setNumber}-1`)
      .eq('source', 'keepa_amazon_buybox')
      .order('date', { ascending: false })
      .limit(1);
    if (data && data[0]?.price_gbp) out.list_price = Number(data[0].price_gbp);
  }

  // Keepa API fallback
  if (!out.list_price && out.asin) {
    try {
      const keepa = new KeepaClient();
      if (keepa.isConfigured()) {
        const products = await keepa.fetchProducts([out.asin]);
        for (const product of products) {
          const pricing = keepa.extractCurrentPricing(product);
          const price = pricing.buyBoxPrice ?? pricing.lowestNewPrice;
          if (price) out.list_price = price;
        }
      }
    } catch (err) {
      console.warn(`  ! Keepa API failed for ${out.asin}:`, err);
    }
  }

  return out;
}

(async () => {
  console.log(`Mode: ${APPLY ? 'APPLY (writes)' : 'dry-run'}\n`);

  // Include rows where ASIN is missing OR the item_name still looks like a
  // truncated email subject (short, ends with a partial word). The inventory
  // enrich cron may already have filled in the ASIN/list_price but the cron's
  // Brickset `data.name` bug means item_name is often left as the subject.
  const { data: rows } = await supabase
    .from('inventory_items')
    .select('id, set_number, item_name, cost, amazon_asin, listing_value, notes, purchase_id')
    .ilike('notes', 'Backfilled.%');

  if (!rows || rows.length === 0) {
    console.log('No rows to enrich.');
    return;
  }
  console.log(`Found ${rows.length} backfilled rows missing ASIN.\n`);

  for (const row of rows) {
    if (!row.set_number) continue;
    const e = await enrich(row.set_number);
    console.log(
      `  set=${row.set_number} | asin=${e.asin ?? '-'} | listing=£${e.list_price ?? '-'} | name=${(e.set_name ?? '').slice(0, 60)}`
    );

    if (!APPLY) continue;

    const update: Record<string, unknown> = {};
    if (e.asin) update.amazon_asin = e.asin;
    if (e.set_name) update.item_name = e.set_name;
    if (e.list_price) update.listing_value = e.list_price;
    if (Object.keys(update).length === 0) continue;

    const { error } = await supabase
      .from('inventory_items')
      .update(update)
      .eq('id', row.id);
    if (error) console.warn(`  ! update failed for ${row.id}:`, error);

    // Mirror onto purchase short_description so the purchase reflects the real
    // set name too (matches the happy-path import which seeds it at create).
    if (e.set_name && row.purchase_id) {
      await supabase
        .from('purchases')
        .update({ short_description: `${row.set_number} ${e.set_name}` })
        .eq('id', row.purchase_id);
    }
  }

  if (!APPLY) console.log('\nDry run — pass --apply to write.');
})();
