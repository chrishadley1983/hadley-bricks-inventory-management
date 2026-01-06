/**
 * Petrol Tracker Migration Script
 *
 * Migrates data from the "Petrol Tracker" Google Sheet to the mileage_tracking table.
 *
 * Sheet Structure:
 * - Column A: Date (DD/MM/YYYY format)
 * - Column B: Miles travelled (number or "NA" for non-mileage costs)
 * - Column C: Amount to claim (e.g., £29.70)
 * - Column D: Reason for travel (e.g., "Collecting 302 (40) from Tenterden")
 *
 * Parsing Logic:
 * - Extract purchase reference from reason: "Collecting 302 (40) from Tenterden" → "302"
 * - Handle "NA" miles as 0 (for parking, tolls, etc.)
 * - Detect expense type from reason (Congestion Charge, Toll, Parking → non-mileage)
 * - Link to purchase by matching reference to purchases table (sheets_id or reference)
 *
 * Usage:
 *   npx tsx scripts/migrate-petrol-tracker.ts
 *   npx tsx scripts/migrate-petrol-tracker.ts --dry-run
 */

import { createClient } from '@supabase/supabase-js';
import { getSheetsClient } from '../src/lib/google/sheets-client';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const SHEET_NAME = 'Petrol Tracker';

// Regex to extract purchase reference from reason text
// Matches: "Collecting 302 (40) from...", "Collecting U408 from...", "Collecting #333 from..."
const COLLECTING_PATTERN = /^Collecting\s+#?([A-Z]?\d+)/i;

// Keywords that indicate non-mileage expenses
const TOLL_KEYWORDS = ['congestion charge', 'toll', 'ulez', 'lez', 'dartford'];
const PARKING_KEYWORDS = ['parking', 'car park'];

interface PetrolTrackerRow {
  date: string; // DD/MM/YYYY
  miles: string; // number or "NA"
  amount: string; // e.g., "£29.70"
  reason: string;
}

interface MigrationResult {
  total: number;
  matched: number;
  unmatched: number;
  skipped: number;
  errors: string[];
  entries: Array<{
    date: string;
    miles: number;
    amount: number;
    reason: string;
    expenseType: string;
    purchaseId: string | null;
    purchaseRef: string | null;
    status: 'matched' | 'unmatched' | 'skipped' | 'error';
  }>;
}

/**
 * Parse date from DD/MM/YYYY to YYYY-MM-DD
 */
