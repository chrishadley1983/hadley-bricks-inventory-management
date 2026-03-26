/**
 * E2E test for Inventory Explorer — sync, overview, items APIs.
 *
 * Usage: cd apps/web && npx tsx scripts/test-inventory-explorer.ts
 */
import dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import { SnapshotSyncService } from '../src/lib/inventory-explorer/snapshot-sync.service';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Get user ID (first user with bricqer credentials)
  const { data: cred } = await supabase
    .from('platform_credentials')
    .select('user_id')
    .eq('platform', 'bricqer')
    .limit(1)
    .single();

  if (!cred) {
    console.error('No Bricqer credentials found');
    process.exit(1);
  }

  const userId = cred.user_id;
  console.log(`Using user: ${userId}\n`);

  // ============================================
  // TEST 1: Sync
  // ============================================
  console.log('=== TEST 1: Snapshot Sync ===');
  const service = new SnapshotSyncService(supabase, userId);

  const startTime = Date.now();
  const result = await service.sync({
    onProgress: (p) => {
      if (p.page % 50 === 0 || p.status !== 'running') {
        console.log(`  Page ${p.page}/${p.totalPages} — ${p.itemsFetched}/${p.totalItems} items (${p.status})`);
      }
    },
  });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n  Result: ${JSON.stringify(result, null, 2)}`);
  console.log(`  Time: ${elapsed}s`);

  if (result.error) {
    console.error(`\n  FAIL: Sync errored — ${result.error}`);
    process.exit(1);
  }
  if (!result.complete) {
    console.error('\n  FAIL: Sync did not complete (needs resume)');
    process.exit(1);
  }
  if (result.itemsSynced === 0) {
    console.error('\n  FAIL: Zero items synced');
    process.exit(1);
  }
  console.log(`  PASS: Synced ${result.itemsSynced} items, removed ${result.itemsRemoved} stale\n`);

  // ============================================
  // TEST 2: Snapshot Meta
  // ============================================
  console.log('=== TEST 2: Snapshot Meta ===');
  const { data: meta } = await supabase
    .from('bricqer_snapshot_meta')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!meta) {
    console.error('  FAIL: No meta row found');
    process.exit(1);
  }
  console.log(`  Status: ${meta.sync_status}`);
  console.log(`  Total items: ${meta.total_items}`);
  console.log(`  Total lots: ${meta.total_lots}`);
  console.log(`  Last sync: ${meta.last_full_sync}`);

  if (meta.sync_status !== 'idle') {
    console.error(`  FAIL: Expected status "idle", got "${meta.sync_status}"`);
    process.exit(1);
  }
  console.log('  PASS\n');

  // ============================================
  // TEST 3: Snapshot data integrity
  // ============================================
  console.log('=== TEST 3: Data Integrity ===');

  // Count by type
  const types = ['Part', 'Set', 'Minifig'];
  for (const type of types) {
    const { count } = await supabase
      .from('bricqer_inventory_snapshot')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('item_type', type);
    console.log(`  ${type}: ${count} lots`);
  }

  // Verify no null item_numbers
  const { count: nullCount } = await supabase
    .from('bricqer_inventory_snapshot')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('item_number', null);
  console.log(`  Null item_numbers: ${nullCount}`);
  if (nullCount && nullCount > 0) {
    console.error('  FAIL: Found rows with null item_number');
    process.exit(1);
  }

  // Sample a few rows to check data quality
  const { data: sample } = await supabase
    .from('bricqer_inventory_snapshot')
    .select('*')
    .eq('user_id', userId)
    .limit(3);

  console.log('\n  Sample rows:');
  for (const row of sample || []) {
    console.log(`    ${row.item_number} | ${row.item_name} | ${row.item_type} | ${row.condition} | qty:${row.quantity} | £${row.bricqer_price}`);
  }
  console.log('  PASS\n');

  // ============================================
  // TEST 4: Overview aggregation (simulate API)
  // ============================================
  console.log('=== TEST 4: Overview Aggregation ===');

  let totalItems = 0;
  let totalValue = 0;
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data: batch } = await supabase
      .from('bricqer_inventory_snapshot')
      .select('quantity, bricqer_price, item_type, condition')
      .eq('user_id', userId)
      .range(offset, offset + pageSize - 1);

    if (!batch || batch.length === 0) break;
    for (const row of batch) {
      totalItems += row.quantity;
      totalValue += row.bricqer_price * row.quantity;
    }
    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  console.log(`  Total items (sum qty): ${totalItems.toLocaleString()}`);
  console.log(`  Total value: £${totalValue.toFixed(2)}`);

  if (totalItems === 0) {
    console.error('  FAIL: Zero total items');
    process.exit(1);
  }
  console.log('  PASS\n');

  // ============================================
  // TEST 5: Items query (simulate API)
  // ============================================
  console.log('=== TEST 5: Items Query ===');

  const { data: partsPage, count: partsCount } = await supabase
    .from('bricqer_inventory_snapshot')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .eq('item_type', 'Part')
    .order('bricqer_price', { ascending: false })
    .range(0, 49);

  console.log(`  Parts: ${partsCount} lots, first page has ${partsPage?.length} rows`);
  if (partsPage && partsPage.length > 0) {
    const top = partsPage[0];
    console.log(`  Most expensive part: ${top.item_name} (${top.item_number}) — £${top.bricqer_price}`);
  }

  const { count: setsCount } = await supabase
    .from('bricqer_inventory_snapshot')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('item_type', 'Set');

  const { count: minifigCount } = await supabase
    .from('bricqer_inventory_snapshot')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('item_type', 'Minifig');

  console.log(`  Sets: ${setsCount} lots`);
  console.log(`  Minifigs: ${minifigCount} lots`);
  console.log('  PASS\n');

  // ============================================
  // SUMMARY
  // ============================================
  console.log('=============================');
  console.log('ALL TESTS PASSED');
  console.log(`  Synced: ${result.itemsSynced} items in ${elapsed}s`);
  console.log(`  Parts: ${partsCount}, Sets: ${setsCount}, Minifigs: ${minifigCount}`);
  console.log(`  Total value: £${totalValue.toFixed(2)}`);
  console.log('=============================');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
