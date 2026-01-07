/**
 * Migration Script: Encrypt Existing Credentials
 *
 * This script encrypts existing plaintext PayPal and Monzo credentials
 * that were stored before encryption was implemented.
 *
 * Usage:
 *   npx tsx apps/web/scripts/migrate-encrypt-credentials.ts
 *
 * Requirements:
 *   - CREDENTIALS_ENCRYPTION_KEY must be set in environment
 *   - SUPABASE_SERVICE_ROLE_KEY must be set for admin access
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables from .env.local
config({ path: resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import { encrypt } from '../src/lib/crypto';

// Validate environment
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const encryptionKey = process.env.CREDENTIALS_ENCRYPTION_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!encryptionKey) {
  console.error('❌ Missing CREDENTIALS_ENCRYPTION_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Check if a string looks like it's already encrypted (base64 with expected length)
 */
function looksEncrypted(value: string): boolean {
  // Encrypted values are base64 and include salt (16) + iv (16) + authTag (16) + ciphertext
  // Minimum length would be around 60+ characters for even short secrets
  // Also, encrypted values won't contain common credential patterns
  if (value.length < 50) return false;

  // Check if it's valid base64
  try {
    const decoded = Buffer.from(value, 'base64');
    // If it decodes to roughly the expected size ratio, it's probably encrypted
    return decoded.length >= 48; // 16 + 16 + 16 minimum
  } catch {
    return false;
  }
}

async function migratePayPalCredentials(): Promise<{ migrated: number; skipped: number; errors: number }> {
  console.log('\n📦 Migrating PayPal credentials...');

  const { data: credentials, error } = await supabase
    .from('paypal_credentials')
    .select('id, user_id, client_secret, access_token');

  if (error) {
    console.error('❌ Failed to fetch PayPal credentials:', error.message);
    return { migrated: 0, skipped: 0, errors: 1 };
  }

  if (!credentials || credentials.length === 0) {
    console.log('  No PayPal credentials found');
    return { migrated: 0, skipped: 0, errors: 0 };
  }

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const cred of credentials) {
    try {
      const updates: Record<string, string> = {};

      // Check and encrypt client_secret
      if (cred.client_secret && !looksEncrypted(cred.client_secret)) {
        updates.client_secret = await encrypt(cred.client_secret);
        console.log(`  🔐 Encrypting client_secret for user ${cred.user_id.slice(0, 8)}...`);
      }

      // Check and encrypt access_token
      if (cred.access_token && !looksEncrypted(cred.access_token)) {
        updates.access_token = await encrypt(cred.access_token);
        console.log(`  🔐 Encrypting access_token for user ${cred.user_id.slice(0, 8)}...`);
      }

      if (Object.keys(updates).length > 0) {
        const { error: updateError } = await supabase
          .from('paypal_credentials')
          .update(updates)
          .eq('id', cred.id);

        if (updateError) {
          console.error(`  ❌ Failed to update credentials for ${cred.user_id.slice(0, 8)}:`, updateError.message);
          errors++;
        } else {
          migrated++;
        }
      } else {
        console.log(`  ⏭️  Skipping user ${cred.user_id.slice(0, 8)} (already encrypted)`);
        skipped++;
      }
    } catch (err) {
      console.error(`  ❌ Error processing credentials for ${cred.user_id.slice(0, 8)}:`, err);
      errors++;
    }
  }

  return { migrated, skipped, errors };
}

async function migrateMonzoCredentials(): Promise<{ migrated: number; skipped: number; errors: number }> {
  console.log('\n📦 Migrating Monzo credentials...');

  const { data: credentials, error } = await supabase
    .from('monzo_credentials')
    .select('id, user_id, access_token, refresh_token');

  if (error) {
    console.error('❌ Failed to fetch Monzo credentials:', error.message);
    return { migrated: 0, skipped: 0, errors: 1 };
  }

  if (!credentials || credentials.length === 0) {
    console.log('  No Monzo credentials found');
    return { migrated: 0, skipped: 0, errors: 0 };
  }

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const cred of credentials) {
    try {
      const updates: Record<string, string | null> = {};

      // Check and encrypt access_token
      if (cred.access_token && !looksEncrypted(cred.access_token)) {
        updates.access_token = await encrypt(cred.access_token);
        console.log(`  🔐 Encrypting access_token for user ${cred.user_id.slice(0, 8)}...`);
      }

      // Check and encrypt refresh_token
      if (cred.refresh_token && !looksEncrypted(cred.refresh_token)) {
        updates.refresh_token = await encrypt(cred.refresh_token);
        console.log(`  🔐 Encrypting refresh_token for user ${cred.user_id.slice(0, 8)}...`);
      }

      if (Object.keys(updates).length > 0) {
        const { error: updateError } = await supabase
          .from('monzo_credentials')
          .update(updates)
          .eq('id', cred.id);

        if (updateError) {
          console.error(`  ❌ Failed to update credentials for ${cred.user_id.slice(0, 8)}:`, updateError.message);
          errors++;
        } else {
          migrated++;
        }
      } else {
        console.log(`  ⏭️  Skipping user ${cred.user_id.slice(0, 8)} (already encrypted)`);
        skipped++;
      }
    } catch (err) {
      console.error(`  ❌ Error processing credentials for ${cred.user_id.slice(0, 8)}:`, err);
      errors++;
    }
  }

  return { migrated, skipped, errors };
}

async function main() {
  console.log('🔒 Credential Encryption Migration');
  console.log('===================================');

  const paypalResult = await migratePayPalCredentials();
  const monzoResult = await migrateMonzoCredentials();

  console.log('\n📊 Migration Summary');
  console.log('====================');
  console.log(`PayPal:  ${paypalResult.migrated} migrated, ${paypalResult.skipped} skipped, ${paypalResult.errors} errors`);
  console.log(`Monzo:   ${monzoResult.migrated} migrated, ${monzoResult.skipped} skipped, ${monzoResult.errors} errors`);

  const totalErrors = paypalResult.errors + monzoResult.errors;
  if (totalErrors > 0) {
    console.log(`\n⚠️  Migration completed with ${totalErrors} error(s)`);
    process.exit(1);
  } else {
    console.log('\n✅ Migration completed successfully');
  }
}

main().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
