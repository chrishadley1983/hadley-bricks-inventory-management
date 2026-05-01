/**
 * One-time backfill: copy every brickowl_transactions row into platform_orders
 * with platform='brickowl'. Idempotent — re-running is safe (upsert on
 * (user_id, platform, platform_order_id)).
 *
 * Field mapping mirrors BrickOwlTransactionSyncService.transformOrderToPlatformOrder
 * — the same shape that the live cron will write going forward.
 *
 * Usage: npx tsx scripts/backfill-bo-platform-orders.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import type { Database, PlatformOrderInsert } from '@hadley-bricks/database';

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BATCH_SIZE = 100;

interface BoRow {
  user_id: string;
  brickowl_order_id: string;
  order_date: string;
  status_changed_date: string | null;
  buyer_name: string;
  buyer_email: string | null;
  base_currency: string;
  order_total: number;
  shipping: number | null;
  tax: number | null;
  base_grand_total: number;
  total_items: number | null;
  order_status: string;
  tracking_number: string | null;
  raw_response: unknown;
}

function toPlatformOrder(row: BoRow): PlatformOrderInsert {
  return {
    user_id: row.user_id,
    platform: 'brickowl',
    platform_order_id: row.brickowl_order_id,
    order_date: row.order_date,
    buyer_name: row.buyer_name,
    buyer_email: row.buyer_email,
    status: row.order_status,
    subtotal: row.order_total,
    shipping: row.shipping,
    fees: row.tax,
    total: row.base_grand_total,
    currency: row.base_currency || 'GBP',
    tracking_number: row.tracking_number,
    items_count: row.total_items,
    raw_data: row.raw_response as Database['public']['Tables']['platform_orders']['Insert']['raw_data'],
    platform_status_changed_at: row.status_changed_date,
  };
}

async function main() {
  console.log('Reading all brickowl_transactions rows…');

  // Paginate to avoid the 1000-row Supabase cap
  const all: BoRow[] = [];
  let from = 0;
  const pageSize = 1000;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from('brickowl_transactions')
      .select(
        'user_id, brickowl_order_id, order_date, status_changed_date, buyer_name, buyer_email, base_currency, order_total, shipping, tax, base_grand_total, total_items, order_status, tracking_number, raw_response'
      )
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Read failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as BoRow[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }

  console.log(`Read ${all.length} rows from brickowl_transactions`);

  if (all.length === 0) {
    console.log('Nothing to backfill.');
    return;
  }

  // Pre-count what's already in platform_orders for verification
  const userIds = [...new Set(all.map((r) => r.user_id))];
  for (const uid of userIds) {
    const { count } = await supabase
      .from('platform_orders')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', uid)
      .eq('platform', 'brickowl');
    console.log(`  user ${uid.slice(0, 8)}…: ${count} existing platform='brickowl' rows`);
  }

  // Transform + upsert in batches
  const platformRows = all.map(toPlatformOrder);
  let upserted = 0;
  for (let i = 0; i < platformRows.length; i += BATCH_SIZE) {
    const batch = platformRows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('platform_orders').upsert(batch, {
      onConflict: 'user_id,platform,platform_order_id',
      ignoreDuplicates: false,
    });
    if (error) throw new Error(`Upsert failed: ${error.message}`);
    upserted += batch.length;
    console.log(`  upserted ${upserted}/${platformRows.length}`);
  }

  // Verify counts
  console.log('\n=== Verification ===');
  for (const uid of userIds) {
    const { count: boCount } = await supabase
      .from('brickowl_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', uid);
    const { count: poCount } = await supabase
      .from('platform_orders')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', uid)
      .eq('platform', 'brickowl');
    const ok = boCount === poCount;
    console.log(
      `  user ${uid.slice(0, 8)}…: brickowl_transactions=${boCount}  platform_orders(brickowl)=${poCount}  ${ok ? 'OK' : 'MISMATCH'}`
    );
  }

  console.log('\nBackfill complete.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
