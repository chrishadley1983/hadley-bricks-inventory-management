/**
 * Script to clear and re-sync Amazon transactions
 *
 * This script:
 * 1. Deletes all existing amazon_transactions for the user
 * 2. Resets the sync cursor
 * 3. Triggers a full sync from 2025-01-01
 *
 * Run with: npx tsx scripts/resync-amazon-transactions.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  console.log('=== Amazon Transactions Re-sync Script ===\n');

  // Get the user (assuming single user system)
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id')
    .limit(1);

  if (profileError || !profiles?.length) {
    console.error('Error getting user profile:', profileError);
    process.exit(1);
  }

  const userId = profiles[0].id;
  console.log(`User ID: ${userId}\n`);

  // Step 1: Count existing transactions
  const { count: beforeCount } = await supabase
    .from('amazon_transactions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  console.log(`Step 1: Found ${beforeCount || 0} existing Amazon transactions`);

  // Step 2: Delete all amazon_transactions for this user
  console.log('Step 2: Deleting all Amazon transactions...');
  const { error: deleteError } = await supabase
    .from('amazon_transactions')
    .delete()
    .eq('user_id', userId);

  if (deleteError) {
    console.error('Error deleting transactions:', deleteError);
    process.exit(1);
  }
  console.log('   Deleted successfully');

  // Step 3: Reset the sync cursor in amazon_sync_config
  console.log('Step 3: Resetting sync cursor...');
  const { error: configError } = await supabase
    .from('amazon_sync_config')
    .update({
      transactions_posted_cursor: null,
      historical_import_started_at: null,
      historical_import_completed_at: null,
    })
    .eq('user_id', userId);

  if (configError) {
    console.error('Error resetting config:', configError);
    // Continue anyway, config might not exist
  } else {
    console.log('   Cursor reset successfully');
  }

  // Step 4: Verify deletion
  const { count: afterCount } = await supabase
    .from('amazon_transactions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  console.log(`Step 4: Verification - ${afterCount || 0} transactions remaining`);

  console.log('\n=== Done ===');
  console.log('\nNow go to the Transactions page in the app and:');
  console.log('1. Select "Full Sync (from 2025)" from the dropdown');
  console.log('2. Click "Sync Transactions"');
  console.log('\nThis will re-fetch all transactions with the corrected fee calculation.');
}

main().catch(console.error);
