/**
 * Run a batch Shopify sync with deduplication.
 *
 * Items with the same (set_number, condition, listing_value) are grouped
 * into a single Shopify product with quantity = group size.
 *
 * Usage: cd apps/web && npx tsx scripts/batch-sync.ts [limit]
 *
 * Default limit: 50
 */
import dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import { ShopifySyncService } from '../src/lib/shopify/sync.service';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const limit = parseInt(process.argv[2] || '50', 10);

interface ListedItem {
  id: string;
  set_number: string | null;
  item_name: string | null;
  condition: string | null;
  listing_value: number | null;
}

/** Build a dedup key from set_number + condition + listing_value */
function groupKey(item: ListedItem): string {
  const set = item.set_number ?? 'UNKNOWN';
  const cond = (item.condition ?? 'N').toUpperCase();
  const price = item.listing_value ?? 0;
  return `${set}|${cond}|${price}`;
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: config } = await supabase
    .from('shopify_config')
    .select('user_id, shop_domain')
    .limit(1)
    .single();

  if (!config) {
    console.error('No shopify_config found');
    process.exit(1);
  }

  console.log(`Shop: ${config.shop_domain}`);
  console.log(`Batch limit: ${limit}\n`);

  // Get already-synced item IDs
  const { data: existingMappings } = await supabase
    .from('shopify_products')
    .select('inventory_item_id')
    .eq('user_id', config.user_id);

  const existingIds = new Set(existingMappings?.map((m) => m.inventory_item_id) || []);

  // Fetch all LISTED items (paginate to handle >1000)
  const pageSize = 1000;
  let page = 0;
  let hasMore = true;
  const allListedItems: ListedItem[] = [];

  while (hasMore) {
    const { data } = await supabase
      .from('inventory_items')
      .select('id, set_number, item_name, condition, listing_value')
      .eq('status', 'LISTED')
      .not('set_number', 'is', null)
      .neq('set_number', 'NA')
      .order('created_at', { ascending: true })
      .range(page * pageSize, (page + 1) * pageSize - 1);

    allListedItems.push(...(data ?? []));
    hasMore = (data?.length ?? 0) === pageSize;
    page++;
  }

  // Filter out already-synced items
  const unsyncedItems = allListedItems.filter((item) => !existingIds.has(item.id));

  console.log(`Total LISTED items with set_number: ${allListedItems.length}`);
  console.log(`Already synced: ${existingIds.size}`);
  console.log(`Remaining to sync: ${unsyncedItems.length}`);

  // Group by (set_number, condition, listing_value)
  const groups = new Map<string, ListedItem[]>();
  for (const item of unsyncedItems) {
    const key = groupKey(item);
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  // Take up to `limit` groups (not items — each group becomes 1 Shopify product)
  const groupEntries = Array.from(groups.entries()).slice(0, limit);

  const totalProducts = groupEntries.length;
  const totalItems = groupEntries.reduce((sum, [, g]) => sum + g.length, 0);
  console.log(`Dedup: ${unsyncedItems.length} items → ${groups.size} unique products`);
  console.log(`This batch: ${totalProducts} products (${totalItems} items)\n`);

  const service = new ShopifySyncService(supabase as never, config.user_id);

  const startTime = Date.now();
  let created = 0;
  let failed = 0;
  let itemsSynced = 0;

  // Build a lookup of already-synced items by group key to detect existing groups
  // We need set_number, condition, listing_value from synced siblings
  const { data: syncedWithDetails } = await supabase
    .from('shopify_products')
    .select('shopify_product_id, inventory_items!inner(set_number, condition, listing_value)')
    .eq('user_id', config.user_id)
    .eq('sync_status', 'synced')
    .neq('shopify_product_id', '');

  const syncedGroupMap = new Map<string, string>();
  for (const row of syncedWithDetails ?? []) {
    const inv = row.inventory_items as unknown as {
      set_number: string | null;
      condition: string | null;
      listing_value: number | null;
    };
    if (inv) {
      const key = `${inv.set_number ?? 'UNKNOWN'}|${(inv.condition ?? 'N').toUpperCase()}|${inv.listing_value ?? 0}`;
      if (!syncedGroupMap.has(key)) {
        syncedGroupMap.set(key, row.shopify_product_id);
      }
    }
  }

  let addedToGroup = 0;

  for (let i = 0; i < groupEntries.length; i++) {
    const [key, group] = groupEntries[i];
    const rep = group[0];
    const qty = group.length;
    const label = `${rep.set_number} ${rep.item_name} (${rep.condition}, £${rep.listing_value})`;
    const qtyLabel = qty > 1 ? ` x${qty}` : '';
    const progress = `[${i + 1}/${totalProducts}]`;

    const ids = group.map((g) => g.id);
    const existingProductId = syncedGroupMap.get(key);

    if (existingProductId) {
      process.stdout.write(`${progress} ${label}${qtyLabel} → add to existing...`);
      const result = await service.addItemsToExistingGroup(ids, existingProductId);
      if (result.success) {
        console.log(` OK`);
        addedToGroup += qty;
        itemsSynced += qty;
      } else {
        console.log(` FAILED: ${result.error}`);
        failed++;
      }
    } else {
      process.stdout.write(`${progress} ${label}${qtyLabel}...`);
      const result = qty === 1
        ? await service.createProduct(ids[0])
        : await service.createProductForGroup(ids, qty);

      if (result.success) {
        console.log(` OK`);
        created++;
        itemsSynced += qty;
      } else {
        console.log(` FAILED: ${result.error}`);
        failed++;
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const remainingProducts = groups.size - created;

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  RESULTS: ${created} products created, ${addedToGroup} items added to existing groups`);
  console.log(`  Total items synced: ${itemsSynced}, ${failed} failed in ${elapsed}s`);
  console.log(`  Remaining unique products to sync: ${remainingProducts}`);
  console.log(`${'─'.repeat(60)}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
