/**
 * One-off script to update listing_value from Google Sheets
 *
 * Logic:
 * 1. Only update if status is LISTED or SOLD
 * 2. Use Column Y (Sale Price) if populated
 * 3. Fall back to Column F (Listing Notes - contains listing price) if Column Y is empty
 * 4. Fall back to Column H (Cost) if neither Y nor F is populated
 *
 * Usage:
 *   npx tsx scripts/update-listing-values.ts [options]
 *
 * Options:
 *   --dry-run       Preview changes without writing to database
 *   --limit=N       Only process first N rows
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';

// Load environment variables
config({ path: resolve(__dirname, '../.env.local') });

import { GoogleSheetsClient } from '../src/lib/google/sheets-client';
import { createClient } from '@supabase/supabase-js';
import { parseCurrency } from '../src/lib/migration/sheet-mappings';

// Column indices (0-based)
const COL_SKU = 0;        // A: ID/SKU
const COL_LISTING_F = 5;  // F: Listing Notes (contains listing price)
const COL_COST_H = 7;     // H: Cost
const COL_STATUS = 15;    // P: Status
const COL_SALE_Y = 24;    // Y: Sale Price

interface SheetRow {
  sku: string;
  status: string;
  listingValue: number | null;
  source: 'sale_price' | 'listing_notes' | 'cost';
  rowNumber: number;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Hadley Bricks - Update Listing Values from Sheets');
  console.log('='.repeat(60));
  console.log('');

  // Parse command line arguments
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  if (limit) {
    console.log(`📊 Processing limited to ${limit} rows\n`);
  }

  console.log('Logic:');
  console.log('  1. Only update if status is LISTED or SOLD');
  console.log('  2. Use Column Y (Sale Price) if populated');
  console.log('  3. Fall back to Column F (Listing Notes) if Column Y is empty');
  console.log('  4. Fall back to Column H (Cost) if neither Y nor F is populated\n');

  // Load Google credentials
  const possiblePaths = [
    process.env.GOOGLE_CREDENTIALS_PATH,
    resolve(__dirname, '../google-credentials.json'),
    'C:/Users/Chris Hadley/Downloads/gen-lang-client-0823893317-af39140849cd.json',
  ].filter(Boolean) as string[];

  let serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  for (const credPath of possiblePaths) {
    if (existsSync(credPath)) {
      console.log(`Loading credentials from: ${credPath}\n`);
      const credentials = JSON.parse(readFileSync(credPath, 'utf-8'));
      serviceAccountEmail = credentials.client_email;
      privateKey = credentials.private_key;
      break;
    }
  }

  if (!serviceAccountEmail || !privateKey) {
    console.error('❌ Missing Google Sheets credentials');
    process.exit(1);
  }

  const spreadsheetId =
    process.env.GOOGLE_SHEETS_ID || '1pmfxrFF4U08gXzsZOd49z4gbmmRHDrE_S8Vb6JqCMnU';

  // Create clients
  const sheetsClient = new GoogleSheetsClient({
    serviceAccountEmail,
    privateKey,
    spreadsheetId,
  });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Test connection
  console.log('Testing Google Sheets connection...');
  const connectionTest = await sheetsClient.testConnection();
  if (!connectionTest.success) {
    console.error('❌ Failed to connect to Google Sheets:', connectionTest.message);
    process.exit(1);
  }
  console.log(`✅ Connected to: ${connectionTest.spreadsheetTitle}\n`);

  // Read inventory sheet - need columns A (SKU), F (Listing Notes), P (Status), Y (Sale Price)
  const sheetName = 'Lego New Kit Inventory';
  console.log(`Reading ${sheetName}...`);

  // Read A through Y (columns 1-25)
  const range = `'${sheetName}'!A2:Y`;
  const rows = await sheetsClient.readRange(range);

  if (!rows || rows.length === 0) {
    console.log('❌ No data found in sheet');
    process.exit(1);
  }

  console.log(`Found ${rows.length} rows in sheet\n`);

  // Parse the rows
  const sheetData: SheetRow[] = [];
  const rowsToProcess = limit ? rows.slice(0, limit) : rows;

  let skippedNotListedSold = 0;
  let skippedNoValue = 0;

  for (let i = 0; i < rowsToProcess.length; i++) {
    const row = rowsToProcess[i];
    const sku = row[COL_SKU]?.toString().trim();
    const status = row[COL_STATUS]?.toString().trim().toUpperCase() || '';
    const salePriceRaw = row[COL_SALE_Y]?.toString().trim() || '';
    const listingNotesRaw = row[COL_LISTING_F]?.toString().trim() || '';
    const costRaw = row[COL_COST_H]?.toString().trim() || '';

    if (!sku) continue;

    // Only process LISTED or SOLD items
    if (status !== 'LISTED' && status !== 'SOLD') {
      skippedNotListedSold++;
      continue;
    }

    // Try Sale Price (Y) first, then Listing Notes (F), then Cost (H)
    const salePrice = parseCurrency(salePriceRaw);
    const listingNotesPrice = parseCurrency(listingNotesRaw);
    const cost = parseCurrency(costRaw);

    let listingValue: number | null = null;
    let source: 'sale_price' | 'listing_notes' | 'cost' = 'sale_price';

    if (salePrice !== null && salePrice > 0) {
      listingValue = salePrice;
      source = 'sale_price';
    } else if (listingNotesPrice !== null && listingNotesPrice > 0) {
      listingValue = listingNotesPrice;
      source = 'listing_notes';
    } else if (cost !== null && cost > 0) {
      listingValue = cost;
      source = 'cost';
    }

    if (listingValue === null) {
      skippedNoValue++;
      continue;
    }

    sheetData.push({
      sku,
      status,
      listingValue,
      source,
      rowNumber: i + 2,
    });
  }

  console.log(`Parsed rows:`);
  console.log(`  With listing values: ${sheetData.length}`);
  console.log(`  Skipped (not LISTED/SOLD): ${skippedNotListedSold}`);
  console.log(`  Skipped (no value in F or Y): ${skippedNoValue}\n`);

  // Count by source
  const fromSalePrice = sheetData.filter((r) => r.source === 'sale_price').length;
  const fromListingNotes = sheetData.filter((r) => r.source === 'listing_notes').length;
  const fromCost = sheetData.filter((r) => r.source === 'cost').length;
  console.log(`Value sources:`);
  console.log(`  From Column Y (Sale Price): ${fromSalePrice}`);
  console.log(`  From Column F (Listing Notes): ${fromListingNotes}`);
  console.log(`  From Column H (Cost): ${fromCost}\n`);

  // Count by status
  const listedCount = sheetData.filter((r) => r.status === 'LISTED').length;
  const soldCount = sheetData.filter((r) => r.status === 'SOLD').length;
  console.log(`By status:`);
  console.log(`  LISTED: ${listedCount}`);
  console.log(`  SOLD: ${soldCount}\n`);

  // Show sample
  console.log('Sample data (first 10):');
  for (const row of sheetData.slice(0, 10)) {
    console.log(`  ${row.sku} [${row.status}]: £${row.listingValue?.toFixed(2)} (from ${row.source})`);
  }
  console.log('');

  if (dryRun) {
    console.log('DRY RUN - Would update the following:');
    console.log(`  Total rows to update: ${sheetData.length}`);
    console.log('\nRun without --dry-run to apply changes');
    return;
  }

  // Update Supabase
  console.log('Updating Supabase...\n');

  let updated = 0;
  let notFound = 0;
  let errors = 0;

  for (const row of sheetData) {
    try {
      const { data, error } = await supabase
        .from('inventory_items')
        .update({ listing_value: row.listingValue })
        .eq('sku', row.sku)
        .select('id');

      if (error) {
        console.error(`  ❌ Error updating ${row.sku}: ${error.message}`);
        errors++;
      } else if (!data || data.length === 0) {
        notFound++;
      } else {
        updated++;
      }
    } catch (err) {
      console.error(`  ❌ Exception updating ${row.sku}:`, err);
      errors++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('UPDATE COMPLETE');
  console.log('='.repeat(60));
  console.log(`Updated: ${updated}`);
  console.log(`Not found in DB: ${notFound}`);
  console.log(`Errors: ${errors}`);

  // Verify the update
  console.log('\nVerifying update...');
  const { data: stats } = await supabase
    .from('inventory_items')
    .select('listing_value')
    .not('listing_value', 'is', null)
    .gt('listing_value', 0);

  console.log(`Total items with listing_value > 0: ${stats?.length || 0}`);
}

main().catch((error) => {
  console.error('Script failed:', error);
  process.exit(1);
});
