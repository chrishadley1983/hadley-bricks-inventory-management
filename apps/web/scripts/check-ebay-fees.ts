import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function query() {
  console.log('=== eBay Fees Breakdown (November 2025) ===\n');

  // 1. NON_SALE_CHARGE DEBIT fees (by feeType)
  const { data: nonSaleDebit, error: e1 } = await supabase
    .from('ebay_transactions')
    .select('transaction_date, amount, raw_response')
    .eq('transaction_type', 'NON_SALE_CHARGE')
    .eq('booking_entry', 'DEBIT')
    .gte('transaction_date', '2025-11-01')
    .lte('transaction_date', '2025-11-30');

  if (e1) {
    console.error('Error:', e1);
    return;
  }

  // Categorize by feeType
  const feesByType: Record<string, { count: number; total: number }> = {};
  for (const row of nonSaleDebit || []) {
    const rawResponse = row.raw_response as { feeType?: string; transactionMemo?: string } | null;
    const feeType = rawResponse?.feeType || 'UNKNOWN';
    const memo = rawResponse?.transactionMemo || '';

    // Special handling for OTHER_FEES
    let category = feeType;
    if (feeType === 'OTHER_FEES') {
      const dateRangePattern = /^\d{4}-\d{2}-\d{2} - \d{4}-\d{2}-\d{2}$/;
      if (dateRangePattern.test(memo)) {
        category = 'OTHER_FEES (Shop Fee - date range memo)';
      } else {
        category = `OTHER_FEES (memo: ${memo.substring(0, 30)}...)`;
      }
    }
    if (memo === 'Promoted Offsite fee') {
      category = 'PROMOTIONAL_FEE (Promoted Offsite)';
    }

    if (!feesByType[category]) {
      feesByType[category] = { count: 0, total: 0 };
    }
    feesByType[category].count++;
    feesByType[category].total += Math.abs(Number(row.amount || 0));
  }

  console.log('1. NON_SALE_CHARGE DEBIT (by feeType):');
  console.log('----------------------------------------');
  let nonSaleDebitTotal = 0;
  for (const [type, data] of Object.entries(feesByType).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`   ${type}: £${data.total.toFixed(2)} (${data.count} txns)`);
    nonSaleDebitTotal += data.total;
  }
  console.log(`   --- SUBTOTAL: £${nonSaleDebitTotal.toFixed(2)}`);
  console.log('');

  // 2. NON_SALE_CHARGE CREDIT (fee refunds)
  const { data: nonSaleCredit, error: e2 } = await supabase
    .from('ebay_transactions')
    .select('transaction_date, amount')
    .eq('transaction_type', 'NON_SALE_CHARGE')
    .eq('booking_entry', 'CREDIT')
    .gte('transaction_date', '2025-11-01')
    .lte('transaction_date', '2025-11-30');

  if (e2) {
    console.error('Error:', e2);
    return;
  }

  const feeRefundTotal = (nonSaleCredit || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  console.log('2. NON_SALE_CHARGE CREDIT (Fee Refunds):');
  console.log('----------------------------------------');
  console.log(`   Count: ${nonSaleCredit?.length || 0}`);
  console.log(`   Total: £${feeRefundTotal.toFixed(2)}`);
  console.log('');

  // 3. Variable Fees from SALE transactions (FINAL_VALUE_FEE)
  const { data: sales, error: e3 } = await supabase
    .from('ebay_transactions')
    .select('transaction_date, raw_response')
    .eq('transaction_type', 'SALE')
    .eq('booking_entry', 'CREDIT')
    .gte('transaction_date', '2025-11-01')
    .lte('transaction_date', '2025-11-30');

  if (e3) {
    console.error('Error:', e3);
    return;
  }

  let variableFees = 0;
  let regulatoryFees = 0;
  let otherMarketplaceFees = 0;
  const marketplaceFeeTypes: Record<string, number> = {};

  for (const row of sales || []) {
    const rawResponse = row.raw_response as {
      orderLineItems?: Array<{
        marketplaceFees?: Array<{ feeType: string; amount: { value: string } }>;
      }>;
    } | null;

    if (rawResponse?.orderLineItems) {
      for (const lineItem of rawResponse.orderLineItems) {
        if (lineItem.marketplaceFees) {
          for (const fee of lineItem.marketplaceFees) {
            const feeValue = Number(fee.amount?.value || 0);
            marketplaceFeeTypes[fee.feeType] = (marketplaceFeeTypes[fee.feeType] || 0) + feeValue;

            if (fee.feeType === 'FINAL_VALUE_FEE') {
              variableFees += feeValue;
            } else if (fee.feeType === 'REGULATORY_OPERATING_FEE') {
              regulatoryFees += feeValue;
            } else {
              otherMarketplaceFees += feeValue;
            }
          }
        }
      }
    }
  }

  console.log('3. Marketplace Fees from SALE transactions:');
  console.log('--------------------------------------------');
  for (const [type, total] of Object.entries(marketplaceFeeTypes).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${type}: £${total.toFixed(2)}`);
  }
  console.log(`   --- SUBTOTAL: £${(variableFees + regulatoryFees + otherMarketplaceFees).toFixed(2)}`);
  console.log('');

  // Summary table
  console.log('===========================================');
  console.log('SUMMARY TABLE');
  console.log('===========================================');
  console.log('| Fee Type                    | Amount     |');
  console.log('|-----------------------------|------------|');

  // From NON_SALE_CHARGE DEBIT
  const insertionFee = feesByType['INSERTION_FEE']?.total || 0;
  const adFee = feesByType['AD_FEE']?.total || 0;
  const premiumAdFee = feesByType['PREMIUM_AD_FEES']?.total || 0;
  const fixedFee = feesByType['FINAL_VALUE_FEE_FIXED_PER_ORDER']?.total || 0;

  // Shop fee (OTHER_FEES with date range memo)
  let shopFee = 0;
  for (const [type, data] of Object.entries(feesByType)) {
    if (type.includes('Shop Fee')) {
      shopFee += data.total;
    }
  }

  // Promotional fees
  let promoFee = 0;
  for (const [type, data] of Object.entries(feesByType)) {
    if (type.includes('Promoted Offsite')) {
      promoFee += data.total;
    }
  }

  console.log(`| eBay Insertion Fees         | £${insertionFee.toFixed(2).padStart(9)} |`);
  console.log(`| eBay Ad Fees - Standard     | £${adFee.toFixed(2).padStart(9)} |`);
  console.log(`| eBay Ad Fees - Advanced     | £${premiumAdFee.toFixed(2).padStart(9)} |`);
  console.log(`| eBay Fixed Fees             | £${fixedFee.toFixed(2).padStart(9)} |`);
  console.log(`| eBay Variable Fees          | £${variableFees.toFixed(2).padStart(9)} |`);
  console.log(`| eBay Regulatory Fees        | £${regulatoryFees.toFixed(2).padStart(9)} |`);
  console.log(`| eBay Shop Fee               | £${shopFee.toFixed(2).padStart(9)} |`);
  console.log(`| eBay Promotional Fees       | £${promoFee.toFixed(2).padStart(9)} |`);
  console.log(`| eBay Fee Refunds (credit)   | £${feeRefundTotal.toFixed(2).padStart(9)} |`);
  console.log('|-----------------------------|------------|');

  const totalFees = insertionFee + adFee + premiumAdFee + fixedFee + variableFees + regulatoryFees + shopFee + promoFee;
  const netFees = totalFees - feeRefundTotal;
  console.log(`| TOTAL FEES                  | £${totalFees.toFixed(2).padStart(9)} |`);
  console.log(`| NET (fees - refunds)        | £${netFees.toFixed(2).padStart(9)} |`);
  console.log('===========================================');
}

query().catch(console.error);
