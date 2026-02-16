/**
 * Check the status of the quantity feed and verify listings on Amazon
 *
 * Run with: npx tsx scripts/check-quantity-feed.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { CredentialsRepository } from '../src/lib/repositories/credentials.repository';
import { AmazonListingsClient } from '../src/lib/amazon/amazon-listings.client';
import { AmazonFeedsClient } from '../src/lib/amazon/amazon-feeds.client';
import type { AmazonCredentials } from '../src/lib/amazon/types';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const FEED_ID = '874b0e50-72c1-40a9-b96b-8eca6d26fadf';

const SKUS = [
  { sku: 'HB-B00KMXCKXA-5FA5', asin: 'B00KMXCKXA', expectedPrice: 15.97 },
  { sku: 'HB-B00MUP9WHU-VNE1', asin: 'B00MUP9WHU', expectedPrice: 15.99 },
  { sku: 'HB-B00RY4VVLM-17IZ', asin: 'B00RY4VVLM', expectedPrice: 13.99 },
  { sku: 'HB-B01KJEOCDW-HDDP', asin: 'B01KJEOCDW', expectedPrice: 26.99 },
  { sku: 'HB-B07P19NWVF-M465', asin: 'B07P19NWVF', expectedPrice: 25.49 },
  { sku: 'HB-B08TX6BF4Q-UKOM', asin: 'B08TX6BF4Q', expectedPrice: 21.99 },
  { sku: 'HB-B09BNSW12G-TJUV', asin: 'B09BNSW12G', expectedPrice: 21.99 },
  { sku: 'HB-B0BYZJ1Q13-4V2N', asin: 'B0BYZJ1Q13', expectedPrice: 36.99 },
  { sku: 'HB-B0DHSFJVLW-MC6L', asin: 'B0DHSFJVLW', expectedPrice: 19.99 },
];

async function main() {
  console.log(`\n=== Quantity Feed Check (${new Date().toISOString()}) ===\n`);

  // Get user & credentials
  const { data: profiles } = await supabase.from('profiles').select('id').limit(1);
  const userId = profiles![0].id;

  const credentialsRepo = new CredentialsRepository(supabase as never);
  const credentials = await credentialsRepo.getCredentials<AmazonCredentials>(userId, 'amazon');
  if (!credentials) {
    console.error('No Amazon credentials');
    process.exit(1);
  }

  // 1. Check feed status in DB
  const { data: feed } = await supabase
    .from('amazon_sync_feeds')
    .select('id, status, amazon_feed_id, error_message')
    .eq('id', FEED_ID)
    .single();

  console.log(`Feed status in DB: ${feed?.status}`);
  if (feed?.error_message) console.log(`Error: ${feed.error_message}`);

  // 2. Check feed status on Amazon
  const feedsClient = new AmazonFeedsClient(credentials);
  try {
    const amazonStatus = await feedsClient.getFeedStatus(feed!.amazon_feed_id!);
    console.log(`Amazon feed status: ${amazonStatus.processingStatus}`);

    if (amazonStatus.processingStatus === 'DONE' && amazonStatus.resultFeedDocumentId) {
      const result = await feedsClient.getFeedResult(amazonStatus.resultFeedDocumentId);
      console.log(`Result: ${result.summary.messagesAccepted}/${result.summary.messagesProcessed} accepted, ${result.summary.errors} errors`);
      if (result.issues?.length) {
        console.log('Issues:');
        for (const issue of result.issues) {
          console.log(`  [${issue.severity}] ${issue.sku}: ${issue.message}`);
        }
      }
    }
  } catch (err) {
    console.log(`Could not check Amazon feed status: ${err}`);
  }

  // 3. Check each listing on Amazon
  console.log('\n--- Per-SKU Listing Check ---\n');
  const listingsClient = new AmazonListingsClient(credentials);

  let verified = 0;
  let failed = 0;

  for (const item of SKUS) {
    try {
      const listing = await listingsClient.getListing(item.sku, 'A1F83G8C2ARO7P', ['offers', 'fulfillmentAvailability']);
      const offer = listing?.offers?.find((o: { marketplaceId: string }) => o.marketplaceId === 'A1F83G8C2ARO7P');
      const livePrice = offer?.price?.amount;
      const quantity = listing?.fulfillmentAvailability?.[0]?.quantity;

      const priceOk = livePrice !== undefined && Math.abs(livePrice - item.expectedPrice) < 0.01;
      const qtyOk = quantity !== undefined && quantity >= 1;

      const status = priceOk && qtyOk ? 'OK' : priceOk ? 'PRICE OK, QTY MISSING' : qtyOk ? 'QTY OK, PRICE MISSING' : 'NOT LIVE';

      console.log(`${item.sku} (${item.asin}): ${status} | price=${livePrice ?? 'N/A'} (exp ${item.expectedPrice}) | qty=${quantity ?? 'N/A'}`);

      if (priceOk && qtyOk) verified++;
      else failed++;
    } catch (err) {
      console.log(`${item.sku} (${item.asin}): ERROR - ${err}`);
      failed++;
    }
  }

  console.log(`\n=== Summary: ${verified}/9 fully live, ${failed}/9 pending/failed ===\n`);
}

main().catch((err) => {
  console.error('Check failed:', err);
  process.exit(1);
});
