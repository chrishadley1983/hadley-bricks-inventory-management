/**
 * Quick check of Bricqer rate limit status - single request with full header dump.
 * Run with: npx tsx apps/web/check-rate-limit.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '.env.local') });

import { createClient } from '@supabase/supabase-js';
import { decryptObject } from './src/lib/crypto/encryption';
import type { BricqerCredentials } from './src/lib/bricqer/types';

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: credRow } = await supabase.from('platform_credentials').select('credentials_encrypted').eq('platform', 'bricqer').single();
  const credentials = await decryptObject<BricqerCredentials>(credRow!.credentials_encrypted);

  const baseUrl = credentials.tenantUrl.replace(/\/$/, '');
  const url = `${baseUrl}/api/v1/inventory/item/?limit=1&page=1`;

  console.log(`Fetching: ${url}`);
  const response = await fetch(url, {
    headers: {
      Authorization: `Api-Key ${credentials.apiKey}`,
      Accept: 'application/json',
    },
  });

  console.log(`\nStatus: ${response.status} ${response.statusText}`);
  console.log(`\nAll headers:`);
  response.headers.forEach((value, key) => {
    console.log(`  ${key}: ${value}`);
  });

  console.log(`\nRate limit headers:`);
  console.log(`  X-RateLimit-Remaining: ${response.headers.get('X-RateLimit-Remaining')}`);
  console.log(`  X-RateLimit-Limit: ${response.headers.get('X-RateLimit-Limit')}`);
  console.log(`  X-RateLimit-Reset: ${response.headers.get('X-RateLimit-Reset')}`);

  if (response.status === 429) {
    const reset = response.headers.get('X-RateLimit-Reset');
    if (reset) {
      const resetDate = new Date(parseInt(reset, 10) * 1000);
      console.log(`\n  Reset time: ${resetDate.toISOString()}`);
      console.log(`  Current time: ${new Date().toISOString()}`);
      console.log(`  Wait needed: ${Math.max(0, resetDate.getTime() - Date.now()) / 1000}s`);
    }
    const body = await response.text();
    console.log(`\n  Response body: ${body.substring(0, 500)}`);
  } else {
    const data = await response.json();
    const count = data.page?.count ?? data.count ?? 'unknown';
    const results = data.results?.length ?? 'unknown';
    console.log(`\n  Total items: ${count}`);
    console.log(`  Items in this page: ${results}`);
  }
}

main().catch(console.error);
