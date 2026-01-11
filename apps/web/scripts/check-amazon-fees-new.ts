import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function query() {
  const { data, error } = await supabase
    .from('amazon_transactions')
    .select('posted_date, total_fees')
    .eq('transaction_type', 'Shipment')
    .eq('transaction_status', 'RELEASED')
    .gte('posted_date', '2025-11-01')
    .lte('posted_date', '2025-11-30');

  if (error) {
    console.error('Error:', error);
    return;
  }

  const total = (data || []).reduce((sum, row) => sum + Math.abs(Number(row.total_fees || 0)), 0);
  console.log('Amazon Fees (Shipment + RELEASED, total_fees):');
  console.log('  Count:', data?.length || 0);
  console.log('  Total: £' + total.toFixed(2));
}

query().catch(console.error);
