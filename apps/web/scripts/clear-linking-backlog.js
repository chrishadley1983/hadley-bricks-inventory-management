const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function clearBacklog() {
  console.log('Clearing eBay inventory linking backlog...');

  // 1. Delete all resolution queue items
  const { data: deletedQueue, error: queueError } = await supabase
    .from('ebay_inventory_resolution_queue')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000')
    .select('id');

  if (queueError) {
    console.error('Error deleting queue:', queueError);
    return;
  }
  console.log('Deleted queue items:', deletedQueue?.length || 0);

  // 2. Reset ebay_orders inventory_link_status - with pagination
  const pageSize = 1000;
  let totalReset = 0;
  let hasMore = true;
  let page = 0;

  while (hasMore) {
    const { data: orders, error: ordersError } = await supabase
      .from('ebay_orders')
      .select('id')
      .not('inventory_link_status', 'is', null)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (ordersError) {
      console.error('Error fetching orders:', ordersError);
      break;
    }

    if (!orders || orders.length === 0) {
      hasMore = false;
      break;
    }

    const orderIds = orders.map(o => o.id);
    const { error: updateError } = await supabase
      .from('ebay_orders')
      .update({ inventory_link_status: null, inventory_linked_at: null })
      .in('id', orderIds);

    if (updateError) {
      console.error('Error resetting orders:', updateError);
      break;
    }

    totalReset += orders.length;
    hasMore = orders.length === pageSize;
    page++;
  }

  console.log('Reset orders:', totalReset);

  // 3. Clear ebay_order_line_items inventory_item_id links - with pagination
  let totalLineItems = 0;
  hasMore = true;
  page = 0;

  while (hasMore) {
    const { data: lineItems, error: lineItemsError } = await supabase
      .from('ebay_order_line_items')
      .select('id')
      .not('inventory_item_id', 'is', null)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (lineItemsError) {
      console.error('Error fetching line items:', lineItemsError);
      break;
    }

    if (!lineItems || lineItems.length === 0) {
      hasMore = false;
      break;
    }

    const lineItemIds = lineItems.map(li => li.id);
    const { error: updateError } = await supabase
      .from('ebay_order_line_items')
      .update({
        inventory_item_id: null,
        inventory_linked_at: null,
        inventory_link_method: null
      })
      .in('id', lineItemIds);

    if (updateError) {
      console.error('Error resetting line items:', updateError);
      break;
    }

    totalLineItems += lineItems.length;
    hasMore = lineItems.length === pageSize;
    page++;
  }

  console.log('Reset line items:', totalLineItems);

  console.log('Done! Backlog cleared.');
}

clearBacklog();
