/**
 * Quick diagnostic script to test Bricqer API pagination fix.
 * Run with: npx tsx apps/web/check-bricqer.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '.env.local') });

import { createClient } from '@supabase/supabase-js';
import { decryptObject } from './src/lib/crypto/encryption';
import { BricqerClient } from './src/lib/bricqer/client';
import { normalizeInventoryItem } from './src/lib/bricqer/adapter';
import type { BricqerCredentials } from './src/lib/bricqer/types';

async function main() {
  console.log('=== Bricqer API Diagnostic ===\n');
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: credRow } = await supabase.from('platform_credentials').select('credentials_encrypted').eq('platform', 'bricqer').single();
  const credentials = await decryptObject<BricqerCredentials>(credRow!.credentials_encrypted);
  const client = new BricqerClient(credentials);

  // Test 1: Fetch first page and verify pagination metadata
  console.log('--- Test 1: Single page fetch with pagination metadata ---');
  const t1 = Date.now();
  const page1 = await client.fetchInventoryPage(1);
  console.log(`  Items returned: ${page1.items.length}`);
  console.log(`  Total count: ${page1.totalCount}`);
  console.log(`  Has more: ${page1.hasMore}`);
  console.log(`  Time: ${Date.now() - t1}ms`);
  console.log(`  Total pages needed: ${Math.ceil(page1.totalCount / 100)}`);

  // Test 2: Fetch pages 1-5 and count minifigs
  console.log('\n--- Test 2: Pages 1-5 minifig scan ---');
  let minifigCount = 0;
  let usedMinifigCount = 0;
  const legoTypes: Record<string, number> = {};

  for (let p = 1; p <= 5; p++) {
    const t = Date.now();
    const result = await client.fetchInventoryPage(p);
    for (const item of result.items) {
      const normalized = normalizeInventoryItem(item);
      if (!normalized) continue;
      legoTypes[normalized.itemType] = (legoTypes[normalized.itemType] || 0) + 1;
      if (normalized.itemType === 'Minifig') {
        minifigCount++;
        if (normalized.condition === 'Used') usedMinifigCount++;
      }
    }
    console.log(`  Page ${p}: ${result.items.length} items, hasMore=${result.hasMore} (${Date.now() - t}ms)`);
  }

  console.log(`\n  Item types in pages 1-5:`, legoTypes);
  console.log(`  Minifigs found: ${minifigCount} (${usedMinifigCount} used)`);

  // Test 3: Rate limit info
  const rateLimit = client.getRateLimitInfo();
  console.log(`\n--- Rate limit status ---`);
  console.log(`  Remaining: ${rateLimit?.remaining ?? 'unknown'}`);
  console.log(`  Limit: ${rateLimit?.limit ?? 'unknown'}`);
  console.log(`  Reset: ${rateLimit?.resetTime?.toISOString() ?? 'unknown'}`);

  console.log('\n=== Done ===');
}

main().catch(console.error);