function parseDate(dateStr: string): string | null {
  const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return null;

  const [, day, month, year] = match;
  const fullYear = year.length === 2 ? `20${year}` : year;
  return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * Parse amount from string (e.g., "£29.70" → 29.70)
 */
function parseAmount(amountStr: string): number {
  const cleaned = amountStr.replace(/[£$,\s]/g, '');
  const amount = parseFloat(cleaned);
  return isNaN(amount) ? 0 : amount;
}

/**
 * Parse miles from string (handles "NA" as 0)
 */
function parseMiles(milesStr: string): number {
  const cleaned = milesStr.trim().toUpperCase();
  if (cleaned === 'NA' || cleaned === 'N/A' || cleaned === '-') {
    return 0;
  }
  const miles = parseFloat(milesStr.replace(/[,\s]/g, ''));
  return isNaN(miles) ? 0 : miles;
}

/**
 * Extract purchase reference from reason text
 */
function extractPurchaseRef(reason: string): string | null {
  const match = reason.match(COLLECTING_PATTERN);
  return match ? match[1] : null;
}

/**
 * Determine expense type from miles and reason
 */
function determineExpenseType(miles: number, reason: string): 'mileage' | 'parking' | 'toll' | 'other' {
  const lowerReason = reason.toLowerCase();

  if (TOLL_KEYWORDS.some((keyword) => lowerReason.includes(keyword))) {
    return 'toll';
  }

  if (PARKING_KEYWORDS.some((keyword) => lowerReason.includes(keyword))) {
    return 'parking';
  }

  // If miles is 0 and no specific keyword, it's probably parking or other
  if (miles === 0) {
    return 'other';
  }

  return 'mileage';
}

/**
 * Main migration function
 */
async function migratePetrolTracker(dryRun: boolean = false): Promise<MigrationResult> {
  console.log('Starting Petrol Tracker migration...');
  console.log(dryRun ? '*** DRY RUN - No data will be written ***' : '*** LIVE RUN ***');
  console.log('');

  const result: MigrationResult = {
    total: 0,
    matched: 0,
    unmatched: 0,
    skipped: 0,
    errors: [],
    entries: [],
  };

  // Get Supabase client using service role key (for scripts)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      'Missing Supabase credentials. Please set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local'
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Get the user ID from profiles (we'll use the first user since this is a single-user system)
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id')
    .limit(1);

  if (profilesError || !profiles || profiles.length === 0) {
    throw new Error('No user profile found. Please ensure you have a user account.');
  }

  const userId = profiles[0].id;
  console.log(`Using user ID: ${userId}`);

  // Read from Google Sheets
  const sheetsClient = getSheetsClient();
  console.log(`Reading sheet: ${SHEET_NAME}`);

  let rows: Record<string, string>[];
  try {
    rows = await sheetsClient.readSheet(SHEET_NAME);
  } catch (error) {
    throw new Error(`Failed to read sheet "${SHEET_NAME}": ${error}`);
  }

  console.log(`Found ${rows.length} rows in sheet`);
  result.total = rows.length;

  // Fetch all purchases to build a lookup map
  console.log('Fetching purchases for reference matching...');
  const { data: purchases, error: purchasesError } = await supabase
    .from('purchases')
    .select('id, short_description, reference, sheets_id')
    .eq('user_id', userId);

  if (purchasesError) {
    throw new Error(`Failed to fetch purchases: ${purchasesError.message}`);
  }

  // Build lookup maps for purchase matching
  const purchaseByRef = new Map<string, string>(); // reference → id
  const purchaseBySheetsId = new Map<string, string>(); // sheets_id → id
  const purchaseByDescription = new Map<string, string>(); // short_description → id

  for (const purchase of purchases || []) {
    if (purchase.reference) {
      purchaseByRef.set(purchase.reference.toLowerCase(), purchase.id);
    }
    if (purchase.sheets_id) {
      purchaseBySheetsId.set(purchase.sheets_id.toString(), purchase.id);
    }
    if (purchase.short_description) {
      purchaseByDescription.set(purchase.short_description.toLowerCase(), purchase.id);
    }
  }

  console.log(`Loaded ${purchases?.length || 0} purchases for matching`);
  console.log('');

  // Process each row
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // +1 for 0-index, +1 for header row

    // Extract values based on headers
    const dateStr = row['Date'] || '';
    const milesStr = row['Miles travelled'] || '';
    const amountStr = row['Amount to claim'] || '';
    const reason = row['Reason for travel'] || '';

    // Parse values
    const trackingDate = parseDate(dateStr);
    const miles = parseMiles(milesStr);
    const amount = parseAmount(amountStr);

    // Skip empty or invalid rows
    if (!trackingDate || (!miles && !amount) || !reason) {
      console.log(`Row ${rowNum}: Skipped (invalid/empty data)`);
      result.skipped++;
      result.entries.push({
        date: dateStr,
        miles,
        amount,
        reason,
        expenseType: 'mileage',
        purchaseId: null,
        purchaseRef: null,
        status: 'skipped',
      });
      continue;
    }

    // Determine expense type
    const expenseType = determineExpenseType(miles, reason);

    // Try to match purchase
    const purchaseRef = extractPurchaseRef(reason);
    let purchaseId: string | null = null;

    if (purchaseRef) {
      // Try different lookup strategies
      purchaseId =
        purchaseBySheetsId.get(purchaseRef) ||
        purchaseByRef.get(purchaseRef.toLowerCase()) ||
        null;

      // If still not found, try partial matching on description
      if (!purchaseId) {
        for (const [desc, id] of purchaseByDescription.entries()) {
          if (desc.includes(purchaseRef.toLowerCase())) {
            purchaseId = id;
            break;
          }
        }
      }
    }

    const status = purchaseId ? 'matched' : purchaseRef ? 'unmatched' : 'matched'; // No ref needed = OK

    if (purchaseId) {
      result.matched++;
    } else if (purchaseRef) {
      result.unmatched++;
    } else {
      result.matched++; // No reference needed
    }

    console.log(
      `Row ${rowNum}: ${trackingDate} | ${miles} miles | £${amount.toFixed(2)} | ${expenseType} | ` +
        `Ref: ${purchaseRef || 'N/A'} | ${purchaseId ? '✓ Matched' : purchaseRef ? '✗ Unmatched' : '- No ref'}`
    );

    result.entries.push({
      date: trackingDate,
      miles,
      amount,
      reason,
      expenseType,
      purchaseId,
      purchaseRef,
      status,
    });

    // Insert into database if not dry run
    if (!dryRun) {
      const { error: insertError } = await supabase.from('mileage_tracking').insert({
        user_id: userId,
        purchase_id: purchaseId,
        tracking_date: trackingDate,
        destination_postcode: 'IMPORTED', // Placeholder - original sheet didn't have postcodes
        miles_travelled: miles,
        amount_claimed: amount,
        reason,
        expense_type: expenseType,
        notes: `Imported from Petrol Tracker sheet (Row ${rowNum})`,
      });

      if (insertError) {
        console.error(`Row ${rowNum}: Insert error - ${insertError.message}`);
        result.errors.push(`Row ${rowNum}: ${insertError.message}`);
      }
    }
  }

  return result;
}

/**
 * Print migration summary
 */
function printSummary(result: MigrationResult): void {
  console.log('');
  console.log('='.repeat(60));
  console.log('Migration Summary');
  console.log('='.repeat(60));
  console.log(`Total rows:     ${result.total}`);
  console.log(`Matched:        ${result.matched}`);
  console.log(`Unmatched:      ${result.unmatched}`);
  console.log(`Skipped:        ${result.skipped}`);
  console.log(`Errors:         ${result.errors.length}`);
  console.log('');

  if (result.unmatched > 0) {
    console.log('Unmatched entries (no purchase found):');
    result.entries
      .filter((e) => e.status === 'unmatched')
      .forEach((e) => {
        console.log(`  - ${e.date} | Ref: ${e.purchaseRef} | ${e.reason.substring(0, 50)}...`);
      });
    console.log('');
  }

  if (result.errors.length > 0) {
    console.log('Errors:');
    result.errors.forEach((e) => console.log(`  - ${e}`));
    console.log('');
  }
}

// Main execution
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('-n');

migratePetrolTracker(dryRun)
  .then((result) => {
    printSummary(result);
    process.exit(result.errors.length > 0 ? 1 : 0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
