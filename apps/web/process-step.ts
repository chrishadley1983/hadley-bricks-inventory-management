/**
 * One-off: Force past price verification and submit quantity feed.
 * Run: npx tsx process-step.ts
 * Delete after use.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '.env.local') });

import { createClient } from '@supabase/supabase-js';
import { AmazonSyncService } from './src/lib/amazon/amazon-sync.service';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const userId = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';
  const feedId = 'a4587822-c66c-4825-847e-001ffda874d4';
  const userEmail = 'chris@hadleybricks.co.uk';

  const service = new AmazonSyncService(supabase as any, userId);

  // Step 1: Force the feed to verified status
  console.log('Forcing feed past price verification...');
  await supabase
    .from('amazon_sync_feeds')
    .update({
      status: 'verified',
      price_verified_at: new Date().toISOString(),
      two_phase_step: 'price_verifying', // keep this so processPriceVerificationStep runs
    })
    .eq('id', feedId);

  // Step 2: Now call the processTwoPhaseStep - but we need to trick it.
  // Actually, the simplest approach is to reconstruct items and call submitQuantityOnlyFeed directly.

  // Get feed items to reconstruct aggregated items
  const { data: feedItems } = await supabase
    .from('amazon_sync_feed_items')
    .select('*')
    .eq('feed_id', feedId);

  if (!feedItems || feedItems.length === 0) {
    console.error('No feed items found');
    return;
  }

  console.log(`Found ${feedItems.length} feed items`);

  const aggregatedItems = feedItems.map((item: any) => ({
    asin: item.asin,
    amazonSku: item.amazon_sku,
    price: Number(item.submitted_price),
    queueQuantity: item.submitted_quantity,
    existingAmazonQuantity: 0,
    totalQuantity: item.submitted_quantity,
    inventoryItemIds: item.inventory_item_ids,
    queueItemIds: [],
    itemNames: [],
    productType: 'TOY_BUILDING_BLOCK',
    isNewSku: item.is_new_sku ?? false,
  }));

  // Get credentials
  const credentials = await (service as any).getAmazonCredentials();
  if (!credentials) {
    console.error('No credentials');
    return;
  }

  // Submit quantity feed
  console.log('Submitting quantity-only feed...');
  const quantityFeed = await (service as any).submitQuantityOnlyFeed(aggregatedItems, credentials, feedId);
  console.log('Quantity feed submitted:', quantityFeed.id);
  console.log('Amazon feed ID:', quantityFeed.amazon_feed_id);

  // Update parent feed with quantity feed reference
  await supabase
    .from('amazon_sync_feeds')
    .update({
      two_phase_step: 'quantity_submitted',
      quantity_feed_id: quantityFeed.id,
    })
    .eq('id', feedId);

  console.log('Done! Quantity feed submitted. Cron will poll for completion.');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
