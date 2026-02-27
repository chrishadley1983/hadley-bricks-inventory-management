/**
 * Backfill inventory_items records for PUBLISHED / SOLD minifig sync items.
 *
 * Previously, minifig sync only created records in minifig_sync_items when
 * publishing to eBay. This meant eBay inventory resolution, P&L, and reporting
 * could not find minifig sales. This script creates the missing inventory_items
 * records so everything matches up.
 *
 * Usage: cd apps/web && npx tsx scripts/backfill-minifig-inventory.ts [--dry-run]
 */
import dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const dryRun = process.argv.includes('--dry-run');

const SOLD_STATUSES = ['SOLD_EBAY', 'SOLD_EBAY_PENDING_REMOVAL'];
const TARGET_STATUSES = ['PUBLISHED', ...SOLD_STATUSES];

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  console.log(dryRun ? '*** DRY RUN ***\n' : '');

  // 1. Fetch all PUBLISHED / SOLD minifig sync items (paginated)
  console.log('Fetching minifig sync items with status:', TARGET_STATUSES.join(', '));

  const pageSize = 1000;
  let page = 0;
  let hasMore = true;
  const syncItems: Record<string, unknown>[] = [];

  while (hasMore) {
    const { data, error } = await supabase
      .from('minifig_sync_items')
      .select('*')
      .in('listing_status', TARGET_STATUSES)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      console.error('Failed to fetch minifig_sync_items:', error.message);
      process.exit(1);
    }

    syncItems.push(...(data ?? []));
    hasMore = (data?.length ?? 0) === pageSize;
    page++;
  }

  console.log(`Found ${syncItems.length} minifig sync items to backfill\n`);

  if (syncItems.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  // 2. Check which already have inventory_items records (by SKU)
  const skus = syncItems
    .map((item) => item.ebay_sku as string)
    .filter(Boolean);

  const existingSkus = new Set<string>();
  // Paginate the lookup too
  for (let i = 0; i < skus.length; i += pageSize) {
    const batch = skus.slice(i, i + pageSize);
    const { data: existing } = await supabase
      .from('inventory_items')
      .select('sku')
      .in('sku', batch);

    for (const row of existing ?? []) {
      if (row.sku) existingSkus.add(row.sku);
    }
  }

  console.log(`${existingSkus.size} already have inventory_items records (will skip)\n`);

  // 3. Insert missing inventory_items
  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const item of syncItems) {
    const sku = item.ebay_sku as string | null;
    if (!sku) {
      console.log(`  SKIP (no SKU): ${item.name}`);
      skipped++;
      continue;
    }

    if (existingSkus.has(sku)) {
      console.log(`  SKIP (exists): ${sku} - ${item.name}`);
      skipped++;
      continue;
    }

    const isSold = SOLD_STATUSES.includes(item.listing_status as string);

    const record = {
      set_number: (item.bricklink_id as string) || (item.name as string) || 'UNKNOWN',
      item_name: item.name as string | null,
      condition: 'Used',
      status: isSold ? 'SOLD' : 'LISTED',
      source: 'Minifig Sync',
      cost: item.bricqer_price ? Number(item.bricqer_price) : null,
      listing_date: (item.updated_at as string) || new Date().toISOString(),
      listing_value: item.recommended_price ? Number(item.recommended_price) : null,
      listing_platform: 'ebay',
      sku,
      storage_location: item.storage_location as string | null,
      ebay_listing_id: item.ebay_listing_id as string | null,
      ebay_listing_url: item.ebay_listing_url as string | null,
      user_id: item.user_id as string,
    };

    if (dryRun) {
      console.log(`  WOULD INSERT: ${sku} | ${record.set_number} | ${record.item_name} | status=${record.status}`);
    } else {
      const { error: insertError } = await supabase
        .from('inventory_items')
        .insert(record);

      if (insertError) {
        console.error(`  ERROR: ${sku} - ${insertError.message}`);
        errors++;
        continue;
      }

      console.log(`  CREATED: ${sku} | ${record.set_number} | status=${record.status}`);
    }

    created++;
  }

  console.log('\n--- Summary ---');
  console.log(`Total sync items:   ${syncItems.length}`);
  console.log(`Created:            ${created}${dryRun ? ' (dry run)' : ''}`);
  console.log(`Skipped:            ${skipped}`);
  if (errors > 0) console.log(`Errors:             ${errors}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
