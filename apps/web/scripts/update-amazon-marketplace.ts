/**
 * Script to update Amazon marketplace IDs to UK only
 *
 * Run with: npx tsx scripts/update-amazon-marketplace.ts
 */

import { createClient } from '@supabase/supabase-js';
import { CredentialsRepository } from '../src/lib/repositories/credentials.repository';
import type { AmazonCredentials } from '../src/lib/amazon/types';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function updateMarketplace() {
  console.log('Connecting to Supabase...');

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const credentialsRepo = new CredentialsRepository(supabase);

  // Get all users with Amazon credentials
  const { data: credentials, error } = await supabase
    .from('platform_credentials')
    .select('user_id')
    .eq('platform', 'amazon');

  if (error) {
    console.error('Error fetching credentials:', error);
    return;
  }

  if (!credentials || credentials.length === 0) {
    console.log('No Amazon credentials found');
    return;
  }

  for (const cred of credentials) {
    console.log(`\nProcessing user: ${cred.user_id}`);

    try {
      // Get current credentials
      const currentCreds = await credentialsRepo.getCredentials<AmazonCredentials>(
        cred.user_id,
        'amazon'
      );

      if (!currentCreds) {
        console.log('  Could not decrypt credentials');
        continue;
      }

      console.log('  Current marketplaceIds:', currentCreds.marketplaceIds);

      // Update to UK only
      const updatedCreds: AmazonCredentials = {
        ...currentCreds,
        marketplaceIds: ['A1F83G8C2ARO7P'], // UK only
      };

      // Save updated credentials
      await credentialsRepo.saveCredentials(cred.user_id, 'amazon', updatedCreds);

      console.log('  Updated marketplaceIds to: ["A1F83G8C2ARO7P"] (UK)');
    } catch (err) {
      console.error('  Error:', err);
    }
  }

  console.log('\nDone!');
}

updateMarketplace();
