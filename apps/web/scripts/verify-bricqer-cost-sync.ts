/**
 * Live verification for fix/bricqer-purchase-cost.
 *
 * 1. Simulates the sync logic end-to-end against the real Bricqer API:
 *    fetches batches + purchase details, runs the same transform used by
 *    the service, and prints what WOULD be written to bricklink_uploads.
 * 2. Then reads the existing bricklink_uploads rows so you can compare
 *    before/after once the actual sync runs.
 *
 * This doesn't touch the DB — it's read-only and safe to run.
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import { BricqerClient } from '../src/lib/bricqer/client';
import { CredentialsRepository } from '../src/lib/repositories/credentials.repository';
import {
  calculatePurchaseCost,
  parseCurrencyValue,
} from '../src/lib/bricqer/bricqer-batch-sync.types';
import type { Database } from '@hadley-bricks/database';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey);

async function main() {
  const { data: orders } = await supabase
    .from('platform_orders')
    .select('user_id')
    .eq('platform', 'bricqer')
    .limit(1);

  const userId = orders?.[0]?.user_id;
  if (!userId) return console.log('No Bricqer user found');

  const credRepo = new CredentialsRepository(supabase);
  const credentials = await credRepo.getCredentials(userId, 'bricqer');
  if (!credentials) return console.log('No credentials');

  const client = new BricqerClient(credentials);

  const batches = await client.getBatches();
  const activated = batches.filter((b) => b.activated);
  const uniquePurchaseIds = [
    ...new Set(activated.map((b) => b.purchase).filter((id) => id != null)),
  ];

  console.log(`Activated batches: ${activated.length}`);
  console.log(`Unique purchases to fetch: ${uniquePurchaseIds.length}\n`);

  // Fetch detail for each purchase
  const detailMap = new Map<number, Awaited<ReturnType<typeof client.getPurchaseDetail>>>();
  for (const id of uniquePurchaseIds) {
    try {
      const d = await client.getPurchaseDetail(id);
      detailMap.set(id, d);
    } catch (err) {
      console.warn(`Failed to fetch purchase ${id}:`, err instanceof Error ? err.message : err);
    }
  }

  // Dry-run the transform + print a summary table
  console.log('=== Proposed bricklink_uploads rows (dry-run) ===\n');
  console.log(
    'batch_id'.padEnd(10),
    'purchase'.padEnd(10),
    'value'.padStart(9),
    'cost'.padStart(9),
    'margin%'.padStart(8),
    'source'.padEnd(18),
    'notes'
  );
  console.log('-'.repeat(100));

  for (const batch of activated) {
    const purchase = detailMap.get(batch.purchase);
    let cost = 0;
    let source: string | null = null;
    let notes: string | null = null;

    if (purchase) {
      const totalCost = calculatePurchaseCost(purchase.journal.posts);
      const purchaseValue = parseCurrencyValue(purchase.sellingPrice);
      const batchValue = parseCurrencyValue(batch.totalPrice);
      if (totalCost > 0) {
        if (purchaseValue > 0 && batchValue > 0) {
          cost = Math.round(totalCost * (batchValue / purchaseValue) * 100) / 100;
        } else {
          cost = totalCost;
        }
      }
      source = purchase.journal.contact?.name ?? null;
      notes = purchase.journal.reference ?? null;
    }

    const value = parseCurrencyValue(batch.totalPrice);
    const marginPct = cost > 0 && value > 0 ? (((value - cost) / value) * 100).toFixed(1) : '-';

    console.log(
      String(batch.id).padEnd(10),
      String(batch.purchase ?? '').padEnd(10),
      value.toFixed(2).padStart(9),
      cost.toFixed(2).padStart(9),
      marginPct.padStart(8),
      (source ?? '').slice(0, 17).padEnd(18),
      (notes ?? '').slice(0, 40)
    );
  }

  // Show current DB state for comparison
  console.log('\n=== Current DB state (bricklink_uploads) ===\n');
  const { data: current } = await supabase
    .from('bricklink_uploads')
    .select('bricqer_batch_id, bricqer_purchase_id, selling_price, cost, source, notes')
    .eq('user_id', userId)
    .order('bricqer_batch_id', { ascending: false })
    .limit(10);
  console.log(current);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
