/**
 * Test script to fetch Bricqer inventory statistics
 * Scans ALL inventory to calculate accurate stats matching the UI
 *
 * Rate limit strategy: 600ms delay between requests (~100 req/min)
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
config({ path: resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import { decrypt } from '../src/lib/crypto/encryption';

interface BricqerCredentials {
  apiKey: string;
  tenantUrl: string;
}

interface RawInventoryResponse {
  page: {
    count: number;
    number: number;
    size: number;
    links: { next: string | null; previous: string | null };
  };
  results: Array<{
    id: number;
    remainingQuantity: number;
    definition?: {
      price?: number;
      color?: { id: number; name: string };
    };
  }>;
}

// Rate limiting: 600ms between requests = ~100 requests/minute (safe margin)
const DELAY_MS = 600;

async function main() {
  console.log('='.repeat(60));
  console.log('Bricqer Full Inventory Scan');
  console.log('='.repeat(60));
  console.log('');
  console.log(`Rate limit: ${DELAY_MS}ms between requests (~${Math.round(60000/DELAY_MS)} req/min)`);
  console.log('Estimated time: ~3 minutes for 255 pages');
  console.log('');

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Get Bricqer credentials
  const { data: creds, error: credError } = await supabase
    .from('platform_credentials')
    .select('*')
    .eq('platform', 'bricqer')
    .single();

  if (credError || !creds) {
    console.error('Failed to get Bricqer credentials:', credError?.message);
    process.exit(1);
  }

  const decrypted = await decrypt(creds.credentials_encrypted);
  const credentials: BricqerCredentials = JSON.parse(decrypted);

  console.log('Tenant URL:', credentials.tenantUrl);
  console.log('');

  // Get total count first
  console.log('Getting total inventory count...');
  const countResponse = await fetch(`${credentials.tenantUrl}/api/v1/inventory/item/?limit=1`, {
    headers: {
      'Authorization': `Api-Key ${credentials.apiKey}`,
      'Accept': 'application/json',
    },
  });
  const countData = await countResponse.json() as RawInventoryResponse;
  const totalInApi = countData.page?.count ?? 0;
  const totalPages = Math.ceil(totalInApi / 100);
  console.log(`Total items in API: ${totalInApi.toLocaleString()} (${totalPages} pages)`);

  await new Promise((r) => setTimeout(r, DELAY_MS));

  // Scan all inventory
  console.log('\nScanning all inventory (with qty > 0 filter)...');
  const startTime = Date.now();

  let page = 1;
  let lotsWithStock = 0;
  let totalQty = 0;
  let totalValue = 0;
  let totalScanned = 0;

  // Also track Pearl Dark Gray specifically for verification
  let pdgLots = 0;
  let pdgQty = 0;
  let pdgValue = 0;

  while (page <= totalPages + 1) {
    try {
      const pageResponse = await fetch(
        `${credentials.tenantUrl}/api/v1/inventory/item/?limit=100&page=${page}`,
        {
          headers: {
            'Authorization': `Api-Key ${credentials.apiKey}`,
            'Accept': 'application/json',
          },
        }
      );

      if (pageResponse.status === 429) {
        console.log(`  Rate limited at page ${page}, waiting 30s...`);
        await new Promise((r) => setTimeout(r, 30000));
        continue; // Retry same page
      }

      const pageData = await pageResponse.json() as RawInventoryResponse;
      const items = pageData.results || [];
      if (items.length === 0) break;

      for (const item of items) {
        totalScanned++;
        const qty = item.remainingQuantity ?? 0;
        const price = item.definition?.price ?? 0;
        const colorName = item.definition?.color?.name || '';

        if (qty > 0) {
          lotsWithStock++;
          totalQty += qty;
          totalValue += qty * price;

          // Track Pearl Dark Gray
          if (colorName.toLowerCase().includes('pearl') &&
              colorName.toLowerCase().includes('dark') &&
              colorName.toLowerCase().includes('gray')) {
            pdgLots++;
            pdgQty += qty;
            pdgValue += qty * price;
          }
        }
      }

      // Progress update every 25 pages
      if (page % 25 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const pct = ((page / totalPages) * 100).toFixed(1);
        const eta = ((elapsed / page) * (totalPages - page)).toFixed(0);
        console.log(`  Page ${page}/${totalPages} (${pct}%) - ${lotsWithStock.toLocaleString()} lots, £${totalValue.toFixed(2)} - ETA: ${eta}s`);
      }

      page++;
      await new Promise((r) => setTimeout(r, DELAY_MS));
    } catch (err) {
      console.log(`  Error at page ${page}: ${err}`);
      console.log('  Waiting 10s and retrying...');
      await new Promise((r) => setTimeout(r, 10000));
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('');
  console.log('='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log(`  Scan completed in ${elapsed}s`);
  console.log(`  Items scanned:  ${totalScanned.toLocaleString()}`);
  console.log('');
  console.log('  ALL INVENTORY (qty > 0):');
  console.log(`    Lots:     ${lotsWithStock.toLocaleString()}`);
  console.log(`    Quantity: ${totalQty.toLocaleString()}`);
  console.log(`    Value:    £${totalValue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log('');
  console.log('  PEARL DARK GRAY (verification):');
  console.log(`    Lots:     ${pdgLots} (UI shows 137)`);
  console.log(`    Quantity: ${pdgQty} (UI shows 363)`);
  console.log(`    Value:    £${pdgValue.toFixed(2)} (UI shows £183.81)`);
  console.log('');
  console.log('  COMPARE WITH BRICQER UI:');
  console.log('    Lots:     12,212');
  console.log('    Quantity: 50,204');
  console.log('    Value:    £16,651.24');
}

main().catch((error) => {
  console.error('Script failed:', error);
  process.exit(1);
});
