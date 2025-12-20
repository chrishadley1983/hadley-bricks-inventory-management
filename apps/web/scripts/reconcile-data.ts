/**
 * Data reconciliation script
 *
 * Compares data between Google Sheets and Supabase to identify discrepancies.
 *
 * Usage:
 *   npx tsx scripts/reconcile-data.ts [options]
 *
 * Options:
 *   --sheet=NAME    Only check specific sheet (e.g., "Lego New Kit Inventory")
 *   --limit=N       Only check first N rows
 *   --user-id=ID    User ID to check against
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';

// Load environment variables
config({ path: resolve(__dirname, '../.env.local') });

import { GoogleSheetsClient } from '../src/lib/google/sheets-client';
import { createClient } from '@supabase/supabase-js';
import {
  newKitInventoryMapping,
  usedKitInventoryMapping,
  transformRow,
  addConditionFromSheet,
} from '../src/lib/migration/sheet-mappings';

interface ReconciliationResult {
  sheetName: string;
  totalInSheet: number;
  totalInSupabase: number;
  matched: number;
  missingInSupabase: string[];
  missingInSheet: string[];
  dataMismatches: Array<{
    sku: string;
    field: string;
    sheetValue: unknown;
    supabaseValue: unknown;
  }>;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Hadley Bricks - Data Reconciliation');
  console.log('='.repeat(60));
  console.log('');

  // Parse command line arguments
  const args = process.argv.slice(2);
  const sheetArg = args.find((a) => a.startsWith('--sheet='));
  const targetSheet = sheetArg ? sheetArg.split('=')[1] : undefined;

  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;

  const userIdArg = args.find((a) => a.startsWith('--user-id='));
  let userId = userIdArg ? userIdArg.split('=')[1] : undefined;

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

  // Get user ID if not provided
  if (!userId) {
    const { data: users } = await supabase.auth.admin.listUsers();
    if (users?.users.length) {
      userId = users.users[0].id;
      console.log(`Using user: ${users.users[0].email}\n`);
    } else {
      console.log('No users found - will compare without user filter\n');
    }
  }

  // Determine which sheets to reconcile
  const sheetsToCheck = targetSheet
    ? [
        targetSheet === 'new'
          ? newKitInventoryMapping
          : targetSheet === 'used'
            ? usedKitInventoryMapping
            : { ...newKitInventoryMapping, sheetName: targetSheet },
      ]
    : [newKitInventoryMapping, usedKitInventoryMapping];

  const results: ReconciliationResult[] = [];

  for (const mapping of sheetsToCheck) {
    console.log(`\nReconciling "${mapping.sheetName}"...`);

    // Read from Google Sheets
    let sheetData = await sheetsClient.readSheet(mapping.sheetName);
    if (limit) {
      sheetData = sheetData.slice(0, limit);
    }

    // Read from Supabase - fetch all rows using pagination
    const allSupabaseData: Record<string, unknown>[] = [];
    const pageSize = 1000;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      let supabaseQuery = supabase
        .from('inventory_items')
        .select('*')
        .range(offset, offset + pageSize - 1);

      if (userId) {
        supabaseQuery = supabaseQuery.eq('user_id', userId);
      }

      // Filter by condition based on sheet
      if (mapping.sheetName.includes('New')) {
        supabaseQuery = supabaseQuery.eq('condition', 'New');
      } else if (mapping.sheetName.includes('Used')) {
        supabaseQuery = supabaseQuery.eq('condition', 'Used');
      }

      const { data: pageData, error } = await supabaseQuery;
      if (error) {
        console.error(`Error reading Supabase: ${error.message}`);
        break;
      }

      if (pageData && pageData.length > 0) {
        allSupabaseData.push(...pageData);
        offset += pageSize;
        hasMore = pageData.length === pageSize;
      } else {
        hasMore = false;
      }
    }

    const supabaseData = allSupabaseData;

    // Create lookup maps
    const sheetBySku = new Map<string, Record<string, string>>();
    for (const row of sheetData) {
      const sku = row['ID'] || row['SKU'];
      if (sku) {
        sheetBySku.set(sku, row);
      }
    }

    const supabaseBySku = new Map<string, Record<string, unknown>>();
    for (const row of supabaseData || []) {
      if (row.sku) {
        supabaseBySku.set(String(row.sku), row);
      }
    }

    // Compare
    const result: ReconciliationResult = {
      sheetName: mapping.sheetName,
      totalInSheet: sheetBySku.size,
      totalInSupabase: supabaseBySku.size,
      matched: 0,
      missingInSupabase: [],
      missingInSheet: [],
      dataMismatches: [],
    };

    // Check items in sheet
    for (const [sku, sheetRow] of sheetBySku) {
      const supabaseRow = supabaseBySku.get(sku);

      if (!supabaseRow) {
        result.missingInSupabase.push(sku);
      } else {
        result.matched++;

        // Compare key fields
        const fieldsToCompare = [
          { sheet: 'Set Number', supabase: 'set_number' },
          { sheet: 'Item', supabase: 'item_name' },
          { sheet: 'Status', supabase: 'status' },
        ];

        for (const field of fieldsToCompare) {
          const sheetValue = sheetRow[field.sheet];
          const supabaseValue = supabaseRow[field.supabase];

          if (sheetValue && supabaseValue && sheetValue !== String(supabaseValue)) {
            result.dataMismatches.push({
              sku,
              field: field.supabase,
              sheetValue,
              supabaseValue,
            });
          }
        }
      }
    }

    // Check items in Supabase not in Sheet
    for (const sku of supabaseBySku.keys()) {
      if (!sheetBySku.has(sku)) {
        result.missingInSheet.push(sku);
      }
    }

    results.push(result);

    // Print results for this sheet
    console.log(`  Total in Sheet: ${result.totalInSheet}`);
    console.log(`  Total in Supabase: ${result.totalInSupabase}`);
    console.log(`  Matched: ${result.matched}`);
    console.log(`  Missing in Supabase: ${result.missingInSupabase.length}`);
    console.log(`  Missing in Sheet: ${result.missingInSheet.length}`);
    console.log(`  Data Mismatches: ${result.dataMismatches.length}`);

    if (result.missingInSupabase.length > 0 && result.missingInSupabase.length <= 10) {
      console.log(`\n  Missing in Supabase: ${result.missingInSupabase.join(', ')}`);
    }

    if (result.missingInSheet.length > 0 && result.missingInSheet.length <= 10) {
      console.log(`\n  Missing in Sheet: ${result.missingInSheet.join(', ')}`);
    }

    if (result.dataMismatches.length > 0) {
      console.log('\n  Sample mismatches:');
      for (const mismatch of result.dataMismatches.slice(0, 5)) {
        console.log(
          `    ${mismatch.sku}.${mismatch.field}: Sheet="${mismatch.sheetValue}" vs Supabase="${mismatch.supabaseValue}"`
        );
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('RECONCILIATION SUMMARY');
  console.log('='.repeat(60));

  let totalMissingSupa = 0;
  let totalMissingSheet = 0;
  let totalMismatches = 0;

  for (const result of results) {
    totalMissingSupa += result.missingInSupabase.length;
    totalMissingSheet += result.missingInSheet.length;
    totalMismatches += result.dataMismatches.length;
  }

  if (totalMissingSupa === 0 && totalMissingSheet === 0 && totalMismatches === 0) {
    console.log('✅ All data is in sync!');
  } else {
    console.log(`⚠️ Found discrepancies:`);
    console.log(`   - ${totalMissingSupa} items in Sheet but not in Supabase`);
    console.log(`   - ${totalMissingSheet} items in Supabase but not in Sheet`);
    console.log(`   - ${totalMismatches} data mismatches`);
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
