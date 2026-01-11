import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function query() {
  const { data, error } = await supabase
    .from('monzo_transactions')
    .select('created, amount')
    .eq('local_category', 'Selling Fees')
    .lt('amount', 0)
    .gte('created', '2025-11-01')
    .lte('created', '2025-11-30');

  if (error) {
    console.error('Error:', error);
    return;
  }

  const total = (data || []).reduce((sum, row) => sum + Math.abs(Number(row.amount || 0)) / 100, 0);
  console.log('BrickLink Fees (Monzo Selling Fees):');
  console.log('  Count:', data?.length || 0);
  console.log('  Total: £' + total.toFixed(2));
}

query().catch(console.error);
