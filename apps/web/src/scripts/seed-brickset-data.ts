#!/usr/bin/env npx tsx

/**
 * Seed Brickset Data from Google Sheets
 *
 * This script imports existing Brickset data from the "Brickset Data" tab
 * in Google Sheets into the Supabase brickset_sets table.
 *
 * Usage: npx tsx apps/web/src/scripts/seed-brickset-data.ts
 *
 * Or via npm script: npm run seed:brickset
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables from apps/web/.env.local
config({ path: resolve(__dirname, '../../.env.local') });

import { createClient } from '@supabase/supabase-js';
import { GoogleSheetsClient } from '../lib/google/sheets-client';

const SHEET_NAME = 'Brickset Data';
const BATCH_SIZE = 100;

// Map Google Sheets column headers to database columns
// Adjust these mappings based on your actual sheet column names
const COLUMN_MAPPINGS: Record<string, string> = {
  // Common variations - adjust based on your actual sheet headers
  'Number': 'set_number',
  'SetNumber': 'set_number',
  'Set Number': 'set_number',
  'Variant': 'variant',
  'NumberVariant': 'variant',
  'Year': 'year_from',
  'YearFrom': 'year_from',
  'Year From': 'year_from',
  'Category': 'category',
  'Theme': 'theme',
  'ThemeGroup': 'theme_group',
  'Theme Group': 'theme_group',
  'Subtheme': 'subtheme',
  'Name': 'set_name',
  'SetName': 'set_name',
  'Set Name': 'set_name',
  'Image': 'image_url',
  'ImageURL': 'image_url',
  'Image URL': 'image_url',
  'ImageFilename': 'image_filename',
  'Image Filename': 'image_filename',
  'USRetailPrice': 'us_retail_price',
  'US Retail Price': 'us_retail_price',
  'UKRetailPrice': 'uk_retail_price',
  'UK Retail Price': 'uk_retail_price',
  'CARetailPrice': 'ca_retail_price',
  'CA Retail Price': 'ca_retail_price',
  'DERetailPrice': 'de_retail_price',
  'DE Retail Price': 'de_retail_price',
  'USDateAdded': 'us_date_added',
  'US Date Added': 'us_date_added',
  'USDateRemoved': 'us_date_removed',
  'US Date Removed': 'us_date_removed',
  'Pieces': 'pieces',
  'Minifigs': 'minifigs',
  'PackagingType': 'packaging_type',
  'Packaging Type': 'packaging_type',
  'Availability': 'availability',
  'USItemNumber': 'us_item_number',
  'US Item Number': 'us_item_number',
  'EUItemNumber': 'eu_item_number',
  'EU Item Number': 'eu_item_number',
  'EAN': 'ean',
  'UPC': 'upc',
  'Width': 'width',
  'Height': 'height',
  'Depth': 'depth',
  'Weight': 'weight',
  'AgeMin': 'age_min',
  'Age Min': 'age_min',
  'AgeMax': 'age_max',
  'Age Max': 'age_max',
  'OwnCount': 'own_count',
  'Own Count': 'own_count',
  'WantCount': 'want_count',
  'Want Count': 'want_count',
  'InstructionsCount': 'instructions_count',
  'Instructions Count': 'instructions_count',
  'AdditionalImageCount': 'additional_image_count',
  'Additional Image Count': 'additional_image_count',
  'Released': 'released',
  'Rating': 'rating',
  'BrickLinkSoldPriceNew': 'bricklink_sold_price_new',
  'BrickLink Sold Price New': 'bricklink_sold_price_new',
  'BrickLinkSoldPriceUsed': 'bricklink_sold_price_used',
  'BrickLink Sold Price Used': 'bricklink_sold_price_used',
  'Designers': 'designers',
  'LaunchDate': 'launch_date',
  'Launch Date': 'launch_date',
  'ExitDate': 'exit_date',
  'Exit Date': 'exit_date',
  'SetID': 'brickset_id',
  'BricksetID': 'brickset_id',
  'Brickset ID': 'brickset_id',
};

// Maximum values for INTEGER columns (PostgreSQL INTEGER is 4 bytes, max 2,147,483,647)
const MAX_INTEGER = 2147483647;

// Columns that can have very large values and need capping
const LARGE_INTEGER_COLUMNS = ['own_count', 'want_count', 'brickset_id'];

// Maximum values for DECIMAL columns based on schema
const DECIMAL_LIMITS: Record<string, number> = {
  // DECIMAL(10,2) columns - max 99999999.99
  us_retail_price: 99999999.99,
  uk_retail_price: 99999999.99,
  ca_retail_price: 99999999.99,
  de_retail_price: 99999999.99,
  bricklink_sold_price_new: 99999999.99,
  bricklink_sold_price_used: 99999999.99,
  // DECIMAL(8,2) columns - max 999999.99
  width: 999999.99,
  height: 999999.99,
  depth: 999999.99,
  weight: 999999.99,
  // DECIMAL(3,1) columns - max 99.9
  rating: 99.9,
};

function parseValue(value: string, column: string): unknown {
  if (!value || value.trim() === '' || value === '-' || value === 'N/A') {
    return null;
  }

  // Numeric columns
  const numericColumns = [
    'variant', 'year_from', 'pieces', 'minifigs',
    'us_retail_price', 'uk_retail_price', 'ca_retail_price', 'de_retail_price',
    'width', 'height', 'depth', 'weight',
    'age_min', 'age_max', 'own_count', 'want_count',
    'instructions_count', 'additional_image_count',
    'rating', 'bricklink_sold_price_new', 'bricklink_sold_price_used',
    'brickset_id',
  ];

  if (numericColumns.includes(column)) {
    // Remove currency symbols and commas
    const cleaned = value.replace(/[£$€,]/g, '').trim();
    const num = parseFloat(cleaned);
    if (isNaN(num)) return null;

    // Cap large integer values to prevent overflow
    if (LARGE_INTEGER_COLUMNS.includes(column) && num > MAX_INTEGER) {
      return MAX_INTEGER;
    }

    // Cap decimal values to prevent overflow
    const decimalLimit = DECIMAL_LIMITS[column];
    if (decimalLimit !== undefined && num > decimalLimit) {
      return decimalLimit;
    }

    return num;
  }

  // Boolean columns
  if (column === 'released') {
    const lower = value.toLowerCase().trim();
    return lower === 'true' || lower === 'yes' || lower === '1';
  }

  // Date columns
  const dateColumns = ['us_date_added', 'us_date_removed', 'launch_date', 'exit_date'];
  if (dateColumns.includes(column)) {
    // Try to parse the date
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0]; // Return YYYY-MM-DD format
    }
    return null;
  }

  // Array columns (designers)
  if (column === 'designers') {
    // Assume comma-separated list
    const designers = value.split(',').map(d => d.trim()).filter(d => d);
    return designers.length > 0 ? designers : null;
  }

  // String columns
  return value.trim();
}

function mapRowToDbRecord(
  row: Record<string, string>,
  headerMappings: Map<string, string>
): Record<string, unknown> | null {
  const record: Record<string, unknown> = {};

  for (const [header, value] of Object.entries(row)) {
    const dbColumn = headerMappings.get(header);
    if (dbColumn) {
      record[dbColumn] = parseValue(value, dbColumn);
    }
  }

  // Ensure set_number exists and set_name has a value
  if (!record.set_number) {
    return null;
  }

  // If no set_name, use set_number
  if (!record.set_name) {
    record.set_name = record.set_number;
  }

  // Build the full set_number with variant suffix
  const baseNumber = String(record.set_number);
  const variant = record.variant ? Number(record.variant) : 1;

  // If set_number already has variant suffix (e.g., "75192-1"), keep it as-is
  // Otherwise, append the variant from the variant column
  if (!baseNumber.includes('-')) {
    record.set_number = `${baseNumber}-${variant}`;
  }

  // Set default values
  record.variant = variant;
  record.released = record.released ?? false;

  // Set last_fetched_at to 6 months ago (since this is old data)
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  record.last_fetched_at = sixMonthsAgo.toISOString();

  return record;
}

async function seedBricksetData() {
  console.log('='.repeat(60));
  console.log('Brickset Data Seed Script');
  console.log('='.repeat(60));
  console.log();

  // Validate environment
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Error: Missing Supabase environment variables');
    console.error('Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    console.error('Error: Missing Google Sheets environment variables');
    console.error('Required: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY');
    process.exit(1);
  }

  // Initialize clients
  console.log('Initializing clients...');

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const sheets = new GoogleSheetsClient();

  // Test connections
  console.log('Testing Google Sheets connection...');
  const sheetsTest = await sheets.testConnection();
  if (!sheetsTest.success) {
    console.error('Failed to connect to Google Sheets:', sheetsTest.message);
    process.exit(1);
  }
  console.log(`Connected to spreadsheet: ${sheetsTest.spreadsheetTitle}`);

  // Read data from sheet
  console.log();
  console.log(`Reading data from "${SHEET_NAME}" sheet...`);

  let rows: Record<string, string>[];
  try {
    rows = await sheets.readSheet(SHEET_NAME);
  } catch (error) {
    console.error(`Error reading sheet "${SHEET_NAME}":`, error);
    console.error('Make sure the sheet exists and the service account has access.');
    process.exit(1);
  }

  console.log(`Found ${rows.length} rows`);

  if (rows.length === 0) {
    console.log('No data to import. Exiting.');
    process.exit(0);
  }

  // Build header mappings
  const firstRow = rows[0];
  const headers = Object.keys(firstRow);
  console.log();
  console.log('Detected columns:', headers.join(', '));

  const headerMappings = new Map<string, string>();
  const unmappedHeaders: string[] = [];

  for (const header of headers) {
    const dbColumn = COLUMN_MAPPINGS[header];
    if (dbColumn) {
      headerMappings.set(header, dbColumn);
    } else {
      unmappedHeaders.push(header);
    }
  }

  console.log();
  console.log('Mapped columns:');
  for (const [header, dbColumn] of headerMappings) {
    console.log(`  ${header} -> ${dbColumn}`);
  }

  if (unmappedHeaders.length > 0) {
    console.log();
    console.log('Unmapped columns (will be ignored):');
    console.log(`  ${unmappedHeaders.join(', ')}`);
  }

  // Convert rows to database records
  console.log();
  console.log('Converting rows to database records...');

  const records: Record<string, unknown>[] = [];
  let skipped = 0;

  for (const row of rows) {
    const record = mapRowToDbRecord(row, headerMappings);
    if (record) {
      records.push(record);
    } else {
      skipped++;
    }
  }

  console.log(`Converted ${records.length} records (${skipped} skipped due to missing set number)`);

  if (records.length === 0) {
    console.log('No valid records to import. Exiting.');
    process.exit(0);
  }

  // Deduplicate by set_number (the database unique constraint)
  // The set_number already includes the variant suffix (e.g., "75192-1", "75192-2")
  // so different variants will have different keys and both will be kept
  console.log();
  console.log('Deduplicating records by set_number (includes variant)...');
  const recordMap = new Map<string, Record<string, unknown>>();
  let duplicateCount = 0;
  for (const record of records) {
    const setNumber = String(record.set_number);
    if (recordMap.has(setNumber)) {
      duplicateCount++;
      // Log first few duplicates for debugging
      if (duplicateCount <= 5) {
        console.log(`  Duplicate found: ${setNumber} (keeping latest)`);
      }
    }
    recordMap.set(setNumber, record);
  }
  const uniqueRecords = Array.from(recordMap.values());
  const duplicatesRemoved = records.length - uniqueRecords.length;
  if (duplicateCount > 5) {
    console.log(`  ... and ${duplicateCount - 5} more duplicates`);
  }
  console.log(`Deduplicated: ${uniqueRecords.length} unique records (${duplicatesRemoved} duplicates removed)`);

  // Insert in batches
  console.log();
  console.log(`Inserting records in batches of ${BATCH_SIZE}...`);

  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < uniqueRecords.length; i += BATCH_SIZE) {
    const batch = uniqueRecords.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(uniqueRecords.length / BATCH_SIZE);

    process.stdout.write(`  Batch ${batchNum}/${totalBatches}... `);

    const { error } = await supabase
      .from('brickset_sets')
      .upsert(batch, { onConflict: 'set_number', ignoreDuplicates: false });

    if (error) {
      console.log(`ERROR: ${error.message}`);
      errors += batch.length;
    } else {
      console.log(`OK (${batch.length} records)`);
      inserted += batch.length;
    }
  }

  // Summary
  console.log();
  console.log('='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log(`Total rows in sheet: ${rows.length}`);
  console.log(`Records converted: ${records.length}`);
  console.log(`Duplicates removed: ${duplicatesRemoved}`);
  console.log(`Unique records: ${uniqueRecords.length}`);
  console.log(`Records inserted/updated: ${inserted}`);
  console.log(`Records with errors: ${errors}`);
  console.log();

  if (errors > 0) {
    console.log('Some records failed to import. Check the errors above.');
    process.exit(1);
  }

  console.log('Seed completed successfully!');
}

// Run the script
seedBricksetData().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
