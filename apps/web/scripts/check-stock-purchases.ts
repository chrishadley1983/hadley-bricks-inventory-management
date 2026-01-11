import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function query() {
  console.log('=== Stock Purchases (November 2025) ===\n');

  // 1. Lego Stock Purchases (from Monzo 'Lego Stock' category)
  const { data: stockData, error: e1 } = await supabase
    .from('monzo_transactions')
    .select('created, amount')
    .eq('local_category', 'Lego Stock')
    .lt('amount', 0)
    .gte('created', '2025-11-01')
    .lte('created', '2025-11-30');

  if (e1) {
    console.error('Error:', e1);
    return;
  }

  const stockTotal = (stockData || []).reduce((sum, row) => sum + Math.abs(Number(row.amount || 0)) / 100, 0);
  console.log('Lego Stock Purchases (Monzo "Lego Stock"):');
  console.log('  Count:', stockData?.length || 0);
  console.log('  Total: £' + stockTotal.toFixed(2));
  console.log('');

  // 2. Lego Parts Purchases (from Monzo 'Lego Parts' category)
  const { data: partsData, error: e2 } = await supabase
    .from('monzo_transactions')
    .select('created, amount')
    .eq('local_category', 'Lego Parts')
    .lt('amount', 0)
    .gte('created', '2025-11-01')
    .lte('created', '2025-11-30');

  if (e2) {
    console.error('Error:', e2);
    return;
  }

  const partsTotal = (partsData || []).reduce((sum, row) => sum + Math.abs(Number(row.amount || 0)) / 100, 0);
  console.log('Lego Parts Purchases (Monzo "Lego Parts"):');
  console.log('  Count:', partsData?.length || 0);
  console.log('  Total: £' + partsTotal.toFixed(2));
  console.log('');

  // Summary
  console.log('===========================================');
  console.log('| Category                | Amount        |');
  console.log('|-------------------------|---------------|');
  console.log(`| Lego Stock Purchases    | £${stockTotal.toFixed(2).padStart(12)} |`);
  console.log(`| Lego Parts              | £${partsTotal.toFixed(2).padStart(12)} |`);
  console.log('===========================================');
}

query().catch(console.error);
