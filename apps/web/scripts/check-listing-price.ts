/**
 * Check Listing Price via Amazon API
 *
 * Run with: npx tsx scripts/check-listing-price.ts
 */

import 'dotenv/config';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local explicitly
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

import { createClient } from '@supabase/supabase-js';
import { AmazonListingsClient } from '../src/lib/amazon/amazon-listings.client';
import { CredentialsRepository } from '../src/lib/repositories/credentials.repository';
import type { Database } from '@hadley-bricks/database';

const SKU = 'HB-B0BYZHTMVW-SM72';
const MARKETPLACE_ID = 'A1F83G8C2ARO7P';

async function main() {
  console.log('='.repeat(60));
  console.log('CHECK AMAZON LISTING PRICE');
  console.log('='.repeat(60));
  console.log(`SKU: ${SKU}`);
  console.log(`Marketplace: ${MARKETPLACE_ID}`);
  console.log('');

  // Create Supabase client
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase environment variables');
    process.exit(1);
  }

  const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey);

  // Get user ID (assuming single user for now)
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id')
    .limit(1);

  if (!profiles || profiles.length === 0) {
    console.error('No user profiles found');
    process.exit(1);
  }

  const userId = profiles[0].id;
  console.log(`User ID: ${userId}`);

  // Get Amazon credentials
  const credentialsRepo = new CredentialsRepository(supabase);
  const credentials = await credentialsRepo.getCredentials(userId, 'amazon');

  if (!credentials) {
    console.error('No Amazon credentials found');
    process.exit(1);
  }

  console.log(`Seller ID: ${credentials.sellerId}`);
  console.log('');

  // Create listings client
  const listingsClient = new AmazonListingsClient(credentials);

  // Get listing details
  console.log('Fetching listing from Amazon API...');
  console.log('');

  try {
    const listing = await listingsClient.getListing(
      SKU,
      MARKETPLACE_ID,
      ['summaries', 'attributes', 'offers', 'fulfillmentAvailability']
    );

    console.log('='.repeat(60));
    console.log('LISTING RESPONSE');
    console.log('='.repeat(60));
    console.log(JSON.stringify(listing, null, 2));

    // Extract key info
    if (listing.offers && listing.offers.length > 0) {
      console.log('');
      console.log('='.repeat(60));
      console.log('PRICE INFORMATION');
      console.log('='.repeat(60));
      for (const offer of listing.offers) {
        console.log(`  Marketplace: ${offer.marketplaceId}`);
        console.log(`  Offer Type: ${offer.offerType}`);
        if (offer.price) {
          console.log(`  Price: ${offer.price.currency} ${offer.price.amount}`);
        } else {
          console.log(`  Price: NOT SET`);
        }
      }
    }

    if (listing.fulfillmentAvailability && listing.fulfillmentAvailability.length > 0) {
      console.log('');
      console.log('FULFILLMENT AVAILABILITY');
      console.log('='.repeat(60));
      for (const fa of listing.fulfillmentAvailability) {
        console.log(`  Channel: ${fa.fulfillmentChannelCode}`);
        console.log(`  Quantity: ${fa.quantity ?? 'NOT SET'}`);
      }
    }

  } catch (error) {
    console.error('Error fetching listing:', error);
  }
}

main().catch(console.error);
