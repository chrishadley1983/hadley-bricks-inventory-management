/**
 * Migration script for importing inventory from Google Sheets to Supabase
 *
 * Usage:
 *   npx tsx scripts/migrate-inventory.ts [options]
 *
 * Options:
 *   --dry-run       Preview changes without writing to database
 *   --limit=N       Only process first N rows
 *   --update        Update existing records instead of skipping
 *   --user-id=ID    User ID to assign records to (required)
 *
 * Examples:
 *   npx tsx scripts/migrate-inventory.ts --dry-run --limit=10
 *   npx tsx scripts/migrate-inventory.ts --user-id=abc123
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';

// Load environment variables
config({ path: resolve(__dirname, '../.env.local') });

import { GoogleSheetsClient } from '../src/lib/google/sheets-client';
import { createMigrationService } from '../src/lib/migration';

async function main() {
  console.log('='.repeat(60));
  console.log('Hadley Bricks - Inventory Migration');
  console.log('='.repeat(60));
  console.log('');

  // Parse command line arguments
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const updateExisting = args.includes('--update');

  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;

  const userIdArg = args.find((a) => a.startsWith('--user-id='));
  let userId = userIdArg ? userIdArg.split('=')[1] : undefined;

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  if (limit) {
    console.log(`📊 Processing limited to ${limit} rows per sheet\n`);
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

  // Create clients
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

  // If no user ID provided, try to get first user from Supabase
  if (!userId) {
    console.log('No user ID provided. Fetching first user from Supabase...');
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

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

  // Create migration service
  const migrationService = createMigrationService(sheetsClient);

  // Get current stats
  console.log('Current database stats:');
  const statsBefore = await migrationService.getMigrationStats(userId);
  console.log(`  Inventory: ${statsBefore.inventory.total} items`);
  console.log(`    - New: ${statsBefore.inventory.new}`);
  console.log(`    - Used: ${statsBefore.inventory.used}`);
  console.log(`  Purchases: ${statsBefore.purchases.total}\n`);

  // Run migration
  console.log('Starting inventory migration...\n');
  const result = await migrationService.migrateInventory({
    dryRun,
    limit,
    userId,
    updateExisting,
  });

  // Print results
  console.log('\n' + '='.repeat(60));
  console.log('MIGRATION COMPLETE');
  console.log('='.repeat(60));
  console.log(`Duration: ${result.duration}ms`);
  console.log(`Total Success: ${result.totalSuccess}`);
  console.log(`Total Errors: ${result.totalErrors}`);
  console.log(`Total Skipped: ${result.totalSkipped}`);

  for (const sheet of result.sheets) {
    console.log(`\n📊 ${sheet.sheetName}:`);
    console.log(`   Rows processed: ${sheet.totalRows}`);
    console.log(`   Created: ${sheet.rows.filter((r) => r.action === 'created').length}`);
    console.log(`   Updated: ${sheet.rows.filter((r) => r.action === 'updated').length}`);
    console.log(`   Skipped: ${sheet.skippedCount}`);
    console.log(`   Errors: ${sheet.errorCount}`);

    // Show first 5 errors if any
    const errors = sheet.rows.filter((r) => !r.success);
    if (errors.length > 0) {
      console.log('\n   First errors:');
      for (const error of errors.slice(0, 5)) {
        console.log(`     Row ${error.rowNumber} (${error.sheetId}): ${error.error}`);
      }
      if (errors.length > 5) {
        console.log(`     ... and ${errors.length - 5} more errors`);
      }
    }
  }

  // Get stats after migration
  if (!dryRun) {
    console.log('\n\nDatabase stats after migration:');
    const statsAfter = await migrationService.getMigrationStats(userId);
    console.log(`  Inventory: ${statsAfter.inventory.total} items`);
    console.log(`    - New: ${statsAfter.inventory.new}`);
    console.log(`    - Used: ${statsAfter.inventory.used}`);
    console.log(`  Purchases: ${statsAfter.purchases.total}`);
  }
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
