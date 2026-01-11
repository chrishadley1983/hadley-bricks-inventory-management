import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function query() {
  console.log('=== November 2025 P&L Data Check ===\n');

  // eBay Refunds from ebay_transactions
  const { data: ebayRefunds, error: e1 } = await supabase
    .from('ebay_transactions')
    .select('transaction_date, amount')
    .eq('transaction_type', 'REFUND')
    .eq('booking_entry', 'DEBIT')
    .gte('transaction_date', '2025-11-01')
    .lte('transaction_date', '2025-11-30');

  if (e1) console.error('eBay Refunds Error:', e1);
  const ebayRefundTotal = (ebayRefunds || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  console.log('eBay Refunds (ebay_transactions):');
  console.log('  Count:', ebayRefunds?.length || 0);
  console.log('  Total: £' + ebayRefundTotal.toFixed(2));
  console.log('');

  // Amazon Refunds
  const { data: amazonRefunds, error: e2 } = await supabase
    .from('amazon_transactions')
    .select('posted_date, total_amount')
    .in('transaction_type', ['Refund', 'GuaranteeClaimRefund'])
    .gte('posted_date', '2025-11-01')
    .lte('posted_date', '2025-11-30');

  if (e2) console.error('Amazon Refunds Error:', e2);
  const amazonRefundTotal = (amazonRefunds || []).reduce((sum, row) => sum + Math.abs(Number(row.total_amount || 0)), 0);
  console.log('Amazon Refunds (amazon_transactions):');
  console.log('  Count:', amazonRefunds?.length || 0);
  console.log('  Total: £' + amazonRefundTotal.toFixed(2));
  console.log('');

  // BrickLink/PayPal Fees
  const { data: paypalFees, error: e3 } = await supabase
    .from('paypal_transactions')
    .select('transaction_date, fee_amount')
    .gte('transaction_date', '2025-11-01')
    .lte('transaction_date', '2025-11-30');

  if (e3) console.error('PayPal Fees Error:', e3);
  const paypalFeeTotal = (paypalFees || []).reduce((sum, row) => sum + Math.abs(Number(row.fee_amount || 0)), 0);
  console.log('BrickLink Fees (paypal_transactions):');
  console.log('  Count:', paypalFees?.length || 0);
  console.log('  Total: £' + paypalFeeTotal.toFixed(2));
  console.log('');

  // Amazon Fees (from Shipment transactions)
  const { data: amazonFees, error: e4 } = await supabase
    .from('amazon_transactions')
    .select('posted_date, referral_fee, fba_fulfillment_fee, fba_per_unit_fee, fba_weight_fee, fba_inventory_storage_fee, other_fees')
    .eq('transaction_type', 'Shipment')
    .gte('posted_date', '2025-11-01')
    .lte('posted_date', '2025-11-30');

  if (e4) console.error('Amazon Fees Error:', e4);
  let amazonFeeTotal = 0;
  for (const row of amazonFees || []) {
    amazonFeeTotal +=
      Math.abs(Number(row.referral_fee || 0)) +
      Math.abs(Number(row.fba_fulfillment_fee || 0)) +
      Math.abs(Number(row.fba_per_unit_fee || 0)) +
      Math.abs(Number(row.fba_weight_fee || 0)) +
      Math.abs(Number(row.fba_inventory_storage_fee || 0)) +
      Math.abs(Number(row.other_fees || 0));
  }
  console.log('Amazon Fees (amazon_transactions Shipment):');
  console.log('  Count:', amazonFees?.length || 0);
  console.log('  Total: £' + amazonFeeTotal.toFixed(2));
  console.log('');

  // eBay Fees breakdown
  const { data: ebayFees, error: e5 } = await supabase
    .from('ebay_transactions')
    .select('transaction_date, amount, raw_response')
    .eq('transaction_type', 'NON_SALE_CHARGE')
    .eq('booking_entry', 'DEBIT')
    .gte('transaction_date', '2025-11-01')
    .lte('transaction_date', '2025-11-30');

  if (e5) console.error('eBay Fees Error:', e5);

  const feeBreakdown: Record<string, number> = {};
  for (const row of ebayFees || []) {
    const rawResponse = row.raw_response as { feeType?: string } | null;
    const feeType = rawResponse?.feeType || 'UNKNOWN';
    feeBreakdown[feeType] = (feeBreakdown[feeType] || 0) + Math.abs(Number(row.amount || 0));
  }
  console.log('eBay Fees by Type (NON_SALE_CHARGE DEBIT):');
  for (const [type, amount] of Object.entries(feeBreakdown).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: £${amount.toFixed(2)}`);
  }
  console.log('');

  // eBay Variable Fees (from SALE transactions)
  const { data: ebaySales, error: e6 } = await supabase
    .from('ebay_transactions')
    .select('transaction_date, raw_response')
    .eq('transaction_type', 'SALE')
    .eq('booking_entry', 'CREDIT')
    .gte('transaction_date', '2025-11-01')
    .lte('transaction_date', '2025-11-30');

  if (e6) console.error('eBay Sales Error:', e6);

  let ebayVariableFees = 0;
  let ebayRegulatoryFees = 0;
  for (const row of ebaySales || []) {
    const rawResponse = row.raw_response as {
      orderLineItems?: Array<{
        marketplaceFees?: Array<{ feeType: string; amount: { value: string } }>;
      }>;
    } | null;

    if (rawResponse?.orderLineItems) {
      for (const lineItem of rawResponse.orderLineItems) {
        if (lineItem.marketplaceFees) {
          for (const fee of lineItem.marketplaceFees) {
            if (fee.feeType === 'FINAL_VALUE_FEE') {
              ebayVariableFees += Number(fee.amount?.value || 0);
            } else if (fee.feeType === 'REGULATORY_OPERATING_FEE') {
              ebayRegulatoryFees += Number(fee.amount?.value || 0);
            }
          }
        }
      }
    }
  }
  console.log('eBay Fees from SALE transactions:');
  console.log('  Variable Fees (FINAL_VALUE_FEE): £' + ebayVariableFees.toFixed(2));
  console.log('  Regulatory Fees: £' + ebayRegulatoryFees.toFixed(2));
  console.log('');

  // Stock Purchases
  const { data: purchases, error: e7 } = await supabase
    .from('purchases')
    .select('purchase_date, cost, short_description')
    .gte('purchase_date', '2025-11-01')
    .lte('purchase_date', '2025-11-30');

  if (e7) console.error('Purchases Error:', e7);

  let stockPurchases = 0;
  let partsPurchases = 0;
  for (const row of purchases || []) {
    const desc = (row.short_description || '').toLowerCase();
    if (desc.includes('part')) {
      partsPurchases += Number(row.cost || 0);
    } else {
      stockPurchases += Number(row.cost || 0);
    }
  }
  console.log('Stock Purchases:');
  console.log('  Lego Stock: £' + stockPurchases.toFixed(2));
  console.log('  Lego Parts: £' + partsPurchases.toFixed(2));
  console.log('');

  // Monzo categories
  const categories = ['Postage', 'Packing Materials', 'Services', 'Software', 'Office Space'];
  console.log('Monzo Expenses:');
  for (const cat of categories) {
    const { data: monzo, error } = await supabase
      .from('monzo_transactions')
      .select('created, amount')
      .eq('local_category', cat)
      .lt('amount', 0)
      .gte('created', '2025-11-01T00:00:00')
      .lte('created', '2025-11-30T23:59:59');

    if (error) console.error(`Monzo ${cat} Error:`, error);
    const total = (monzo || []).reduce((sum, row) => sum + Math.abs(Number(row.amount || 0)) / 100, 0);
    console.log(`  ${cat}: £${total.toFixed(2)} (${monzo?.length || 0} txns)`);
  }
  console.log('');

  // Amazon Subscription
  const { data: amazonSub, error: e8 } = await supabase
    .from('amazon_transactions')
    .select('posted_date, total_amount')
    .eq('transaction_type', 'ServiceFee')
    .gte('posted_date', '2025-11-01')
    .lte('posted_date', '2025-11-30');

  if (e8) console.error('Amazon Sub Error:', e8);
  const amazonSubTotal = (amazonSub || []).reduce((sum, row) => sum + Math.abs(Number(row.total_amount || 0)), 0);
  console.log('Amazon Subscription (ServiceFee):');
  console.log('  Count:', amazonSub?.length || 0);
  console.log('  Total: £' + amazonSubTotal.toFixed(2));
  console.log('');

  // Mileage
  const { data: mileage, error: e9 } = await supabase
    .from('mileage_tracking')
    .select('tracking_date, amount_claimed')
    .gte('tracking_date', '2025-11-01')
    .lte('tracking_date', '2025-11-30');

  if (e9) console.error('Mileage Error:', e9);
  const mileageTotal = (mileage || []).reduce((sum, row) => sum + Number(row.amount_claimed || 0), 0);
  console.log('Mileage:');
  console.log('  Count:', mileage?.length || 0);
  console.log('  Total: £' + mileageTotal.toFixed(2));
}

query().catch(console.error);
