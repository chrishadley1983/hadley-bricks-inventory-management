import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/api/cron-auth';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Inbound Shopify sale sync.
 *
 * Runs more frequently than full-sync to minimise the double-sell window:
 *  1. Ingest paid Shopify orders -> mark matched inventory SOLD
 *     (sold_platform = 'shopify'), archive/decrement the Shopify product, and
 *     end the matching eBay listing.
 *  2. Reconcile Shopify quantities — clamp any overstated variant (including
 *     orphan products with no mapping) down to the true LISTED count.
 *  3. Dedupe by SKU — archive untracked orphan duplicate products (the ghost
 *     "Sold out" cards left behind when an inventory item is re-created).
 *
 * Auth: Bearer CRON_SECRET (GCP Cloud Scheduler / Vercel cron).
 */
export async function POST(request: NextRequest) {
  const unauthorized = verifyCronAuth(request, 'ShopifyOrders');
  if (unauthorized) return unauthorized;

  const startTime = Date.now();
  const supabase = createServiceRoleClient();

  // Single-tenant: pick the Shopify-enabled user.
  const { data: cfgRows, error: cfgErr } = await supabase
    .from('shopify_config')
    .select('user_id')
    .eq('sync_enabled', true)
    .limit(1);

  if (cfgErr) {
    return NextResponse.json({ error: `config lookup failed: ${cfgErr.message}` }, { status: 500 });
  }
  const userId = cfgRows?.[0]?.user_id;
  if (!userId) {
    return NextResponse.json({ skipped: true, reason: 'No Shopify-enabled user' });
  }

  const { ShopifyOrderSyncService } = await import('@/lib/shopify/order-sync.service');
  const { ShopifySyncService } = await import('@/lib/shopify/sync.service');

  const orderResult = await new ShopifyOrderSyncService(supabase, userId).syncOrders();

  const syncService = new ShopifySyncService(supabase, userId);

  // Reconcile quantities after ingestion (non-fatal if it errors).
  let reconcile = null;
  try {
    reconcile = await syncService.reconcileInventoryQuantities();
  } catch (err) {
    reconcile = { error: err instanceof Error ? err.message : String(err) };
  }

  // Archive any untracked orphan duplicate products (non-fatal if it errors).
  let dedupe = null;
  try {
    dedupe = await syncService.dedupeBySku();
  } catch (err) {
    dedupe = { error: err instanceof Error ? err.message : String(err) };
  }

  return NextResponse.json({
    success: orderResult.success,
    durationMs: Date.now() - startTime,
    orders: orderResult,
    reconcile,
    dedupe,
  });
}
