/**
 * Test Terapeak research for 10 minifig items.
 * One-off script to verify Terapeak cookies work end-to-end.
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { ResearchService } from '../src/lib/minifig-sync/research.service';

const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';

const ITEM_IDS = [
  'b67af362-371b-4090-83d5-a38a294ce3f9',
  'd47dc548-3b5f-4e89-8674-6e88c159372d',
  '1b71d7cd-2c3a-4c32-bddb-da280a615ab7',
  '08034470-a589-4229-9d14-14875f530308',
  'af9a2864-7fe0-4801-a61b-59daa1e92408',
  '0f365208-5cbd-4bdf-8952-e7fc3782247e',
  '3e17421f-d64e-4253-8549-f821079f4090',
  '4d3423f9-2c2a-490e-be0d-69a635e8bc26',
  'ce959da9-a8bd-42d8-92e8-957612a065cf',
  '6f0093d8-e253-4eb9-808c-545cc367c3a7',
];

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey);
  const research = new ResearchService(supabase, DEFAULT_USER_ID);

  console.log(`Researching ${ITEM_IDS.length} items...`);

  const result = await research.researchAll(ITEM_IDS, {
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
  console.log(`  Researched (live): ${result.itemsResearched}`);
  console.log(`  From cache: ${result.itemsCached}`);
  console.log(`  Errors: ${result.itemsErrored}`);

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    for (const err of result.errors) {
      console.log(`  ${err.item || 'unknown'}: ${err.error}`);
    }
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
