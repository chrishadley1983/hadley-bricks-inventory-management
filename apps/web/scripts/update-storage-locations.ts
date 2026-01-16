/**
 * Update Storage Locations Script
 *
 * Reads a CSV file with inventory_id and Updated Location columns,
 * then updates the storage_location field for each inventory item.
 *
 * Usage:
 *   npx tsx scripts/update-storage-locations.ts --dry-run    # Preview changes
 *   npx tsx scripts/update-storage-locations.ts              # Execute updates
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// CSV file path - relative to repo root
const CSV_FILE = path.join(__dirname, '../../../docs/Stock update 160126.csv');

interface UpdateRow {
  inventoryId: string;
  newLocation: string;
  lineNumber: number;
}

interface ValidationResult {
  valid: UpdateRow[];
  invalid: Array<{ row: UpdateRow; reason: string }>;
  notFound: UpdateRow[];
  alreadyCorrect: UpdateRow[];
}

/**
 * Parse the CSV file
 */
function parseCSV(filePath: string): UpdateRow[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter((line) => line.trim());

  // Skip header row
  const dataLines = lines.slice(1);

  return dataLines.map((line, index) => {
    const [inventoryId, newLocation] = line.split(',').map((s) => s.trim());
    return {
      inventoryId,
      newLocation,
      lineNumber: index + 2, // +2 for 1-indexed and header row
    };
  });
}

/**
 * Validate all rows against the database
 */
async function validateRows(rows: UpdateRow[]): Promise<ValidationResult> {
  const result: ValidationResult = {
    valid: [],
    invalid: [],
    notFound: [],
    alreadyCorrect: [],
  };

  // Fetch all inventory items in batches to validate
  const ids = rows.map((r) => r.inventoryId);
  const pageSize = 100; // Keep batch size small to avoid header overflow
  const existingItems = new Map<string, { storage_location: string | null; set_number: string; item_name: string }>();

  for (let i = 0; i < ids.length; i += pageSize) {
    const batch = ids.slice(i, i + pageSize);
    console.log(`  Fetching batch ${Math.floor(i / pageSize) + 1} of ${Math.ceil(ids.length / pageSize)}...`);
    const { data, error } = await supabase
      .from('inventory_items')
      .select('id, storage_location, set_number, item_name')
      .in('id', batch);

    if (error) {
      console.error('Error fetching inventory items:', error);
      process.exit(1);
    }

    for (const item of data || []) {
      existingItems.set(item.id, {
        storage_location: item.storage_location,
        set_number: item.set_number,
        item_name: item.item_name,
      });
    }
  }

  // Validate each row
  for (const row of rows) {
    // Check for empty/invalid inventory ID
    if (!row.inventoryId || row.inventoryId.length < 10) {
      result.invalid.push({ row, reason: 'Invalid inventory ID format' });
      continue;
    }

    // Check for empty location
    if (!row.newLocation) {
      result.invalid.push({ row, reason: 'Empty location value' });
      continue;
    }

    // Check if item exists
    const existing = existingItems.get(row.inventoryId);
    if (!existing) {
      result.notFound.push(row);
      continue;
    }

    // Check if location already matches
    if (existing.storage_location === row.newLocation) {
      result.alreadyCorrect.push(row);
      continue;
    }

    result.valid.push(row);
  }

  return result;
}

/**
 * Execute the updates
 */
async function executeUpdates(rows: UpdateRow[]): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  // Process in batches
  const batchSize = 50;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    for (const row of batch) {
      const { error } = await supabase
        .from('inventory_items')
        .update({ storage_location: row.newLocation })
        .eq('id', row.inventoryId);

      if (error) {
        console.error(`  Failed to update ${row.inventoryId}: ${error.message}`);
        failed++;
      } else {
        success++;
      }
    }

    // Progress update
    console.log(`  Processed ${Math.min(i + batchSize, rows.length)} of ${rows.length}...`);
  }

  return { success, failed };
}

/**
 * Main function
 */
async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  console.log('='.repeat(60));
  console.log('Storage Location Update Script');
  console.log('='.repeat(60));
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes will be made)' : 'LIVE (changes will be applied)'}`);
  console.log(`CSV File: ${CSV_FILE}`);
  console.log('');

  // Check file exists
  if (!fs.existsSync(CSV_FILE)) {
    console.error(`ERROR: File not found: ${CSV_FILE}`);
    process.exit(1);
  }

  // Parse CSV
  console.log('Parsing CSV file...');
  const rows = parseCSV(CSV_FILE);
  console.log(`  Found ${rows.length} rows to process`);
  console.log('');

  // Validate
  console.log('Validating against database...');
  const validation = await validateRows(rows);
  console.log('');

  // Summary
  console.log('='.repeat(60));
  console.log('VALIDATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`  Valid updates:      ${validation.valid.length}`);
  console.log(`  Already correct:    ${validation.alreadyCorrect.length}`);
  console.log(`  Not found:          ${validation.notFound.length}`);
  console.log(`  Invalid rows:       ${validation.invalid.length}`);
  console.log('');

  // Show details for issues
  if (validation.notFound.length > 0) {
    console.log('NOT FOUND (inventory IDs not in database):');
    for (const row of validation.notFound.slice(0, 10)) {
      console.log(`  Line ${row.lineNumber}: ${row.inventoryId} -> ${row.newLocation}`);
    }
    if (validation.notFound.length > 10) {
      console.log(`  ... and ${validation.notFound.length - 10} more`);
    }
    console.log('');
  }

  if (validation.invalid.length > 0) {
    console.log('INVALID ROWS:');
    for (const { row, reason } of validation.invalid.slice(0, 10)) {
      console.log(`  Line ${row.lineNumber}: ${reason} (ID: ${row.inventoryId})`);
    }
    if (validation.invalid.length > 10) {
      console.log(`  ... and ${validation.invalid.length - 10} more`);
    }
    console.log('');
  }

  // Show sample of valid updates
  if (validation.valid.length > 0) {
    console.log('SAMPLE OF VALID UPDATES (first 10):');
    for (const row of validation.valid.slice(0, 10)) {
      console.log(`  ${row.inventoryId} -> "${row.newLocation}"`);
    }
    if (validation.valid.length > 10) {
      console.log(`  ... and ${validation.valid.length - 10} more`);
    }
    console.log('');
  }

  // Execute or exit
  if (isDryRun) {
    console.log('='.repeat(60));
    console.log('DRY RUN COMPLETE - No changes made');
    console.log('='.repeat(60));
    console.log('');
    console.log('To apply these changes, run without --dry-run:');
    console.log('  npx tsx scripts/update-storage-locations.ts');
    return;
  }

  // Confirm before executing
  if (validation.valid.length === 0) {
    console.log('No valid updates to apply.');
    return;
  }

  console.log('='.repeat(60));
  console.log('EXECUTING UPDATES');
  console.log('='.repeat(60));
  console.log(`Updating ${validation.valid.length} inventory items...`);

  const result = await executeUpdates(validation.valid);

  console.log('');
  console.log('='.repeat(60));
  console.log('EXECUTION COMPLETE');
  console.log('='.repeat(60));
  console.log(`  Successful: ${result.success}`);
  console.log(`  Failed:     ${result.failed}`);
}

main().catch(console.error);
