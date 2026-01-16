/**
 * Debug script to test the missing ASIN query
 * Run with: npx tsx scripts/debug-missing-asin.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function main() {
  console.log('Creating Supabase client...');
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // First get all user IDs
  console.log('\n=== All user IDs with Amazon platform items ===');
  const { data: users, error: userError } = await supabase
    .from('inventory_items')
    .select('user_id')
    .ilike('listing_platform', '%amazon%');

  if (userError) {
    console.error('Error fetching users:', userError);
  } else {
    const uniqueUsers = [...new Set(users?.map(u => u.user_id))];
    console.log('Unique user IDs:', uniqueUsers);
  }

  // First, let's see what values are in listing_platform for LISTED items
  console.log('\n=== Checking listing_platform values for LISTED items ===');
  const { data: platformValues, error: platformError } = await supabase
    .from('inventory_items')
    .select('listing_platform')
    .eq('status', 'LISTED')
    .not('listing_platform', 'is', null);

  if (platformError) {
    console.error('Error fetching platform values:', platformError);
  } else {
    const uniquePlatforms = [...new Set(platformValues?.map(p => p.listing_platform))];
    console.log('Unique listing_platform values:', uniquePlatforms);
  }

  // Query 1: Using ilike with wildcards
  console.log('\n=== Query 1: ilike with wildcards ===');
  const { data: data1, error: error1 } = await supabase
    .from('inventory_items')
    .select('id, set_number, listing_platform, amazon_asin, status')
    .eq('status', 'LISTED')
    .ilike('listing_platform', '%amazon%')
    .is('amazon_asin', null);

  if (error1) {
    console.error('Error:', error1);
  } else {
    console.log(`Found ${data1?.length || 0} items`);
    if (data1 && data1.length > 0) {
      console.log('First few items:', data1.slice(0, 3));
    }
  }

  // Query 2: Using eq with exact match 'amazon'
  console.log('\n=== Query 2: eq with exact "amazon" ===');
  const { data: data2, error: error2 } = await supabase
    .from('inventory_items')
    .select('id, set_number, listing_platform, amazon_asin, status')
    .eq('status', 'LISTED')
    .eq('listing_platform', 'amazon')
    .is('amazon_asin', null);

  if (error2) {
    console.error('Error:', error2);
  } else {
    console.log(`Found ${data2?.length || 0} items`);
  }

  // Query 3: Using eq with exact match 'Amazon'
  console.log('\n=== Query 3: eq with exact "Amazon" ===');
  const { data: data3, error: error3 } = await supabase
    .from('inventory_items')
    .select('id, set_number, listing_platform, amazon_asin, status')
    .eq('status', 'LISTED')
    .eq('listing_platform', 'Amazon')
    .is('amazon_asin', null);

  if (error3) {
    console.error('Error:', error3);
  } else {
    console.log(`Found ${data3?.length || 0} items`);
  }

  // Query 4: Without the status filter to see all amazon items missing ASIN
  console.log('\n=== Query 4: Without status filter ===');
  const { data: data4, error: error4 } = await supabase
    .from('inventory_items')
    .select('id, set_number, listing_platform, amazon_asin, status')
    .ilike('listing_platform', '%amazon%')
    .is('amazon_asin', null);

  if (error4) {
    console.error('Error:', error4);
  } else {
    console.log(`Found ${data4?.length || 0} items`);
    if (data4 && data4.length > 0) {
      console.log('Status values:', [...new Set(data4.map(d => d.status))]);
      console.log('First few items:', data4.slice(0, 5));
    }
  }

  // Query 5: Check what status values exist for amazon platform items
  console.log('\n=== Query 5: Status values for Amazon platform items ===');
  const { data: data5, error: error5 } = await supabase
    .from('inventory_items')
    .select('status, amazon_asin')
    .ilike('listing_platform', '%amazon%');

  if (error5) {
    console.error('Error:', error5);
  } else {
    const withAsin = data5?.filter(d => d.amazon_asin !== null) || [];
    const withoutAsin = data5?.filter(d => d.amazon_asin === null) || [];
    console.log(`Total Amazon platform items: ${data5?.length || 0}`);
    console.log(`With ASIN: ${withAsin.length}`);
    console.log(`Without ASIN: ${withoutAsin.length}`);
    console.log('Status values for items WITHOUT ASIN:', [...new Set(withoutAsin.map(d => d.status))]);
  }

  // Query 6: With explicit user_id filter (simulating what the API does)
  const userId = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';
  console.log(`\n=== Query 6: With explicit user_id filter (${userId}) ===`);
  const { data: data6, error: error6 } = await supabase
    .from('inventory_items')
    .select('id, set_number, listing_platform, amazon_asin, status')
    .eq('user_id', userId)
    .eq('status', 'LISTED')
    .ilike('listing_platform', '%amazon%')
    .is('amazon_asin', null);

  if (error6) {
    console.error('Error:', error6);
  } else {
    console.log(`Found ${data6?.length || 0} items`);
    if (data6 && data6.length > 0) {
      console.log('First few items:', data6.slice(0, 3));
    }
  }
}

main().catch(console.error);
