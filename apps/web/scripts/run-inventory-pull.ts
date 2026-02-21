/**
 * Run minifig inventory pull manually.
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { InventoryPullService } from '../src/lib/minifig-sync/inventory-pull.service';

const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';

async function main() {
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const service = new InventoryPullService(supabase, DEFAULT_USER_ID);

  console.log('Running inventory pull...');
  const result = await service.pull({
    onProgress: (event) => {
      if (event.type === 'progress') {
        console.log(`[${event.current}/${event.total}] ${event.message}`);
      } else if (event.type === 'stage') {
        console.log(`>> ${event.message}`);
      }
    },
  });

  console.log('\nResults:');
  console.log(`  Processed: ${result.itemsProcessed}`);
  console.log(`  Created: ${result.itemsCreated}`);
  console.log(`  Updated: ${result.itemsUpdated}`);
  console.log(`  Removed: ${result.itemsRemoved}`);
  console.log(`  Errors: ${result.itemsErrored}`);
  console.log(`  Complete: ${result.complete}`);

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    for (const err of result.errors) {
      console.log(`  ${err.item || 'unknown'}: ${err.error}`);
    }
  }

  // Verify pricing
  console.log('\n=== Sample Pricing Verification ===');
  const { data: samples } = await supabase
    .from('minifig_sync_items')
    .select('name, bricqer_price, recommended_price')
    .eq('user_id', DEFAULT_USER_ID)
    .not('recommended_price', 'is', null)
    .order('bricqer_price', { ascending: true })
    .limit(10);

  if (samples) {
    console.log('  Name                           | Bricqer | Recommended');
    console.log('  ' + '-'.repeat(60));
    for (const s of samples) {
      const name = (s.name || '').slice(0, 30).padEnd(30);
      const bp = (s.bricqer_price ?? 0).toFixed(2).padStart(6);
      const rp = (s.recommended_price ?? 0).toFixed(2).padStart(6);
      console.log(`  ${name} | £${bp} | £${rp}`);
    }
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
