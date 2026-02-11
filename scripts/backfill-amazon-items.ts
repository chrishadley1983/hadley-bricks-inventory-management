/**
 * Backfill Amazon order items for dispatch orders
 *
 * Run with: npx tsx scripts/backfill-amazon-items.ts
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';

// Load environment variables
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../apps/web/.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey);

async function main() {
  console.log('Starting Amazon order items backfill...\n');

  // Import the service dynamically to get it to use our supabase client
  const { AmazonSyncService } = await import('../apps/web/src/lib/services/amazon-sync.service');

  // Get the user ID (assuming single user for now)
  const { data: users, error: userError } = await supabase
    .from('users')
    .select('id')
    .limit(1);

  if (userError || !users?.length) {
    console.error('Failed to get user:', userError);
    process.exit(1);
  }

  const userId = users[0].id;
  console.log(`Using user ID: ${userId.substring(0, 8)}...`);

  const syncService = new AmazonSyncService(supabase);

  const result = await syncService.backfillDispatchItems(userId);

  console.log('\n=== Backfill Complete ===');
  console.log(`Success: ${result.success}`);
  console.log(`Orders processed: ${result.ordersProcessed}`);
  console.log(`Orders updated: ${result.ordersUpdated}`);
  if (result.errors.length > 0) {
    console.log('Errors:', result.errors);
  }
}

main().catch(console.error);
