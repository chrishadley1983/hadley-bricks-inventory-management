/**
 * Test BrickLink API connection
 *
 * Usage: npx tsx scripts/test-bricklink.ts
 */

import { BrickLinkClient } from '../src/lib/bricklink/client';

const credentials = {
  consumerKey: process.env.BRICKLINK_CONSUMER_KEY || '',
  consumerSecret: process.env.BRICKLINK_CONSUMER_SECRET || '',
  tokenValue: process.env.BRICKLINK_TOKEN_VALUE || '',
  tokenSecret: process.env.BRICKLINK_TOKEN_SECRET || '',
};

async function main() {
  console.log('Testing BrickLink API connection...\n');

  // Check if credentials are set
  if (!credentials.consumerKey || !credentials.consumerSecret ||
      !credentials.tokenValue || !credentials.tokenSecret) {
    console.log('Set these environment variables first:');
    console.log('  BRICKLINK_CONSUMER_KEY=your_consumer_key');
    console.log('  BRICKLINK_CONSUMER_SECRET=your_consumer_secret');
    console.log('  BRICKLINK_TOKEN_VALUE=your_token_value');
    console.log('  BRICKLINK_TOKEN_SECRET=your_token_secret');
    console.log('\nOr run with inline values:');
    console.log('  set BRICKLINK_CONSUMER_KEY=xxx && set BRICKLINK_CONSUMER_SECRET=xxx && set BRICKLINK_TOKEN_VALUE=xxx && set BRICKLINK_TOKEN_SECRET=xxx && npx tsx scripts/test-bricklink.ts');
    process.exit(1);
  }

  console.log('Credentials found:');
  console.log(`  Consumer Key: ${credentials.consumerKey.substring(0, 8)}...`);
  console.log(`  Token Value: ${credentials.tokenValue.substring(0, 8)}...\n`);

  const client = new BrickLinkClient(credentials);

  try {
    console.log('Fetching orders...');
    const orders = await client.getOrders({ direction: 'out' });
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
