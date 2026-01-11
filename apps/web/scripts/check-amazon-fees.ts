import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function query() {
  console.log('=== Amazon Fees Investigation (November 2025) ===\n');

  // Get all Amazon transaction types
  const { data: txnTypes, error: e1 } = await supabase
    .from('amazon_transactions')
    .select('transaction_type, total_amount, referral_fee, fba_fulfillment_fee, other_fees')
    .gte('posted_date', '2025-11-01')
    .lte('posted_date', '2025-11-30');

  if (e1) {
    console.error('Error:', e1);
    return;
  }

  // Group by transaction type
  const byType: Record<string, { count: number; totalAmount: number; fees: number }> = {};

  for (const row of txnTypes || []) {
    const type = row.transaction_type || 'UNKNOWN';
    if (!byType[type]) {
      byType[type] = { count: 0, totalAmount: 0, fees: 0 };
    }
    byType[type].count++;
    byType[type].totalAmount += Number(row.total_amount || 0);
    byType[type].fees +=
      Math.abs(Number(row.referral_fee || 0)) +
      Math.abs(Number(row.fba_fulfillment_fee || 0)) +
      Math.abs(Number(row.other_fees || 0));
  }

  console.log('Amazon Transactions by Type:');
  console.log('----------------------------');
  for (const [type, data] of Object.entries(byType).sort((a, b) => b[1].count - a[1].count)) {
    console.log(`${type}:`);
    console.log(`  Count: ${data.count}`);
    console.log(`  Total Amount: £${data.totalAmount.toFixed(2)}`);
    console.log(`  Fees: £${data.fees.toFixed(2)}`);
    console.log('');
  }

  // Look at fee breakdown for Shipment transactions only
  console.log('\n=== Shipment Fee Breakdown ===');
  const { data: shipments, error: e2 } = await supabase
    .from('amazon_transactions')
    .select('referral_fee, fba_fulfillment_fee, fba_per_unit_fee, fba_weight_fee, fba_inventory_storage_fee, other_fees')
    .eq('transaction_type', 'Shipment')
    .gte('posted_date', '2025-11-01')
    .lte('posted_date', '2025-11-30');

  if (e2) {
    console.error('Error:', e2);
    return;
  }

  let referralTotal = 0;
  let fbaFulfillmentTotal = 0;
  let fbaPerUnitTotal = 0;
  let fbaWeightTotal = 0;
  let fbaStorageTotal = 0;
  let otherFeesTotal = 0;

  for (const row of shipments || []) {
    referralTotal += Math.abs(Number(row.referral_fee || 0));
    fbaFulfillmentTotal += Math.abs(Number(row.fba_fulfillment_fee || 0));
    fbaPerUnitTotal += Math.abs(Number(row.fba_per_unit_fee || 0));
    fbaWeightTotal += Math.abs(Number(row.fba_weight_fee || 0));
    fbaStorageTotal += Math.abs(Number(row.fba_inventory_storage_fee || 0));
    otherFeesTotal += Math.abs(Number(row.other_fees || 0));
  }

  console.log(`Referral Fees: £${referralTotal.toFixed(2)}`);
  console.log(`FBA Fulfillment Fees: £${fbaFulfillmentTotal.toFixed(2)}`);
  console.log(`FBA Per Unit Fees: £${fbaPerUnitTotal.toFixed(2)}`);
  console.log(`FBA Weight Fees: £${fbaWeightTotal.toFixed(2)}`);
  console.log(`FBA Storage Fees: £${fbaStorageTotal.toFixed(2)}`);
  console.log(`Other Fees: £${otherFeesTotal.toFixed(2)}`);
  console.log(`---`);
  console.log(`TOTAL: £${(referralTotal + fbaFulfillmentTotal + fbaPerUnitTotal + fbaWeightTotal + fbaStorageTotal + otherFeesTotal).toFixed(2)}`);

  // Check if there's a separate Fee transaction type
  console.log('\n=== Looking for Fee-specific transaction types ===');
  const { data: feeTypes, error: e3 } = await supabase
    .from('amazon_transactions')
    .select('transaction_type, total_amount')
    .gte('posted_date', '2025-11-01')
    .lte('posted_date', '2025-11-30')
    .or('transaction_type.ilike.%fee%,transaction_type.ilike.%commission%');

  console.log('Fee-related transaction types:');
  for (const row of feeTypes || []) {
    console.log(`  ${row.transaction_type}: £${row.total_amount}`);
  }

  // Check platform_orders for November Amazon orders
  console.log('\n=== Platform Orders (Amazon, November) ===');
  const { data: orders, error: e4 } = await supabase
    .from('platform_orders')
    .select('status, total')
    .eq('platform', 'amazon')
    .gte('order_date', '2025-11-01')
    .lte('order_date', '2025-11-30');

  if (e4) {
    console.error('Error:', e4);
    return;
  }

  const ordersByStatus: Record<string, { count: number; total: number }> = {};
  for (const row of orders || []) {
    const status = row.status || 'UNKNOWN';
    if (!ordersByStatus[status]) {
      ordersByStatus[status] = { count: 0, total: 0 };
    }
    ordersByStatus[status].count++;
    ordersByStatus[status].total += Number(row.total || 0);
  }

  for (const [status, data] of Object.entries(ordersByStatus)) {
    console.log(`${status}: ${data.count} orders, £${data.total.toFixed(2)}`);
  }
}

query().catch(console.error);
