import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { data: creds, error } = await supabase
  .from('platform_credentials')
  .select('credentials_encrypted')
  .eq('platform', 'amazon')
  .eq('user_id', '4b6e94b4-661c-4462-9d14-b21df7d51e5b')
  .single();

if (error || !creds) {
  console.log('Error:', error);
  console.log('No Amazon credentials found');
  process.exit(1);
}

console.log('Credentials found, decrypting...');
const { decryptObject } = await import('./src/lib/crypto/encryption.js');
const decryptedCreds = await decryptObject(creds.credentials_encrypted);

console.log('Creating Amazon client...');
const { AmazonClient } = await import('./src/lib/amazon/client.js');
const client = new AmazonClient(decryptedCreds);

console.log('Fetching order 204-6235310-3642725...');
const order = await client.getOrder('204-6235310-3642725');
console.log('Order Status:', order.OrderStatus);
console.log('Last Update:', order.LastUpdateDate);
console.log('Full order:');
console.log(JSON.stringify(order, null, 2));
