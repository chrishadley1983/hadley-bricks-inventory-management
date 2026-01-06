/**
 * Script to clean up duplicate inventory records in Supabase
 *
 * Identifies duplicates by SKU and keeps only the most recently created record.
 *
 * Usage:
 *   npx tsx apps/web/scripts/cleanup-duplicates.ts --dry-run   # Preview what would be deleted
 *   npx tsx apps/web/scripts/cleanup-duplicates.ts             # Actually delete duplicates
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables from .env.local
config({ path: resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing environment variables:');
  console.error('  NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? 'set' : 'MISSING');
  console.error('  SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceKey ? 'set' : 'MISSING');
  process.exit(1);
}

const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey);

interface InventoryRecord {
  id: string;
  sku: string | null;
  set_number: string;
  item_name: string | null;
  created_at: string;
  user_id: string;
}

async function fetchAllRecords(): Promise<InventoryRecord[]> {
  const allRecords: InventoryRecord[] = [];
  const pageSize = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('id, sku, set_number, item_name, created_at, user_id')
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw new Error(`Failed to fetch inventory: ${error.message}`);
    }

    allRecords.push(...data);
    console.log(`  Fetched ${allRecords.length} records...`);

    if (data.length < pageSize) {
      hasMore = false;
    } else {
      offset += pageSize;
    }
  }

  return allRecords;
}

async function findDuplicates(): Promise<Map<string, InventoryRecord[]>> {
  console.log('Fetching all inventory records...');

  const data = await fetchAllRecords();

  console.log(`Found ${data.length} total records`);

  // Group by SKU (or set_number if SKU is null)
  const grouped = new Map<string, InventoryRecord[]>();

  for (const record of data) {
    // Use SKU as primary key, fall back to set_number + user_id
    const key = record.sku || `${record.set_number}:${record.user_id}`;

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(record);
  }

  // Filter to only groups with duplicates
  const duplicates = new Map<string, InventoryRecord[]>();
  for (const [key, records] of grouped) {
    if (records.length > 1) {
      duplicates.set(key, records);
    }
  }

  return duplicates;
}

async function cleanupDuplicates(dryRun: boolean): Promise<void> {
  const duplicates = await findDuplicates();

  if (duplicates.size === 0) {
    console.log('\n✅ No duplicates found!');
    return;
  }

  console.log(`\n⚠️  Found ${duplicates.size} groups with duplicates:\n`);

  const idsToDelete: string[] = [];

  for (const [key, records] of duplicates) {
    // Keep the first one (most recent due to ordering)
    const [keep, ...remove] = records;

    console.log(`  SKU/Key: ${key}`);
    console.log(`    Keep:   ${keep.id} (${keep.item_name || keep.set_number}) - created ${keep.created_at}`);
    for (const r of remove) {
      console.log(`    Delete: ${r.id} (${r.item_name || r.set_number}) - created ${r.created_at}`);
      idsToDelete.push(r.id);
    }
    console.log('');
  }

  console.log(`\nTotal records to delete: ${idsToDelete.length}`);

  if (dryRun) {
    console.log('\n🔍 DRY RUN - No records were deleted.');
    console.log('Run without --dry-run to actually delete duplicates.');
    return;
  }

  // Actually delete
  console.log('\n🗑️  Deleting duplicates...');

  // Delete in batches of 100
  const batchSize = 100;
  let deleted = 0;

  for (let i = 0; i < idsToDelete.length; i += batchSize) {
    const batch = idsToDelete.slice(i, i + batchSize);

    const { error } = await supabase
      .from('inventory_items')
      .delete()
      .in('id', batch);

    if (error) {
      console.error(`Error deleting batch ${i}-${i + batch.length}:`, error.message);
    } else {
      deleted += batch.length;
      console.log(`  Deleted ${deleted}/${idsToDelete.length} records`);
    }
  }

  console.log(`\n✅ Cleanup complete! Deleted ${deleted} duplicate records.`);
}

// Main
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

console.log('='.repeat(60));
console.log('Inventory Duplicate Cleanup Script');
console.log('='.repeat(60));
console.log(`Mode: ${dryRun ? 'DRY RUN (preview only)' : 'LIVE (will delete records)'}`);
console.log('');

cleanupDuplicates(dryRun)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
