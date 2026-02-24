/**
 * Re-sync a specific set_number: archives old Shopify products, deletes mappings,
 * and re-creates with fresh descriptions from cache.
 *
 * Usage: cd apps/web && npx tsx scripts/resync-set.ts <set_number>
 */
import dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import { ShopifySyncService } from '../src/lib/shopify/sync.service';

const setNumber = process.argv[2];
if (!setNumber) {
  console.error('Usage: npx tsx scripts/resync-set.ts <set_number>');
  process.exit(1);
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: config } = await supabase
    .from('shopify_config')
    .select('user_id')
    .limit(1)
    .single();

  if (!config) {
    console.error('No shopify_config found');
    process.exit(1);
  }

  // Find LISTED items for this set
  const { data: items } = await supabase
    .from('inventory_items')
    .select('id, item_name, condition, listing_value')
    .eq('set_number', setNumber)
    .eq('status', 'LISTED');

  if (!items || items.length === 0) {
    console.log(`No LISTED items found for set ${setNumber}`);
    process.exit(0);
  }

  const ids = items.map((i) => i.id);
  console.log(`Found ${ids.length} LISTED item(s) for set ${setNumber}`);

  // Get existing mappings
  const { data: mappings } = await supabase
    .from('shopify_products')
    .select('shopify_product_id, inventory_item_id')
    .in('inventory_item_id', ids);

  const service = new ShopifySyncService(supabase as never, config.user_id);

  // Archive existing Shopify products
  if (mappings && mappings.length > 0) {
    for (const m of mappings) {
      process.stdout.write(`Archiving ${m.shopify_product_id}...`);
      const result = await service.archiveProduct(m.inventory_item_id);
      console.log(result.success ? ' OK' : ` FAILED: ${result.error}`);
    }

    // Delete mappings so createProduct works
    await supabase.from('shopify_products').delete().in('inventory_item_id', ids);
    console.log('Deleted old mappings');
  }

  // Re-create each item
  for (const item of items) {
    const label = `${item.item_name} (${item.condition}, £${item.listing_value})`;
    process.stdout.write(`Creating ${label}...`);
    const result = await service.createProduct(item.id);
    console.log(result.success ? ' OK' : ` FAILED: ${result.error}`);
  }

  console.log('Done!');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
