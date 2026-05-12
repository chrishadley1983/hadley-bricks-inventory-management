// Backfill BrickLink platform_orders rows that were synced via the cron path
// (summary-only) and therefore have shipping=£0 and stale status. Fetches the
// detail endpoint for every BL order with order_date >= 2026-04-15 and rewrites
// shipping/fees/status from the full cost breakdown.
//
// Usage:  cd apps/web; npx tsx scripts/backfill-bl-orders-since-reopen.ts
//
// Read-only on Bricqer; writes only to platform_orders rows for the calling user.

import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import { BrickLinkClient } from '../src/lib/bricklink/client';
import { normalizeOrder } from '../src/lib/bricklink/adapter';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SINCE = '2026-04-15';

const blCreds = {
  consumerKey: process.env.BRICKLINK_CONSUMER_KEY ?? '',
  consumerSecret: process.env.BRICKLINK_CONSUMER_SECRET ?? '',
  tokenValue: process.env.BRICKLINK_TOKEN_VALUE ?? '',
  tokenSecret: process.env.BRICKLINK_TOKEN_SECRET ?? '',
};
for (const [k, v] of Object.entries(blCreds)) {
  if (!v) {
    console.error(`Missing BRICKLINK_${k.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase()}`);
    process.exit(1);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const bl = new BrickLinkClient(blCreds, { supabase, caller: 'backfill-bl-orders-since-reopen-script' });

  console.log(`Loading BL orders from platform_orders since ${SINCE}…`);
  const { data: rows, error } = await supabase
    .from('platform_orders')
    .select('id, user_id, platform_order_id, status, shipping, fees, total, subtotal, order_date')
    .eq('platform', 'bricklink')
    .gte('order_date', SINCE)
    .order('order_date', { ascending: true });

  if (error) {
    console.error('Supabase load failed:', error);
    process.exit(1);
  }
  if (!rows || rows.length === 0) {
    console.log('No BL orders to backfill.');
    return;
  }

  console.log(`Found ${rows.length} BL orders. Fetching detail per order…`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const skippedSamples: Array<{ id: string; reason: string }> = [];

  for (const row of rows) {
    const orderId = row.platform_order_id;
    try {
      const { order, items } = await bl.getOrderWithItems(Number(orderId));
      const normalized = normalizeOrder(order, items);

      const update = {
        status: normalized.status,
        platform_status_changed_at: normalized.statusChangedAt?.toISOString() ?? null,
        subtotal: normalized.subtotal,
        shipping: normalized.shipping,
        fees: normalized.fees,
        total: normalized.total,
        currency: normalized.currency,
        tracking_number: normalized.trackingNumber ?? null,
        items_count: normalized.items.length,
        raw_data: normalized.rawData as unknown as object,
      };

      const { error: upErr } = await supabase
        .from('platform_orders')
        .update(update)
        .eq('id', row.id);

      if (upErr) {
        failed++;
        console.error(`  ${orderId} update failed:`, upErr.message);
      } else {
        updated++;
        const before = `ship=£${Number(row.shipping).toFixed(2)} status=${row.status}`;
        const after = `ship=£${normalized.shipping.toFixed(2)} status=${normalized.status}`;
        console.log(`  ✓ ${orderId}  ${before}  →  ${after}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Order may have been filed/archived and thrown a NOT_FOUND - track but keep going
      skipped++;
      skippedSamples.push({ id: orderId, reason: msg });
      console.warn(`  ⚠ ${orderId} skipped: ${msg.slice(0, 100)}`);
    }
    // Be polite: BL public limit is ~5/sec.
    await sleep(250);
  }

  console.log('\n=== Backfill summary ===');
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed:  ${failed}`);

  if (skippedSamples.length) {
    console.log('\nSkipped reasons (first 10):');
    for (const s of skippedSamples.slice(0, 10)) {
      console.log(`  ${s.id}: ${s.reason.slice(0, 120)}`);
    }
  }
})();
