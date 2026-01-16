import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const { data, error } = await supabase
    .from('inventory_items')
    .select('id, set_number, listing_platform, listing_value, item_name')
    .eq('set_number', '3858')
    .limit(5);

  console.log('Results for set 3858:');
  console.log(JSON.stringify(data, null, 2));
  if (error) console.error('Error:', error);
}

main();
