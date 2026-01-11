import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function query() {
  console.log('=== eBay Fees (Updated Queries - November 2025) ===\n');

  // 1. eBay Insertion Fees (unchanged)
  const { data: nonSaleDebit, error: e1 } = await supabase
    .from('ebay_transactions')
    .select('transaction_date, amount, raw_response')
    .eq('transaction_type', 'NON_SALE_CHARGE')
    .eq('booking_entry', 'DEBIT')
    .gte('transaction_date', '2025-11-01')
    .lte('transaction_date', '2025-11-30');

  if (e1) { console.error('Error:', e1); return; }

  let insertionFees = 0;
  for (const row of nonSaleDebit || []) {
    const rawResponse = row.raw_response as { feeType?: string } | null;
    if (rawResponse?.feeType === 'INSERTION_FEE') {
      insertionFees += Math.abs(Number(row.amount || 0));
    }
  }

  // 2. eBay Ad Fees - Standard (AD_FEE minus refunds)
  let adFeesStandard = 0;
  for (const row of nonSaleDebit || []) {
    const rawResponse = row.raw_response as { feeType?: string } | null;
    if (rawResponse?.feeType === 'AD_FEE') {
      adFeesStandard += Math.abs(Number(row.amount || 0));
    }
  }

  // Get refunds
  const { data: refunds, error: e2 } = await supabase
    .from('ebay_transactions')
    .select('transaction_date, amount')
    .eq('transaction_type', 'NON_SALE_CHARGE')
    .eq('booking_entry', 'CREDIT')
    .gte('transaction_date', '2025-11-01')
    .lte('transaction_date', '2025-11-30');

  if (e2) { console.error('Error:', e2); return; }

  let feeRefunds = 0;
  for (const row of refunds || []) {
    feeRefunds += Math.abs(Number(row.amount || 0));
  }

  const adFeesStandardNet = Math.max(0, adFeesStandard - feeRefunds);

  // 3. eBay Ad Fees - Advanced
  let adFeesAdvanced = 0;
  for (const row of nonSaleDebit || []) {
    const rawResponse = row.raw_response as { feeType?: string } | null;
    if (rawResponse?.feeType === 'PREMIUM_AD_FEES') {
      adFeesAdvanced += Math.abs(Number(row.amount || 0));
    }
  }

  // 4. eBay Shop Fee
  const dateRangePattern = /^\d{4}-\d{2}-\d{2} - \d{4}-\d{2}-\d{2}$/;
  let shopFee = 0;
  for (const row of nonSaleDebit || []) {
    const rawResponse = row.raw_response as { feeType?: string; transactionMemo?: string } | null;
    if (rawResponse?.feeType === 'OTHER_FEES' && rawResponse?.transactionMemo && dateRangePattern.test(rawResponse.transactionMemo)) {
      shopFee += Math.abs(Number(row.amount || 0));
    }
  }

  // 5-7. Fees from SALE transactions
  const { data: sales, error: e3 } = await supabase
    .from('ebay_transactions')
    .select('transaction_date, raw_response')
    .eq('transaction_type', 'SALE')
    .eq('booking_entry', 'CREDIT')
    .gte('transaction_date', '2025-11-01')
    .lte('transaction_date', '2025-11-30');

  if (e3) { console.error('Error:', e3); return; }

  let variableFees = 0;
  let fixedFees = 0;
  let regulatoryFees = 0;
  let internationalFees = 0;

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
            if (fee.feeType === 'FINAL_VALUE_FEE') {
              variableFees += feeValue;
            } else if (fee.feeType === 'FINAL_VALUE_FEE_FIXED_PER_ORDER') {
              fixedFees += feeValue;
            } else if (fee.feeType === 'REGULATORY_OPERATING_FEE') {
              regulatoryFees += feeValue;
            } else if (fee.feeType === 'INTERNATIONAL_FEE') {
              internationalFees += feeValue;
            }
          }
        }
      }
    }
  }

  console.log('===========================================');
  console.log('UPDATED eBay FEES TABLE');
  console.log('===========================================');
  console.log('| Fee Type                    | Amount     |');
  console.log('|-----------------------------|------------|');
  console.log(`| eBay Insertion Fees         | £${insertionFees.toFixed(2).padStart(9)} |`);
  console.log(`| eBay Ad Fees - Standard     | £${adFeesStandardNet.toFixed(2).padStart(9)} | (£${adFeesStandard.toFixed(2)} - £${feeRefunds.toFixed(2)} refunds)`);
  console.log(`| eBay Ad Fees - Advanced     | £${adFeesAdvanced.toFixed(2).padStart(9)} |`);
  console.log(`| eBay Fixed Fees             | £${fixedFees.toFixed(2).padStart(9)} | (from SALE transactions)`);
  console.log(`| eBay Variable Fees          | £${variableFees.toFixed(2).padStart(9)} |`);
  console.log(`| eBay Regulatory Fees        | £${regulatoryFees.toFixed(2).padStart(9)} |`);
  console.log(`| eBay Shop Fee               | £${shopFee.toFixed(2).padStart(9)} |`);
  console.log('|-----------------------------|------------|');
  console.log(`| eBay International Fees     | £${internationalFees.toFixed(2).padStart(9)} | (NOT YET CAPTURED)`);
  console.log('|-----------------------------|------------|');

  const totalFees = insertionFees + adFeesStandardNet + adFeesAdvanced + fixedFees + variableFees + regulatoryFees + shopFee;
  console.log(`| TOTAL (excl. International) | £${totalFees.toFixed(2).padStart(9)} |`);
  console.log(`| TOTAL (incl. International) | £${(totalFees + internationalFees).toFixed(2).padStart(9)} |`);
  console.log('===========================================');
}

query().catch(console.error);
