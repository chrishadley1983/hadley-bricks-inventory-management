/**
 * Script to explore Monzo Transactions sheet structure
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getSheetsClient } from '../src/lib/google/sheets-client';

async function main() {
  try {
    const client = getSheetsClient();

    // List all sheets to find Monzo
    console.log('Fetching sheet list...');
    const sheets = await client.listSheets();
    console.log('=== All Sheets ===');
    sheets.forEach(s => console.log('-', s.title));

    // Find Monzo sheet
    const monzoSheet = sheets.find(s => s.title.toLowerCase().includes('monzo'));

    if (!monzoSheet) {
      console.log('\nNo Monzo sheet found!');
      return;
    }

    console.log('\n=== Monzo Sheet Structure ===');
    const structure = await client.getSheetStructure(monzoSheet.title, 5);
    console.log('Sheet:', structure.sheetInfo.title);
    console.log('Total Rows:', structure.totalRows);
    console.log('\nColumns:');
    structure.columns.forEach(col => {
      console.log(`  ${col.letter}: "${col.header}" (${col.inferredType})`);
      if (col.sampleValues.length > 0) {
        console.log(`     Samples: ${col.sampleValues.slice(0, 3).join(' | ')}`);
      }
    });

    // Get some sample data
    console.log('\n=== Sample Data (first 3 rows) ===');
    const data = await client.readSheet(monzoSheet.title);
    data.slice(0, 3).forEach((row, i) => {
      console.log(`\nRow ${i + 1}:`);
      Object.entries(row).forEach(([key, value]) => {
        if (value) {
          console.log(`  ${key}: ${value}`);
        }
      });
    });

    console.log(`\n=== Total records: ${data.length} ===`);

  } catch (error) {
    console.error('Error:', error);
  }
}

main();
