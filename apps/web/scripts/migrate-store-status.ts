/**
 * Migration script for importing Store Status from Google Sheets to Supabase
 *
 * Reads from the daily tracking sheet and imports O/C/H status values
 * to the platform_store_status table.
 *
 * Usage:
 *   npx tsx scripts/migrate-store-status.ts [options]
 *
 * Options:
 *   --dry-run       Preview changes without writing to database
 *   --limit=N       Only process first N rows
 *   --user-id=ID    User ID to assign records to (required)
 *   --sheet=NAME    Sheet name to read from (default: "Daily Tracking")
 *
 * Examples:
 *   npx tsx scripts/migrate-store-status.ts --dry-run --limit=10
 *   npx tsx scripts/migrate-store-status.ts --user-id=abc123
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { GoogleSheetsClient } from '../src/lib/google/sheets-client';

type StoreStatus = 'O' | 'C' | 'H';
type Platform = 'amazon' | 'ebay' | 'bricklink';

interface MigrationResult {
  success: boolean;
  rowNumber: number;
  date?: string;
  platform?: Platform;
  status?: StoreStatus;
  error?: string;
  action: 'created' | 'updated' | 'skipped' | 'error';
}

// Load environment variables
config({ path: resolve(__dirname, '../.env.local') });

function parseDate(dateStr: string): string | null {
  if (!dateStr || dateStr.trim() === '') return null;

  const cleaned = dateStr.trim();

  // Try ISO format (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return cleaned;
  }

  // Try UK format (DD/MM/YYYY)
  const ukMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ukMatch) {
    const [, day, month, year] = ukMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Try US format (MM/DD/YYYY)
  const usMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (usMatch) {
    const [, month, day, year] = usMatch;
    const fullYear = year.length === 2 ? `20${year}` : year;
    return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Try parsing as Date object
  const parsed = new Date(cleaned);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  return null;
}

function parseStatus(value: string): StoreStatus | null {
  if (!value || value.trim() === '') return null;

  const cleaned = value.trim().toUpperCase();

  // Accept O, C, H directly
  if (cleaned === 'O' || cleaned === 'C' || cleaned === 'H') {
    return cleaned as StoreStatus;
  }

  // Accept full words
  if (cleaned === 'OPEN') return 'O';
  if (cleaned === 'CLOSED') return 'C';
  if (cleaned === 'HOLIDAY') return 'H';

  return null;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Hadley Bricks - Store Status Migration');
  console.log('='.repeat(60));
  console.log('');

  // Parse command line arguments
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;

  const userIdArg = args.find((a) => a.startsWith('--user-id='));
  let userId = userIdArg ? userIdArg.split('=')[1] : undefined;

  const sheetArg = args.find((a) => a.startsWith('--sheet='));
  const sheetName = sheetArg ? sheetArg.split('=')[1] : 'Daily Breakdown';

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  if (limit) {
    console.log(`📊 Processing limited to ${limit} rows\n`);
  }

  // Load Google credentials from JSON file
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

  // Create Google Sheets client
  const sheetsClient = new GoogleSheetsClient({
    serviceAccountEmail,
    privateKey,
    spreadsheetId,
  });

  // Test connection
  console.log('Testing Google Sheets connection...');
  const connectionTest = await sheetsClient.testConnection();
  if (!connectionTest.success) {
    console.error('❌ Failed to connect to Google Sheets:', connectionTest.message);
    process.exit(1);
  }
  console.log(`✅ Connected to: ${connectionTest.spreadsheetTitle}\n`);

  // Create Supabase client
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // If no user ID provided, try to get first user from Supabase
  if (!userId) {
    console.log('No user ID provided. Fetching first user from Supabase...');
    const { data: users, error } = await supabase.auth.admin.listUsers();
    if (error) {
      console.error('❌ Failed to fetch users:', error.message);
      console.error('Please provide a user ID with --user-id=<id>');
      process.exit(1);
    }

    if (!users.users.length) {
      console.error('❌ No users found in the database');
      console.error('Please create a user first, then run the migration');
      process.exit(1);
    }

    userId = users.users[0].id;
    console.log(`Using user: ${users.users[0].email} (${userId})\n`);
  }

  // Fetch data from sheet
  // Based on the screenshot, columns are:
  // A/B: Date, then listing/sold columns, then O/P/Q for Store Status (Amazon, eBay, BL)
  console.log(`Fetching data from "${sheetName}" sheet...`);

  // Read columns A (date) and O, P, Q (store statuses)
  // Adjust range based on your actual sheet structure
  const range = `'${sheetName}'!A:Q`;

  let rows: string[][];
  try {
    rows = await sheetsClient.readRange(range);
  } catch (error) {
    console.error(`❌ Failed to read sheet "${sheetName}":`, error);
    console.log('Available sheets may have different names. Please check the spreadsheet.');
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.log('No data found in the sheet.');
    process.exit(0);
  }

  // Based on the sheet structure:
  // - Rows 1-2 are blank
  // - Row 3 is headers
  // - Row 4+ is data
  // - Date is in column B (index 1)
  // - Store Status columns are O, P, Q (indexes 14, 15, 16)

  const dateIdx = 1; // Column B
  const amazonStatusIdx = 14; // Column O
  const ebayStatusIdx = 15; // Column P
  const blStatusIdx = 16; // Column Q

  console.log('Column mapping:');
  console.log(`  Date: column ${dateIdx} (B)`);
  console.log(`  Amazon Status: column ${amazonStatusIdx} (O)`);
  console.log(`  eBay Status: column ${ebayStatusIdx} (P)`);
  console.log(`  BrickLink Status: column ${blStatusIdx} (Q)\n`);

  // Skip first 3 rows (2 blank + 1 header)
  const dataRows = rows.slice(3);
  console.log(`Found ${dataRows.length} data rows`);

  // Debug: print first few rows to see actual data
  console.log('Sample data from first 5 data rows:');
  for (let i = 0; i < Math.min(5, dataRows.length); i++) {
    const row = dataRows[i];
    console.log(`  ${row[dateIdx] || 'no date'}: Amazon=${row[amazonStatusIdx] || '-'}, eBay=${row[ebayStatusIdx] || '-'}, BL=${row[blStatusIdx] || '-'}`);
  }
  console.log('');

  const rowsToProcess = limit ? dataRows.slice(0, limit) : dataRows;
  const results: MigrationResult[] = [];

  // Get existing count
  const { count: existingCount } = await supabase
    .from('platform_store_status')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  console.log(`Current store statuses in database: ${existingCount ?? 0}`);
  console.log(`Processing ${rowsToProcess.length} rows...\n`);

  // Batch records for upsert
  const records: { user_id: string; date: string; platform: Platform; status: StoreStatus }[] = [];

  for (let i = 0; i < rowsToProcess.length; i++) {
    const row = rowsToProcess[i];
    const rowNum = i + 4; // +4 because of 0-indexing, 2 blank rows, and 1 header row

    // Get date from column B
    const dateStr = row[dateIdx] || '';
    const date = parseDate(dateStr);

    // Skip rows without valid date
    if (!date) {
      continue;
    }

    // Parse each platform's status
    const amazonStatus = parseStatus(row[amazonStatusIdx] || '');
    const ebayStatus = parseStatus(row[ebayStatusIdx] || '');
    const blStatus = parseStatus(row[blStatusIdx] || '');

    // Add records for each platform that has a status
    if (amazonStatus) {
      records.push({ user_id: userId, date, platform: 'amazon', status: amazonStatus });
      results.push({ success: true, rowNumber: rowNum, date, platform: 'amazon', status: amazonStatus, action: 'created' });
    }
    if (ebayStatus) {
      records.push({ user_id: userId, date, platform: 'ebay', status: ebayStatus });
      results.push({ success: true, rowNumber: rowNum, date, platform: 'ebay', status: ebayStatus, action: 'created' });
    }
    if (blStatus) {
      records.push({ user_id: userId, date, platform: 'bricklink', status: blStatus });
      results.push({ success: true, rowNumber: rowNum, date, platform: 'bricklink', status: blStatus, action: 'created' });
    }
  }

  console.log(`Found ${records.length} store status records to import\n`);

  if (dryRun) {
    console.log('DRY RUN - Sample records:');
    for (const record of records.slice(0, 20)) {
      console.log(`  ${record.date} | ${record.platform.padEnd(9)} | ${record.status}`);
    }
    if (records.length > 20) {
      console.log(`  ... and ${records.length - 20} more records`);
    }
  } else if (records.length > 0) {
    // Upsert in batches of 500
    const batchSize = 500;
    let inserted = 0;
    let errors = 0;

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);

      const { error } = await supabase
        .from('platform_store_status')
        .upsert(batch, {
          onConflict: 'user_id,date,platform',
        });

      if (error) {
        console.error(`❌ Batch ${Math.floor(i / batchSize) + 1} error:`, error.message);
        errors += batch.length;
      } else {
        inserted += batch.length;
        console.log(`✅ Batch ${Math.floor(i / batchSize) + 1}: ${batch.length} records upserted`);
      }
    }

    console.log(`\nInserted/Updated: ${inserted}`);
    console.log(`Errors: ${errors}`);
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('MIGRATION COMPLETE');
  console.log('='.repeat(60));

  const statusCounts = {
    amazon: { O: 0, C: 0, H: 0 },
    ebay: { O: 0, C: 0, H: 0 },
    bricklink: { O: 0, C: 0, H: 0 },
  };

  for (const record of records) {
    statusCounts[record.platform][record.status]++;
  }

  console.log('\nStatus Summary:');
  console.log('  Amazon:    O=' + statusCounts.amazon.O + ', C=' + statusCounts.amazon.C + ', H=' + statusCounts.amazon.H);
  console.log('  eBay:      O=' + statusCounts.ebay.O + ', C=' + statusCounts.ebay.C + ', H=' + statusCounts.ebay.H);
  console.log('  BrickLink: O=' + statusCounts.bricklink.O + ', C=' + statusCounts.bricklink.C + ', H=' + statusCounts.bricklink.H);

  // Get final count
  if (!dryRun) {
    const { count: finalCount } = await supabase
      .from('platform_store_status')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    console.log(`\nFinal store statuses in database: ${finalCount ?? 0}`);
  }
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
