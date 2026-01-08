/**
 * Migration script for importing BrickLink Uploads from Google Sheets to Supabase
 *
 * Reads from the "Bricklink Uploads" tab and imports to bricklink_uploads table.
 *
 * Usage:
 *   npx tsx scripts/migrate-bricklink-uploads.ts [options]
 *
 * Options:
 *   --dry-run       Preview changes without writing to database
 *   --limit=N       Only process first N rows
 *   --user-id=ID    User ID to assign records to (required)
 *
 * Examples:
 *   npx tsx scripts/migrate-bricklink-uploads.ts --dry-run --limit=10
 *   npx tsx scripts/migrate-bricklink-uploads.ts --user-id=abc123
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { GoogleSheetsClient } from '../src/lib/google/sheets-client';

// Sheet column mapping based on the spreadsheet structure
// Expected columns: Date, Parts, Value, Cost, Source, Notes, Linked Lots
interface SheetRow {
  date: string;
  parts: string;
  value: string;
  cost: string;
  source: string;
  notes: string;
  linkedLots: string;
}

interface MigrationResult {
  success: boolean;
  rowNumber: number;
  id?: string;
  error?: string;
  action: 'created' | 'skipped' | 'error';
}

// Load environment variables
config({ path: resolve(__dirname, '../.env.local') });

function parseDate(dateStr: string): string | null {
  if (!dateStr || dateStr.trim() === '') return null;

  // Try different date formats
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

function parseNumber(value: string): number | null {
  if (!value || value.trim() === '') return null;

  // Remove currency symbols and commas
  const cleaned = value.replace(/[£$€,]/g, '').trim();

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseInteger(value: string): number | null {
  const num = parseNumber(value);
  return num !== null ? Math.round(num) : null;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Hadley Bricks - BrickLink Uploads Migration');
  console.log('='.repeat(60));
  console.log('');

  // Parse command line arguments
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;

  const userIdArg = args.find((a) => a.startsWith('--user-id='));
  let userId = userIdArg ? userIdArg.split('=')[1] : undefined;

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

  // Fetch data from "Bricklink Uploads" sheet
  console.log('Fetching data from "Bricklink Uploads" sheet...');

  // The sheet tab name - adjust if different
  const sheetName = 'Bricklink Uploads';
  const range = `'${sheetName}'!A:G`; // Columns A-G based on expected structure

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

  // Parse header row
  const headers = rows[0].map((h) => h.toLowerCase().trim());
  console.log(`Found ${rows.length - 1} data rows (excluding header)`);
  console.log(`Headers: ${headers.join(', ')}\n`);

  // Find column indexes
  const dateIdx = headers.findIndex((h) => h.includes('date'));
  const partsIdx = headers.findIndex((h) => h.includes('part'));
  const valueIdx = headers.findIndex((h) => h.includes('value') || h.includes('price'));
  const costIdx = headers.findIndex((h) => h.includes('cost'));
  const sourceIdx = headers.findIndex((h) => h.includes('source'));
  const notesIdx = headers.findIndex((h) => h.includes('note'));
  const linkedLotsIdx = headers.findIndex((h) => h.includes('linked') || h.includes('lot'));

  console.log('Column mapping:');
  console.log(`  Date: column ${dateIdx >= 0 ? dateIdx : 'NOT FOUND'}`);
  console.log(`  Parts: column ${partsIdx >= 0 ? partsIdx : 'NOT FOUND'}`);
  console.log(`  Value: column ${valueIdx >= 0 ? valueIdx : 'NOT FOUND'}`);
  console.log(`  Cost: column ${costIdx >= 0 ? costIdx : 'NOT FOUND'}`);
  console.log(`  Source: column ${sourceIdx >= 0 ? sourceIdx : 'NOT FOUND'}`);
  console.log(`  Notes: column ${notesIdx >= 0 ? notesIdx : 'NOT FOUND'}`);
  console.log(`  Linked Lots: column ${linkedLotsIdx >= 0 ? linkedLotsIdx : 'NOT FOUND'}\n`);

  // Process data rows
  const dataRows = rows.slice(1);
  const rowsToProcess = limit ? dataRows.slice(0, limit) : dataRows;
  const results: MigrationResult[] = [];

  // Fetch existing purchases for linking
  console.log('Fetching existing purchases for linking...');
  const { data: existingPurchases } = await supabase
    .from('purchases')
    .select('id, reference')
    .eq('user_id', userId);

  const purchaseMap = new Map<string, string>();
  if (existingPurchases) {
    for (const p of existingPurchases) {
      if (p.reference) {
        purchaseMap.set(p.reference.toLowerCase().trim(), p.id);
      }
    }
  }
  console.log(`Found ${purchaseMap.size} purchases with references for linking\n`);

  // Get existing count
  const { count: existingCount } = await supabase
    .from('bricklink_uploads')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  console.log(`Current uploads in database: ${existingCount ?? 0}`);
  console.log(`Processing ${rowsToProcess.length} rows...\n`);

  for (let i = 0; i < rowsToProcess.length; i++) {
    const row = rowsToProcess[i];
    const rowNum = i + 2; // +2 because of 0-indexing and header row

    // Extract values
    const dateStr = dateIdx >= 0 ? row[dateIdx] || '' : '';
    const partsStr = partsIdx >= 0 ? row[partsIdx] || '' : '';
    const valueStr = valueIdx >= 0 ? row[valueIdx] || '' : '';
    const costStr = costIdx >= 0 ? row[costIdx] || '' : '';
    const source = sourceIdx >= 0 ? row[sourceIdx] || '' : '';
    const notes = notesIdx >= 0 ? row[notesIdx] || '' : '';
    const linkedLots = linkedLotsIdx >= 0 ? row[linkedLotsIdx] || '' : '';

    // Skip empty rows
    if (!dateStr && !partsStr && !valueStr) {
      results.push({
        success: true,
        rowNumber: rowNum,
        action: 'skipped',
      });
      continue;
    }

    // Parse values
    const uploadDate = parseDate(dateStr);
    const totalQuantity = parseInteger(partsStr);
    const sellingPrice = parseNumber(valueStr);
    const cost = parseNumber(costStr);

    // Validate required fields
    if (!uploadDate) {
      results.push({
        success: false,
        rowNumber: rowNum,
        action: 'error',
        error: `Invalid or missing date: "${dateStr}"`,
      });
      continue;
    }

    if (totalQuantity === null || totalQuantity < 0) {
      results.push({
        success: false,
        rowNumber: rowNum,
        action: 'error',
        error: `Invalid parts count: "${partsStr}"`,
      });
      continue;
    }

    if (sellingPrice === null || sellingPrice < 0) {
      results.push({
        success: false,
        rowNumber: rowNum,
        action: 'error',
        error: `Invalid value: "${valueStr}"`,
      });
      continue;
    }

    // Try to find linked purchase
    let purchaseId: string | null = null;
    if (linkedLots) {
      const linkedKey = linkedLots.toLowerCase().trim();
      purchaseId = purchaseMap.get(linkedKey) || null;
    }

    // Prepare record
    const record = {
      user_id: userId,
      upload_date: uploadDate,
      total_quantity: totalQuantity,
      selling_price: sellingPrice,
      cost: cost ?? 0,
      source: source.trim() || null,
      notes: notes.trim() || null,
      purchase_id: purchaseId,
      linked_lot: linkedLots.trim() || null,
      synced_from_bricqer: false,
    };

    if (dryRun) {
      console.log(`Row ${rowNum}: Would create upload for ${uploadDate}, ${totalQuantity} parts, ${sellingPrice} value`);
      results.push({
        success: true,
        rowNumber: rowNum,
        action: 'created',
      });
    } else {
      // Insert record
      const { data, error } = await supabase
        .from('bricklink_uploads')
        .insert(record)
        .select('id')
        .single();

      if (error) {
        results.push({
          success: false,
          rowNumber: rowNum,
          action: 'error',
          error: error.message,
        });
      } else {
        results.push({
          success: true,
          rowNumber: rowNum,
          id: data.id,
          action: 'created',
        });
      }
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('MIGRATION COMPLETE');
  console.log('='.repeat(60));

  const created = results.filter((r) => r.action === 'created').length;
  const skipped = results.filter((r) => r.action === 'skipped').length;
  const errors = results.filter((r) => r.action === 'error');

  console.log(`\nResults:`);
  console.log(`  Created: ${created}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Errors: ${errors.length}`);

  if (errors.length > 0) {
    console.log('\nFirst 10 errors:');
    for (const err of errors.slice(0, 10)) {
      console.log(`  Row ${err.rowNumber}: ${err.error}`);
    }
    if (errors.length > 10) {
      console.log(`  ... and ${errors.length - 10} more errors`);
    }
  }

  // Get final count
  if (!dryRun) {
    const { count: finalCount } = await supabase
      .from('bricklink_uploads')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    console.log(`\nFinal uploads in database: ${finalCount ?? 0}`);
  }
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
