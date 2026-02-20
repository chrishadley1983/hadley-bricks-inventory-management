/**
 * Create sample eBay listings for 10 random minifigs.
 *
 * 1. Query 10 random NOT_LISTED items with a recommended_price
 * 2. Source images for each (Google + BrickLink + Rebrickable)
 * 3. Save images to minifig_sync_items.images JSONB
 * 4. Call ListingStagingService.createStagedListings() to stage them
 * 5. Print results
 *
 * Items will be in STAGED status — NOT published. Review in the app first.
 *
 * Usage: npx tsx apps/web/scripts/create-sample-listings.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { ImageSourcer } from '../src/lib/minifig-sync/image-sourcer';
import { ListingStagingService } from '../src/lib/minifig-sync/listing-staging.service';

const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';
const SAMPLE_COUNT = 10;

async function main() {
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const rebrickableApiKey = process.env.REBRICKABLE_API_KEY ?? '';

  // 1. Query 10 random NOT_LISTED items with recommended_price
  console.log(`Querying ${SAMPLE_COUNT} random minifigs for sample listings...`);

  // Supabase doesn't have ORDER BY random(), so fetch all IDs and pick randomly
  const { data: allItems, error: queryError } = await supabase
    .from('minifig_sync_items')
    .select('id, name, bricklink_id, bricqer_image_url, recommended_price')
    .eq('user_id', DEFAULT_USER_ID)
    .eq('listing_status', 'NOT_LISTED')
    .eq('meets_threshold', true)
    .not('recommended_price', 'is', null)
    .not('bricklink_id', 'is', null);

  if (queryError) {
    throw new Error(`Failed to query items: ${queryError.message}`);
  }

  if (!allItems || allItems.length === 0) {
    console.log('No qualifying items found. Run inventory pull first.');
    return;
  }

  // Shuffle and take SAMPLE_COUNT
  const shuffled = allItems.sort(() => Math.random() - 0.5);
  const sampleItems = shuffled.slice(0, SAMPLE_COUNT);

  console.log(`Selected ${sampleItems.length} items for sample listings:\n`);
  for (const item of sampleItems) {
    console.log(`  - ${item.bricklink_id}: ${item.name} (£${item.recommended_price})`);
  }

  // 2. Source images for each
  console.log('\nSourcing images...');
  const imageSourcer = new ImageSourcer(rebrickableApiKey);
  const sampleIds: string[] = [];

  for (let i = 0; i < sampleItems.length; i++) {
    const item = sampleItems[i];
    const label = `[${i + 1}/${sampleItems.length}] ${item.bricklink_id}`;

    try {
      const images = await imageSourcer.sourceImages(
        item.name,
        item.bricklink_id!,
        item.bricqer_image_url,
      );

      console.log(`  ${label}: ${images.length} images found`);

      // 3. Save images to JSONB
      await supabase
        .from('minifig_sync_items')
        .update({
          images: images as unknown as Database['public']['Tables']['minifig_sync_items']['Update']['images'],
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.id)
        .eq('user_id', DEFAULT_USER_ID);

      sampleIds.push(item.id);
    } catch (err) {
      console.error(`  ${label}: FAILED - ${err instanceof Error ? err.message : err}`);
    }
  }

  if (sampleIds.length === 0) {
    console.log('\nNo items had images sourced. Aborting staging.');
    return;
  }

  // 4. Stage listings
  console.log(`\nStaging ${sampleIds.length} items on eBay (unpublished)...`);
  const stagingService = new ListingStagingService(supabase, DEFAULT_USER_ID);

  const result = await stagingService.createStagedListings(sampleIds, {
    onProgress: (event) => {
      if (event.type === 'progress') {
        console.log(`  [${event.current}/${event.total}] ${event.message}`);
      } else if (event.type === 'stage') {
        console.log(`  >> ${event.message}`);
      }
    },
  });

  // 5. Print results
  console.log('\n=== Results ===');
  console.log(`  Processed: ${result.itemsProcessed}`);
  console.log(`  Staged:    ${result.itemsStaged}`);
  console.log(`  Skipped:   ${result.itemsSkipped}`);
  console.log(`  Errors:    ${result.itemsErrored}`);

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    for (const err of result.errors) {
      console.log(`  ${err.item || 'unknown'}: ${err.error}`);
    }
  }

  // Verify staged items
  const { data: stagedItems } = await supabase
    .from('minifig_sync_items')
    .select('name, listing_status, ebay_sku, ebay_offer_id')
    .eq('user_id', DEFAULT_USER_ID)
    .eq('listing_status', 'STAGED')
    .in('id', sampleIds);

  if (stagedItems && stagedItems.length > 0) {
    console.log(`\n=== Staged Listings (${stagedItems.length}) ===`);
    for (const item of stagedItems) {
      console.log(`  ${item.ebay_sku}: ${item.name} (offer: ${item.ebay_offer_id})`);
    }
  }

  console.log('\nDone! Review staged items in the app before publishing.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
