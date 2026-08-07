/**
 * Backfill shopify_transactions (revenue + Shopify Payments fees) for
 * historical Shopify orders, and stamp platform_orders.fees.
 *
 * Fetches every order since the store's first sale from the Shopify API, then
 * drives the same ShopifyOrderSyncService.syncTransactionsForOrders path the
 * cron uses (idempotent upserts). Ends with a reconciliation summary to check
 * against the Shopify payout reports before the figures feed MTD.
 *
 * Usage: cd apps/web && npx tsx scripts/backfill-shopify-transactions.ts [--dry-run]
 */
import dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { ShopifyClient } from '../src/lib/shopify/client';
import { ShopifyOrderSyncService } from '../src/lib/shopify/order-sync.service';
import type { ShopifyConfig } from '../src/lib/shopify/types';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Store opened mid-June 2026; first order 2026-06-13.
const BACKFILL_FROM = '2026-06-01T00:00:00Z';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: config, error: cfgErr } = await supabase
    .from('shopify_config')
    .select('*')
    .limit(1)
    .single();
  if (cfgErr || !config) throw new Error(`shopify_config: ${cfgErr?.message ?? 'not found'}`);
  const userId = (config as { user_id: string }).user_id;

  const client = new ShopifyClient(config as unknown as ShopifyConfig);
  // 'any', not 'paid': refunded / partially-refunded orders drop out of a
  // 'paid' fetch and their refund transactions would be missed.
  const orders = await client.getOrders({
    updatedAtMin: BACKFILL_FROM,
    financialStatus: 'any',
    status: 'any',
  });
  const PAID_FAMILY = ['paid', 'partially_refunded', 'refunded', 'partially_paid'];
  const live = orders.filter(
    (o) => !o.cancelled_at && PAID_FAMILY.includes((o.financial_status ?? '').toLowerCase())
  );
  console.log(`Fetched ${orders.length} order(s) since ${BACKFILL_FROM} (${live.length} live)`);

  if (dryRun) {
    for (const o of live) {
      const txns = await client.getOrderTransactions(o.id);
      const summary = txns
        .map((t) => `${t.kind}/${t.gateway}/${t.status} £${t.amount}`)
        .join('; ');
      console.log(`  ${o.name} (${o.id}): ${summary || 'no transactions'}`);
    }
    console.log('\n*** DRY RUN — nothing written ***');
    return;
  }

  const svc = new ShopifyOrderSyncService(supabase, userId);
  const res = await svc.syncTransactionsForOrders(live, { balanceMaxPages: 4 });
  console.log(`\nRecorded ${res.transactionsRecorded} transaction(s)`);
  for (const e of res.errors) console.log(`  ERROR [${e.context}]: ${e.error}`);

  // Reconciliation summary from what actually landed in the table.
  const { data: rows, error } = await supabase
    .from('shopify_transactions')
    .select('order_name, kind, gateway, gross_amount, fee_amount, net_amount, payout_id, payout_status, transaction_date')
    .eq('user_id', userId)
    .order('transaction_date', { ascending: true });
  if (error) throw new Error(error.message);

  console.log('\norder      kind    gateway            gross     fee     net  payout');
  let gross = 0;
  let fees = 0;
  for (const r of rows ?? []) {
    gross += Number(r.gross_amount ?? 0);
    fees += Number(r.fee_amount ?? 0);
    console.log(
      [
        String(r.order_name ?? '?').padEnd(10),
        String(r.kind ?? '?').padEnd(7),
        String(r.gateway ?? '?').padEnd(17),
        Number(r.gross_amount ?? 0).toFixed(2).padStart(8),
        Number(r.fee_amount ?? 0).toFixed(2).padStart(7),
        Number(r.net_amount ?? 0).toFixed(2).padStart(7),
        `${r.payout_id ?? '-'} (${r.payout_status ?? '-'})`,
      ].join(' ')
    );
  }
  console.log(
    `\nTotals: gross £${gross.toFixed(2)}, fees £${fees.toFixed(2)}, net £${(gross - fees).toFixed(2)}`
  );
  console.log('Check the fee total against Shopify Admin → Finances → Payouts before trusting it in MTD.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
