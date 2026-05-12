/**
 * Test BrickLink API connection
 *
 * Usage: npx tsx scripts/test-bricklink.ts
 */

import { createScriptBlContext } from './_bl-client';

async function main() {
  console.log('Testing BrickLink API connection...\n');

  const { bl: client } = createScriptBlContext('test-bricklink-script');

  try {
    console.log('Fetching orders...');
    // direction=in for orders received (you are seller)
    const orders = await client.getOrders({ direction: 'in' });
    console.log(`\n✅ SUCCESS! Found ${orders.length} orders.\n`);

    if (orders.length > 0) {
      console.log('Most recent orders:');
      orders.slice(0, 5).forEach((order) => {
        console.log(`  - Order #${order.order_id}: ${order.buyer_name} - ${order.status} - ${order.cost.grand_total}`);
      });
    }
  } catch (error) {
    console.error('\n❌ FAILED:', error);
  }
}

main();
