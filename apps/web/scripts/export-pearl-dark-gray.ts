/**
 * Export all Pearl Dark Gray inventory items to CSV
 * Rate limit: 600ms between requests to avoid 429 errors
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { writeFileSync } from 'fs';

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
    storageId: number;
    storageLabel: string;
    remainingQuantity: number;
    definition?: {
      description: string;
      legoId: string;
      legoType: string;
      price?: number;
      condition?: string;
      color?: { id: number; name: string; rgb: string };
    };
  }>;
}

interface PearlDarkGrayItem {
  id: number;
  storageLabel: string;
  legoId: string;
  description: string;
  condition: string;
  remainingQuantity: number;
  price: number;
  totalValue: number;
}

const DELAY_MS = 600;

async function main() {
  console.log('='.repeat(60));
  console.log('Export Pearl Dark Gray Inventory');
  console.log('='.repeat(60));
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
  console.log('');

  await new Promise((r) => setTimeout(r, DELAY_MS));

  // Scan all inventory for Pearl Dark Gray items
  console.log('Scanning for Pearl Dark Gray items...');
  const startTime = Date.now();

  const pearlDarkGrayItems: PearlDarkGrayItem[] = [];
  let page = 1;
  let totalScanned = 0;

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
        const colorName = item.definition?.color?.name || '';

        // Check if Pearl Dark Gray with stock
        if (colorName.toLowerCase().includes('pearl') &&
            colorName.toLowerCase().includes('dark') &&
            colorName.toLowerCase().includes('gray')) {
          const qty = item.remainingQuantity ?? 0;
          if (qty > 0) {
            const price = item.definition?.price ?? 0;
            pearlDarkGrayItems.push({
              id: item.id,
              storageLabel: item.storageLabel || '',
              legoId: item.definition?.legoId || '',
              description: item.definition?.description || '',
              condition: item.definition?.condition === 'N' ? 'New' : 'Used',
              remainingQuantity: qty,
              price: price,
              totalValue: qty * price,
            });
          }
        }
      }

      // Progress update every 25 pages
      if (page % 25 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const pct = ((page / totalPages) * 100).toFixed(1);
        console.log(`  Page ${page}/${totalPages} (${pct}%) - Found ${pearlDarkGrayItems.length} items so far... (${elapsed.toFixed(0)}s)`);
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
  console.log(`  Items scanned: ${totalScanned.toLocaleString()}`);
  console.log(`  Pearl Dark Gray lots found: ${pearlDarkGrayItems.length}`);
  console.log('');

  // Calculate totals
  const totalQty = pearlDarkGrayItems.reduce((sum, item) => sum + item.remainingQuantity, 0);
  const totalValue = pearlDarkGrayItems.reduce((sum, item) => sum + item.totalValue, 0);

  console.log('  Summary:');
  console.log(`    Lots:     ${pearlDarkGrayItems.length}`);
  console.log(`    Quantity: ${totalQty}`);
  console.log(`    Value:    £${totalValue.toFixed(2)}`);
  console.log('');

  // Sort by value descending
  pearlDarkGrayItems.sort((a, b) => b.totalValue - a.totalValue);

  // Generate CSV
  const csvHeaders = ['ID', 'Storage', 'Lego ID', 'Description', 'Condition', 'Qty', 'Price', 'Total Value'];
  const csvRows = pearlDarkGrayItems.map((item) => [
    item.id,
    `"${item.storageLabel}"`,
    item.legoId,
    `"${item.description.replace(/"/g, '""')}"`,
    item.condition,
    item.remainingQuantity,
    item.price.toFixed(2),
    item.totalValue.toFixed(2),
  ].join(','));

  const csvContent = [csvHeaders.join(','), ...csvRows].join('\n');

  // Write to file
  const outputPath = resolve(__dirname, '../pearl-dark-gray-inventory.csv');
  writeFileSync(outputPath, csvContent, 'utf-8');
  console.log(`  CSV exported to: ${outputPath}`);

  // Also show top 10
  console.log('');
  console.log('  Top 10 by value:');
  for (const item of pearlDarkGrayItems.slice(0, 10)) {
    console.log(`    ${item.legoId} - ${item.description.slice(0, 40)}... - ${item.remainingQuantity}x @ £${item.price.toFixed(2)} = £${item.totalValue.toFixed(2)}`);
  }
}

main().catch((error) => {
  console.error('Script failed:', error);
  process.exit(1);
});
