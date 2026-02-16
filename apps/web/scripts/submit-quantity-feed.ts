/**
 * One-off script: Submit quantity-only feed for 9 new SKUs stuck from failed two-phase sync
 *
 * The price feed (aa7b518c-9cf2-41b4-8409-389ee721b102) was accepted by Amazon
 * but verification timed out at 30 minutes (old timeout). Prices are likely live
 * but quantity was never submitted (all at 0). This script submits quantity = 1 for each.
 *
 * Run with: npx tsx scripts/submit-quantity-feed.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { CredentialsRepository } from '../src/lib/repositories/credentials.repository';
import { AmazonFeedsClient } from '../src/lib/amazon/amazon-feeds.client';
import type { AmazonCredentials } from '../src/lib/amazon/types';
import type { ListingsFeedPayload } from '../src/lib/amazon/amazon-sync.types';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// The 9 new SKUs from the failed feed that need quantity = 1
const STUCK_SKUS = [
  { sku: 'HB-B00KMXCKXA-5FA5', asin: 'B00KMXCKXA', quantity: 1, price: 15.97 },
  { sku: 'HB-B00MUP9WHU-VNE1', asin: 'B00MUP9WHU', quantity: 1, price: 15.99 },
  { sku: 'HB-B00RY4VVLM-17IZ', asin: 'B00RY4VVLM', quantity: 1, price: 13.99 },
  { sku: 'HB-B01KJEOCDW-HDDP', asin: 'B01KJEOCDW', quantity: 1, price: 26.99 },
  { sku: 'HB-B07P19NWVF-M465', asin: 'B07P19NWVF', quantity: 1, price: 25.49 },
  { sku: 'HB-B08TX6BF4Q-UKOM', asin: 'B08TX6BF4Q', quantity: 1, price: 21.99 },
  { sku: 'HB-B09BNSW12G-TJUV', asin: 'B09BNSW12G', quantity: 1, price: 21.99 },
  { sku: 'HB-B0BYZJ1Q13-4V2N', asin: 'B0BYZJ1Q13', quantity: 1, price: 36.99 },
  { sku: 'HB-B0DHSFJVLW-MC6L', asin: 'B0DHSFJVLW', quantity: 1, price: 19.99 },
];

const PARENT_FEED_ID = 'aa7b518c-9cf2-41b4-8409-389ee721b102';

async function main() {
  console.log('=== Submit Quantity Feed for Stuck SKUs ===\n');

  // Get user
  const { data: profiles } = await supabase.from('profiles').select('id').limit(1);
  if (!profiles?.length) {
    console.error('No user profile found');
    process.exit(1);
  }
  const userId = profiles[0].id;
  console.log(`User ID: ${userId}`);

  // Get Amazon credentials
  const credentialsRepo = new CredentialsRepository(supabase as never);
  const credentials = await credentialsRepo.getCredentials<AmazonCredentials>(userId, 'amazon');
  if (!credentials) {
    console.error('Amazon credentials not found');
    process.exit(1);
  }
  console.log(`Seller ID: ${credentials.sellerId}`);

  // Build quantity-only payload
  const payload: ListingsFeedPayload = {
    header: {
      sellerId: credentials.sellerId,
      version: '2.0',
      issueLocale: 'en_GB',
    },
    messages: STUCK_SKUS.map((item, index) => ({
      messageId: index + 1,
      sku: item.sku,
      operationType: 'PATCH' as const,
      productType: 'PRODUCT',
      patches: [
        {
          op: 'replace' as const,
          path: '/attributes/fulfillment_availability',
          value: [
            {
              fulfillment_channel_code: 'DEFAULT',
              quantity: item.quantity,
            },
          ],
        },
      ],
    })),
  };

  console.log(`\nPayload: ${STUCK_SKUS.length} SKUs, all quantity = 1`);
  console.log('SKUs:', STUCK_SKUS.map((s) => s.sku).join(', '));

  // Create feed record
  const { data: feed, error: feedError } = await supabase
    .from('amazon_sync_feeds')
    .insert({
      user_id: userId,
      feed_type: 'JSON_LISTINGS_FEED',
      is_dry_run: false,
      marketplace_id: 'A1F83G8C2ARO7P',
      status: 'pending',
      total_items: STUCK_SKUS.length,
      sync_mode: 'two_phase',
      phase: 'quantity',
      parent_feed_id: PARENT_FEED_ID,
      request_payload: payload as never,
    })
    .select()
    .single();

  if (feedError || !feed) {
    console.error('Failed to create feed record:', feedError);
    process.exit(1);
  }
  console.log(`\nFeed record created: ${feed.id}`);

  // Create feed items
  const feedItems = STUCK_SKUS.map((item) => ({
    user_id: userId,
    feed_id: feed.id,
    amazon_sku: item.sku,
    asin: item.asin,
    submitted_price: item.price,
    submitted_quantity: item.quantity,
    is_new_sku: false, // SKU already exists from price feed
    status: 'pending',
    phase: 'quantity',
  }));

  const { error: itemsError } = await supabase.from('amazon_sync_feed_items').insert(feedItems);
  if (itemsError) {
    console.error('Failed to create feed items:', itemsError);
    process.exit(1);
  }
  console.log(`Feed items created: ${feedItems.length}`);

  // Submit to Amazon
  console.log('\nSubmitting to Amazon...');
  const feedsClient = new AmazonFeedsClient(credentials);
  const { feedId: amazonFeedId, feedDocumentId } = await feedsClient.submitFeed(
    payload,
    'JSON_LISTINGS_FEED',
    ['A1F83G8C2ARO7P']
  );

  console.log(`Amazon Feed ID: ${amazonFeedId}`);
  console.log(`Feed Document ID: ${feedDocumentId}`);

  // Update feed record with Amazon IDs
  await supabase
    .from('amazon_sync_feeds')
    .update({
      amazon_feed_id: amazonFeedId,
      amazon_feed_document_id: feedDocumentId,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    })
    .eq('id', feed.id);

  // Update parent feed with quantity feed reference
  await supabase
    .from('amazon_sync_feeds')
    .update({
      quantity_feed_id: feed.id,
    })
    .eq('id', PARENT_FEED_ID);

  console.log('\n=== Done! ===');
  console.log(`Feed ${feed.id} submitted to Amazon as ${amazonFeedId}`);
  console.log('Monitor progress in the Sync Feeds tab or check Amazon Seller Central.');
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
