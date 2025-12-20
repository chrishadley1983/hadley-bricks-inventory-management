/**
 * Test script to verify Google Sheets connection
 * Run with: npx tsx scripts/test-sheets-connection.ts
 *
 * Option 1: Set GOOGLE_CREDENTIALS_PATH to point to your JSON key file
 * Option 2: Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in .env.local
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';

// Load environment variables from .env.local
config({ path: resolve(__dirname, '../.env.local') });

import { GoogleSheetsClient } from '../src/lib/google/sheets-client';

async function main() {
  console.log('Testing Google Sheets connection...\n');

  let serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;
  // Default to the known spreadsheet ID if not in env
  const spreadsheetId =
    process.env.GOOGLE_SHEETS_ID || '1pmfxrFF4U08gXzsZOd49z4gbmmRHDrE_S8Vb6JqCMnU';

  // Try to load from JSON file first (more reliable)
  // Look for common locations
  const possiblePaths = [
    process.env.GOOGLE_CREDENTIALS_PATH,
    resolve(__dirname, '../google-credentials.json'),
    resolve(__dirname, '../../../google-credentials.json'),
    'C:/Users/Chris Hadley/Downloads/gen-lang-client-0823893317-af39140849cd.json',
  ].filter(Boolean) as string[];

  for (const credPath of possiblePaths) {
    if (existsSync(credPath)) {
      console.log(`Loading credentials from: ${credPath}\n`);
      const credentials = JSON.parse(readFileSync(credPath, 'utf-8'));
      serviceAccountEmail = credentials.client_email;
      privateKey = credentials.private_key;
      break;
    }
  }

  // Fallback to env var if no JSON file found
  if (!privateKey && process.env.GOOGLE_PRIVATE_KEY) {
    privateKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  }

  if (!serviceAccountEmail || !privateKey) {
    console.error('❌ Missing credentials!');
    console.error('   Set GOOGLE_CREDENTIALS_PATH to your JSON key file path, or');
    console.error('   Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in .env.local');
    process.exit(1);
  }

  console.log(`Service Account: ${serviceAccountEmail}`);
  console.log(`Spreadsheet ID: ${spreadsheetId}\n`);

  const client = new GoogleSheetsClient({
    serviceAccountEmail,
    privateKey,
    spreadsheetId,
  });

  // Test connection
  console.log('1. Testing connection...');
  const connectionResult = await client.testConnection();

  if (!connectionResult.success) {
    console.error('❌ Connection failed:', connectionResult.message);
    process.exit(1);
  }

  console.log('✅ Connected to:', connectionResult.spreadsheetTitle);

  // List all sheets
  console.log('\n2. Discovering sheets...');
  const sheets = await client.listSheets();
  console.log(`   Found ${sheets.length} sheets:\n`);

  for (const sheet of sheets) {
    console.log(`   - "${sheet.title}" (${sheet.rowCount} rows, ${sheet.columnCount} columns)`);
  }

  // Get detailed structure of key inventory sheets
  console.log('\n3. Analyzing key inventory sheet structures...\n');

  const keySheets = [
    'Lego New Kit Inventory',
    'Lego Used Kit Inventory',
    'Purchases',
    'eBay Order Transactions',
    'Amazon Order Transactions',
    'Bricklink Transactions',
  ];

  for (const sheetTitle of keySheets) {
    const sheet = sheets.find((s) => s.title === sheetTitle);
    if (!sheet) {
      console.log(`   ⚠️ Sheet "${sheetTitle}" not found\n`);
      continue;
    }

    try {
      const structure = await client.getSheetStructure(sheetTitle, 3);
      console.log(`   📊 ${sheetTitle} (${structure.totalRows} rows):`);
      console.log('   ─────────────────────────────────────');

      for (const col of structure.columns) {
        if (!col.header) continue; // Skip empty headers
        const samples = col.sampleValues.filter((v) => v).slice(0, 2);
        const sampleStr = samples.length > 0 ? ` → e.g. "${samples.join('", "')}"` : '';
        console.log(`      ${col.letter}: ${col.header} (${col.inferredType})${sampleStr}`);
      }
      console.log('');
    } catch (error) {
      console.log(`   ⚠️ Could not read "${sheetTitle}": ${error}\n`);
    }
  }

  console.log('✅ Test complete!');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
