/**
 * One-shot: backfill `purchases` row for BL order 31431976 (Studs and Bricks / Bruffty).
 * No arbitrage_purchases row exists — the order pre-dates the bl-basket close-out flow.
 * Mirrors the insert shape used by closePurchase() in bl-basket.ts.
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
import { createClient } from '@supabase/supabase-js';
import { BrickLinkClient } from '../src/lib/bricklink/client';

const BL_ORDER_ID = '31431976';
const USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';

const creds = {
  consumerKey: process.env.BRICKLINK_CONSUMER_KEY ?? '',
  consumerSecret: process.env.BRICKLINK_CONSUMER_SECRET ?? '',
  tokenValue: process.env.BRICKLINK_TOKEN_VALUE ?? '',
  tokenSecret: process.env.BRICKLINK_TOKEN_SECRET ?? '',
};
for (const [k, v] of Object.entries(creds)) {
  if (!v) { console.error(`Missing BRICKLINK_${k}`); process.exit(1); }
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const bl = new BrickLinkClient(creds, { supabase, caller: 'backfill-purchase-script' });

(async () => {
  const { data: existing } = await supabase
    .from('purchases')
    .select('id')
    .eq('reference', BL_ORDER_ID);
  if (existing && existing.length > 0) {
    console.error(`Refusing: purchases row already exists for reference=${BL_ORDER_ID} (id=${existing[0].id})`);
    process.exit(1);
  }

  console.log(`Fetching BL order ${BL_ORDER_ID}...`);
  const order = await bl.getOrder(BL_ORDER_ID);
  console.log(JSON.stringify({
    seller_name: order.seller_name,
    store_name: order.store_name,
    date_ordered: order.date_ordered,
    status: order.status,
    total_count: order.total_count,
    unique_count: order.unique_count,
    cost: order.cost,
  }, null, 2));

  const cost = order.cost as { subtotal: string; shipping: string; grand_total: string; final_total?: string };
  const subtotal = parseFloat(cost.subtotal);
  const shipping = parseFloat(cost.shipping);
  const grandTotal = parseFloat(cost.grand_total) || parseFloat(cost.final_total || '0');

  const lots = (order as { unique_count?: number }).unique_count ?? 0;
  const pieces = (order as { total_count?: number }).total_count ?? 0;
  const sellerStore = (order as { store_name?: string }).store_name ?? order.seller_name;

  const purchaseRow = {
    user_id: USER_ID,
    purchase_date: new Date(order.date_ordered).toISOString().slice(0, 10),
    short_description: `BrickLink ${order.seller_name} #${BL_ORDER_ID} — ${lots} lots / ${pieces} pieces`,
    description:
      `BrickLink purchase from ${order.seller_name} (${sellerStore}).\n\n` +
      `Subtotal: £${subtotal.toFixed(2)}\n` +
      `Shipping & Packaging: £${shipping.toFixed(2)}\n` +
      `Grand Total: £${grandTotal.toFixed(2)}\n\n` +
      `Backfilled manually — order pre-dates bl-basket --close flow.`,
    cost: grandTotal,
    source: 'BrickLink',
    payment_method: 'PayPal',
    reference: BL_ORDER_ID,
  };
  console.log('\nAbout to insert:');
  console.log(JSON.stringify(purchaseRow, null, 2));

  if (process.argv.includes('--confirm')) {
    const { data, error } = await supabase
      .from('purchases')
      .insert(purchaseRow)
      .select('id')
      .single();
    if (error) { console.error('insert error:', error.message); process.exit(1); }
    console.log(`\n✓ Inserted purchases.id = ${data?.id}`);
  } else {
    console.log('\n(dry run — pass --confirm to insert)');
  }
})();
