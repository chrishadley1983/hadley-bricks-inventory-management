import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
  // Check total Amazon orders
  const { count: total } = await supabase
    .from('platform_orders')
    .select('*', { count: 'exact', head: true })
    .eq('platform', 'amazon');

  console.log('Total Amazon orders in DB:', total);

  // Check date range of orders
  const { data: oldest } = await supabase
    .from('platform_orders')
    .select('order_date')
    .eq('platform', 'amazon')
    .order('order_date', { ascending: true })
    .limit(1);

  const { data: newest } = await supabase
    .from('platform_orders')
    .select('order_date')
    .eq('platform', 'amazon')
    .order('order_date', { ascending: false })
    .limit(1);

  console.log('Oldest order:', oldest?.[0]?.order_date?.split('T')[0]);
  console.log('Newest order:', newest?.[0]?.order_date?.split('T')[0]);

  // Count orders in last 90 days
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const { count: last90 } = await supabase
    .from('platform_orders')
    .select('*', { count: 'exact', head: true })
    .eq('platform', 'amazon')
    .gte('order_date', ninetyDaysAgo.toISOString());

  console.log('Orders in last 90 days:', last90);

  // Count needing backfill (items_count = 0 or NULL)
  const { count: needsBackfill } = await supabase
    .from('platform_orders')
    .select('*', { count: 'exact', head: true })
    .eq('platform', 'amazon')
    .or('items_count.eq.0,items_count.is.null');

  console.log('Orders needing backfill:', needsBackfill);

  // Count with items already
  const { count: hasItems } = await supabase
    .from('platform_orders')
    .select('*', { count: 'exact', head: true })
    .eq('platform', 'amazon')
    .gt('items_count', 0);

  console.log('Orders with items:', hasItems);
}

check();
