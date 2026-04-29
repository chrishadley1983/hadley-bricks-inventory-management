/**
 * Manually trigger the Bricqer → bricklink_uploads sync.
 *
 * Mirrors BricqerBatchSyncService.syncBatches but works from the CLI by using
 * a service-role Supabase client (the production service uses the request-scoped
 * server client and can't run outside a request).
 *
 * Usage:
 *   cd apps/web
 *   npx tsx scripts/sync-bricqer-batches.ts            # activatedOnly=true (default)
 *   npx tsx scripts/sync-bricqer-batches.ts --all      # activatedOnly=false
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
import type {
  BricqerBatch,
  BricqerPurchaseDetail,
  BricqerCredentials,
} from '../src/lib/bricqer/types';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const activatedOnly = !process.argv.includes('--all');
const BATCH_SIZE = 100;
const PURCHASE_DETAIL_CONCURRENCY = 5;

async function main() {
  console.log(`activatedOnly=${activatedOnly}`);

  const { data: creds } = await supabase
    .from('platform_credentials')
    .select('user_id')
    .eq('platform', 'bricqer')
    .limit(1);

  const userId = creds?.[0]?.user_id;
  if (!userId) {
    console.error('No Bricqer credentials found');
    process.exit(1);
  }
  console.log('User:', userId.substring(0, 8) + '...');

  const credRepo = new CredentialsRepository(supabase as never);
  const credentials = await credRepo.getCredentials<BricqerCredentials>(userId, 'bricqer');
  if (!credentials) {
    console.error('Failed to decrypt Bricqer credentials');
    process.exit(1);
  }

  const startedAt = new Date();
  const { data: syncLog, error: syncLogErr } = await supabase
    .from('bricklink_upload_sync_log')
    .insert({
      user_id: userId,
      sync_mode: 'INCREMENTAL',
      status: 'RUNNING',
      started_at: startedAt.toISOString(),
    })
    .select()
    .single();
  if (syncLogErr || !syncLog) {
    console.error('Failed to create sync log:', syncLogErr);
    process.exit(1);
  }

  try {
    const client = new BricqerClient(credentials);

    console.log('Fetching batches from Bricqer...');
    const batches = await client.getBatches();
    console.log(`Total batches: ${batches.length}`);

    const toProcess = activatedOnly ? batches.filter((b) => b.activated) : batches;
    console.log(`Will process: ${toProcess.length}`);

    // Highlight Batch 54 if present
    const target = toProcess.find((b) => b.id === 54);
    if (target) {
      console.log(`\nFound Batch #54:`);
      console.log(`  purchase=${target.purchase} activated=${target.activated}`);
      console.log(`  activationDate=${target.activationDate} created=${target.created}`);
      console.log(`  totalPrice=${target.totalPrice} totalQty=${target.totalQuantity} lots=${target.lots}\n`);
    } else {
      console.log(`\nBatch #54 NOT in fetched list (may not exist or not activated)\n`);
    }

    const purchaseIds = [...new Set(toProcess.map((b) => b.purchase).filter((id): id is number => id != null))];
    console.log(`Fetching ${purchaseIds.length} purchase details...`);

    const purchaseMap = new Map<number, BricqerPurchaseDetail>();
    for (let i = 0; i < purchaseIds.length; i += PURCHASE_DETAIL_CONCURRENCY) {
      const slice = purchaseIds.slice(i, i + PURCHASE_DETAIL_CONCURRENCY);
      const results = await Promise.allSettled(slice.map((id) => client.getPurchaseDetail(id)));
      results.forEach((r, idx) => {
        const id = slice[idx];
        if (r.status === 'fulfilled') purchaseMap.set(id, r.value);
        else console.warn(`  purchase ${id} failed:`, r.reason instanceof Error ? r.reason.message : r.reason);
      });
    }
    console.log(`Got details for ${purchaseMap.size}/${purchaseIds.length}`);

    const rows = toProcess.map((batch) => transformBatchToRow(userId, batch, purchaseMap));

    const ids = rows.map((r) => r.bricqer_batch_id);
    const { data: existing } = await supabase
      .from('bricklink_uploads')
      .select('bricqer_batch_id')
      .eq('user_id', userId)
      .in('bricqer_batch_id', ids);
    const existingIds = new Set((existing ?? []).map((b) => b.bricqer_batch_id));

    let created = 0,
      updated = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const slice = rows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('bricklink_uploads')
        .upsert(slice, { onConflict: 'user_id,bricqer_batch_id' });
      if (error) throw new Error(`Upsert failed: ${error.message}`);
      for (const r of slice) {
        if (existingIds.has(r.bricqer_batch_id)) updated++;
        else created++;
      }
    }

    const completedAt = new Date();
    await supabase
      .from('bricklink_upload_sync_log')
      .update({
        status: 'COMPLETED',
        completed_at: completedAt.toISOString(),
        batches_processed: toProcess.length,
        batches_created: created,
        batches_updated: updated,
        batches_skipped: 0,
      })
      .eq('id', syncLog.id);

    console.log(`\nDone. created=${created} updated=${updated} processed=${toProcess.length}`);

    // Verify Batch #54 landed
    const { data: row54 } = await supabase
      .from('bricklink_uploads')
      .select('bricqer_batch_id, bricqer_purchase_id, upload_date, total_quantity, selling_price, cost, is_activated')
      .eq('user_id', userId)
      .eq('bricqer_batch_id', 54)
      .single();
    console.log('\nBatch #54 in DB after sync:');
    console.log(row54);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown';
    console.error('SYNC FAILED:', errorMessage);
    await supabase
      .from('bricklink_upload_sync_log')
      .update({
        status: 'FAILED',
        completed_at: new Date().toISOString(),
        error_message: errorMessage,
      })
      .eq('id', syncLog.id);
    process.exit(1);
  }
}

function transformBatchToRow(
  userId: string,
  batch: BricqerBatch,
  purchaseMap: Map<number, BricqerPurchaseDetail>
) {
  const purchase = purchaseMap.get(batch.purchase);
  let cost = 0;
  let source: string | null = null;
  let notes: string | null = null;

  if (purchase) {
    const totalPurchaseCost = calculatePurchaseCost(purchase.journal.posts);
    const purchaseSellingPrice = parseCurrencyValue(purchase.sellingPrice);
    const batchSellingPrice = parseCurrencyValue(batch.totalPrice);
    if (totalPurchaseCost > 0) {
      if (purchaseSellingPrice > 0 && batchSellingPrice > 0) {
        cost = Math.round(totalPurchaseCost * (batchSellingPrice / purchaseSellingPrice) * 100) / 100;
      } else {
        cost = totalPurchaseCost;
      }
    }
    source = purchase.journal.contact?.name ?? null;
    notes = purchase.journal.reference ?? null;
  }

  const uploadDate = batch.activationDate || batch.created;

  return {
    user_id: userId,
    bricqer_batch_id: batch.id,
    bricqer_purchase_id: batch.purchase,
    upload_date: uploadDate.split('T')[0],
    total_quantity: batch.totalQuantity,
    selling_price: parseCurrencyValue(batch.totalPrice),
    cost,
    source,
    notes,
    lots: batch.lots,
    condition: batch.condition,
    reference: batch.reference ?? null,
    is_activated: batch.activated,
    remaining_quantity: batch.remainingQuantity,
    remaining_price: parseCurrencyValue(batch.remainingPrice),
    raw_response: batch as unknown as Record<string, unknown>,
    synced_from_bricqer: true,
  };
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
