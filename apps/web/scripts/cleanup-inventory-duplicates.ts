/**
 * Cleanup Inventory Duplicates
 *
 * This script removes duplicate inventory items that have the same SKU,
 * keeping only the most recent record (by created_at).
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function cleanupDuplicates() {
  console.log('Finding duplicate inventory items...');

  // Fetch all inventory items (may need pagination for large datasets)
  let allItems: { id: string; sku: string; set_number: string; item_name: string; created_at: string }[] = [];
  let page = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('id, sku, set_number, item_name, created_at')
      .order('created_at', { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      console.error('Failed to fetch inventory:', error);
      process.exit(1);
    }

    if (!data || data.length === 0) break;
    allItems = allItems.concat(data);
    page++;

    if (data.length < pageSize) break;
  }

  console.log(`Found ${allItems.length} total inventory items`);

  // Group by SKU
  const skuGroups = new Map<string, typeof allItems>();
  for (const item of allItems) {
    const sku = item.sku || `NO_SKU_${item.id}`;
    if (!skuGroups.has(sku)) {
      skuGroups.set(sku, []);
    }
    skuGroups.get(sku)!.push(item);
  }

  // Find duplicates (groups with more than 1 item)
  const duplicateGroups = Array.from(skuGroups.entries()).filter(
    ([, items]) => items.length > 1
  );

  console.log(`Found ${duplicateGroups.length} SKUs with duplicates`);

  if (duplicateGroups.length === 0) {
    console.log('No duplicates found. Exiting.');
    return;
  }

  // Collect IDs to delete (keep the first/newest, delete the rest)
  const idsToDelete: string[] = [];
  for (const [, items] of duplicateGroups) {
    // Skip the first (newest) item, delete the rest
    for (let i = 1; i < items.length; i++) {
      idsToDelete.push(items[i].id);
    }
  }

  console.log(`Will delete ${idsToDelete.length} duplicate records`);
  console.log(`Will keep ${allItems.length - idsToDelete.length} unique records`);

  // Confirm deletion
  const args = process.argv.slice(2);
  if (!args.includes('--execute')) {
    console.log('\nThis was a DRY RUN. To actually delete duplicates, run:');
    console.log('  npx tsx scripts/cleanup-inventory-duplicates.ts --execute');
    return;
  }

  // Delete in batches to avoid hitting limits
  console.log('\nDeleting duplicates in batches...');
  const batchSize = 500;
  for (let i = 0; i < idsToDelete.length; i += batchSize) {
    const batch = idsToDelete.slice(i, i + batchSize);
    const { error: deleteError } = await supabase
      .from('inventory_items')
      .delete()
      .in('id', batch);

    if (deleteError) {
      console.error(`Failed to delete batch at index ${i}:`, deleteError);
      process.exit(1);
    }
    console.log(`  Deleted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(idsToDelete.length / batchSize)} (${batch.length} records)`);
  }

  console.log(`\nSuccessfully deleted ${idsToDelete.length} duplicate records`);

  // Verify final count
  const { count } = await supabase
    .from('inventory_items')
    .select('*', { count: 'exact', head: true });
  console.log(`Final inventory count: ${count}`);
}

cleanupDuplicates().catch(console.error);
