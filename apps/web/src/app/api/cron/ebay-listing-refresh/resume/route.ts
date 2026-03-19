/**
 * POST /api/cron/ebay-listing-refresh/resume
 *
 * Resumes creation of listings that were ended but not recreated
 * due to a timeout. Reads cached listing data from the DB and
 * calls AddFixedPriceItem for each ended item.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { EbayAuthService } from '@/lib/ebay/ebay-auth.service';
import { EbayTradingClient } from '@/lib/platform-stock/ebay/ebay-trading.client';
import type { AddFixedPriceItemRequest } from '@/lib/platform-stock/ebay/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';
const RATE_LIMIT_DELAY_MS = 150;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceRoleClient();

    // Get the latest refresh job
    const { data: job } = await supabase
      .from('ebay_listing_refreshes')
      .select('id, status')
      .eq('user_id', USER_ID)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!job) {
      return NextResponse.json({ error: 'No refresh job found' }, { status: 404 });
    }

    // Get ended items that need recreation
    const { data: endedItems } = await supabase
      .from('ebay_listing_refresh_items')
      .select('id, original_item_id, original_title, original_price, cached_listing_data, modified_price, modified_title, modified_quantity')
      .eq('refresh_id', job.id)
      .eq('status', 'ended');

    if (!endedItems || endedItems.length === 0) {
      return NextResponse.json({ message: 'No ended items to resume', count: 0 });
    }

    console.log(`[ListingRefresh Resume] Found ${endedItems.length} ended items to recreate`);

    // Get eBay auth
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const authService = new EbayAuthService(undefined, supabase as any);
    const accessToken = await authService.getAccessToken(USER_ID);
    if (!accessToken) {
      return NextResponse.json({ error: 'eBay auth failed' }, { status: 500 });
    }

    const client = new EbayTradingClient({ accessToken, siteId: 3 });

    let created = 0;
    let failed = 0;
    const results: Array<{ itemId: string; title: string; newItemId?: string; error?: string }> = [];

    for (const item of endedItems) {
      const cachedData = item.cached_listing_data as Record<string, unknown> | null;
      if (!cachedData) {
        failed++;
        results.push({ itemId: item.original_item_id, title: item.original_title || '', error: 'No cached data' });
        continue;
      }

      try {
        const cd = cachedData as Record<string, unknown>;

        // Skip multi-quantity items — cross-platform stock may differ
        const effectiveQty = item.modified_quantity ||
          ((cd.quantitySold as number) > 0
            ? (cd.quantity as number) - (cd.quantitySold as number)
            : (cd.quantity as number));
        if (!item.modified_quantity && effectiveQty > 1) {
          console.log(`[ListingRefresh Resume] Skipping multi-qty item ${item.original_item_id} (qty: ${effectiveQty}) — needs manual review`);
          await supabase
            .from('ebay_listing_refresh_items')
            .update({ status: 'skipped' })
            .eq('id', item.id);
          results.push({ itemId: item.original_item_id, title: item.original_title || '', error: 'Skipped: quantity > 1 needs manual review' });
          continue;
        }

        const addRequest: AddFixedPriceItemRequest = {
          title: (item.modified_title || cd.title) as string,
          description: cd.description as string,
          sku: (cd.sku as string) || undefined,
          startPrice: item.modified_price || (cd.startPrice as number),
          quantity: effectiveQty,
          currency: (cd.currency as string) || 'GBP',
          conditionId: (cd.conditionId as number) || undefined,
          conditionDescription: (cd.conditionDescription as string) || undefined,
          categoryId: cd.categoryId as string,
          storeCategoryId: (cd.storeCategoryId as string) || undefined,
          listingDuration: (cd.listingDuration as string) || 'GTC',
          pictureUrls: (cd.pictureUrls as string[]) || [],
          bestOfferEnabled: (cd.bestOfferEnabled as boolean) || false,
          bestOfferAutoAcceptPrice: (cd.bestOfferAutoAcceptPrice as number) || undefined,
          minimumBestOfferPrice: (cd.minimumBestOfferPrice as number) || undefined,
          shippingProfileId: (cd.shippingProfileId as string) || undefined,
          returnProfileId: (cd.returnProfileId as string) || undefined,
          paymentProfileId: (cd.paymentProfileId as string) || undefined,
          shippingServiceOptions: ((cd.shippingServiceOptions as unknown[]) || []).length > 0
            ? (cd.shippingServiceOptions as AddFixedPriceItemRequest['shippingServiceOptions'])
            : undefined,
          dispatchTimeMax: (cd.dispatchTimeMax as number) || undefined,
          returnsAccepted: (cd.returnsAccepted as boolean) || false,
          returnsWithin: (cd.returnsWithin as string) || undefined,
          refundOption: (cd.refundOption as string) || undefined,
          shippingCostPaidBy: (cd.shippingCostPaidBy as string) || undefined,
          itemSpecifics: ((cd.itemSpecifics as unknown[]) || []).length > 0
            ? (cd.itemSpecifics as Array<{ name: string; value: string }>)
            : undefined,
          ean: (cd.itemSpecifics as Array<{ name: string; value: string }> || []).find((s) => s.name === 'EAN')?.value || undefined,
          upc: (cd.itemSpecifics as Array<{ name: string; value: string }> || []).find((s) => s.name === 'UPC')?.value || undefined,
          isbn: (cd.itemSpecifics as Array<{ name: string; value: string }> || []).find((s) => s.name === 'ISBN')?.value || undefined,
          location: (cd.location as string) || undefined,
          country: (cd.country as string) || undefined,
          postalCode: (cd.postalCode as string) || undefined,
        };

        const result = await client.addFixedPriceItem(addRequest);

        if (result.success && result.itemId) {
          await supabase
            .from('ebay_listing_refresh_items')
            .update({
              status: 'created',
              new_item_id: result.itemId,
              new_listing_url: `https://www.ebay.co.uk/itm/${result.itemId}`,
              new_listing_start_date: result.startTime,
              create_completed_at: new Date().toISOString(),
            })
            .eq('id', item.id);

          // Also update inventory_items
          const { data: inv } = await supabase
            .from('inventory_items')
            .select('id')
            .eq('ebay_listing_id', item.original_item_id)
            .eq('status', 'LISTED')
            .limit(1)
            .single();

          if (inv) {
            await supabase
              .from('inventory_items')
              .update({
                ebay_listing_id: result.itemId,
                listing_date: new Date().toISOString().split('T')[0],
                listing_value: item.modified_price || item.original_price,
                is_refresh: true,
                updated_at: new Date().toISOString(),
              })
              .eq('id', inv.id);
          }

          created++;
          results.push({ itemId: item.original_item_id, title: item.original_title || '', newItemId: result.itemId });
        } else {
          throw new Error(result.errorMessage || 'Failed to create');
        }

        await delay(RATE_LIMIT_DELAY_MS);
      } catch (error) {
        failed++;
        const msg = error instanceof Error ? error.message : 'Unknown error';
        results.push({ itemId: item.original_item_id, title: item.original_title || '', error: msg });

        await supabase
          .from('ebay_listing_refresh_items')
          .update({ status: 'failed', error_phase: 'create', error_message: msg })
          .eq('id', item.id);
      }
    }

    // Update job counts
    await supabase
      .from('ebay_listing_refreshes')
      .update({
        created_count: created,
        failed_count: failed,
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    console.log(`[ListingRefresh Resume] Done: ${created} created, ${failed} failed`);

    return NextResponse.json({
      success: true,
      created,
      failed,
      results,
    });
  } catch (error) {
    console.error('[ListingRefresh Resume] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 }
    );
  }
}
