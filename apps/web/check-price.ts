/**
 * One-off diagnostic: check what Amazon Listings API returns for SKUs.
 * Run: npx tsx check-price.ts
 * Delete after use.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '.env.local') });

import { createClient } from '@supabase/supabase-js';
import { AmazonSyncService } from './src/lib/amazon/amazon-sync.service';
import { AmazonListingsClient } from './src/lib/amazon/amazon-listings.client';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const userId = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';
  const service = new AmazonSyncService(supabase as any, userId);

  // Access private method via any cast
  const credentials = await (service as any).getAmazonCredentials();
  if (!credentials) { console.error('No credentials'); return; }

  console.log('Got credentials for seller:', credentials.sellerId);

  const listingsClient = new AmazonListingsClient(credentials);

  // SKUs from stuck feed 2679df38-bd4a-40ab-90ec-affcfba3284c
  const testSkus = [
    { sku: 'HB-B0G6XD72Q1-7KPH', asin: 'B0G6XD72Q1', expected: 27.98 },
    { sku: 'HB-B00NVDOH2U-YMZZ', asin: 'B00NVDOH2U', expected: 20.49 },
    { sku: 'HB-B075GQ2KT8-JUP9', asin: 'B075GQ2KT8', expected: 32.99 },
    { sku: '13-F67E-R32R', asin: 'B0DJLSDXCM', expected: 47.99 },
    { sku: 'HB-B01KJEOCDW-HDDP', asin: 'B01KJEOCDW', expected: 26.99 },
    { sku: '85-BP3U-Z2SW', asin: 'B06WLL3M8Y', expected: 28.99 },
    { sku: 'N4-3P31-8SQN', asin: 'B08G4MH27V', expected: 26.49 },
    { sku: 'MM-HBW3-C55K', asin: 'B09BNSL6FB', expected: 24.99 },
  ];

  for (const test of testSkus) {
    console.log(`\n=== ${test.sku} (ASIN: ${test.asin}) ===`);
    try {
      const listing = await listingsClient.getListing(test.sku, 'A1F83G8C2ARO7P', ['offers', 'fulfillmentAvailability']);
      const offer = listing?.offers?.find((o: any) => o.marketplaceId === 'A1F83G8C2ARO7P');
      const livePrice = offer?.price?.amount;
      const fulfillment = listing?.fulfillmentAvailability?.find((f: any) => f.fulfillmentChannelCode === 'DEFAULT');

      console.log('Live price:', livePrice, `(type: ${typeof livePrice})`);
      console.log('Expected:', test.expected);
      console.log('Match:', livePrice !== undefined && Math.abs(Number(livePrice) - test.expected) < 0.01);
      console.log('Live qty:', fulfillment?.quantity);
      if (!listing?.offers?.length) {
        console.log('NO OFFERS - Full listing keys:', listing ? Object.keys(listing) : 'null');
        console.log('Full listing:', JSON.stringify(listing, null, 2)?.substring(0, 500));
      } else {
        console.log('Offer price obj:', JSON.stringify(offer?.price));
      }
    } catch (err: any) {
      console.error('Error:', err.message);
    }
  }
}

main().catch(console.error);
