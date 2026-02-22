/**
 * One-time fix endpoint: updates existing published minifigure listings
 * to set correct Brand, Country of Origin, and Category on eBay.
 *
 * Auth: accepts cookie session OR x-service-role-key header for CLI use.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { EbayApiAdapter } from '@/lib/ebay/ebay-api.adapter';
import { ebayAuthService, EbayAuthService } from '@/lib/ebay/ebay-auth.service';
import type { EbayInventoryItem, EbayConditionEnum } from '@/lib/ebay/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const CORRECT_CATEGORY_ID = '263012';

interface FixResult {
  itemId: string;
  sku: string;
  name: string | null;
  inventoryUpdated: boolean;
  offerUpdated: boolean;
  dbUpdated: boolean;
  error?: string;
}

export async function POST(request: NextRequest) {
  try {
    // Auth: try cookie session first, fall back to service role key header
    let userId: string;
    let supabase: ReturnType<typeof createServiceRoleClient>;
    let ebayAuth: EbayAuthService;

    const serviceRoleHeader = request.headers.get('x-service-role-key');
    if (serviceRoleHeader && serviceRoleHeader === process.env.SUPABASE_SERVICE_ROLE_KEY) {
      // Service role auth - look up the single user with published minifigs
      supabase = createServiceRoleClient();
      ebayAuth = new EbayAuthService(undefined, supabase);
      const { data: userRow } = await supabase
        .from('minifig_sync_items')
        .select('user_id')
        .eq('listing_status', 'PUBLISHED')
        .limit(1)
        .single();
      if (!userRow) {
        return NextResponse.json({ error: 'No published minifig items found' }, { status: 404 });
      }
      userId = userRow.user_id;
    } else {
      // Cookie-based auth
      const cookieClient = await createClient();
      const {
        data: { user },
        error: authError,
      } = await cookieClient.auth.getUser();
      if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      userId = user.id;
      supabase = createServiceRoleClient();
      ebayAuth = ebayAuthService;
    }

    // Get eBay access token
    const accessToken = await ebayAuth.getAccessToken(userId);
    if (!accessToken) {
      return NextResponse.json(
        { error: 'eBay credentials not configured or token expired' },
        { status: 400 }
      );
    }

    const adapter = new EbayApiAdapter({
      accessToken,
      marketplaceId: 'EBAY_GB',
      userId,
    });

    // Query all PUBLISHED minifig items (paginated)
    const items: Array<Record<string, unknown>> = [];
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;
    while (hasMore) {
      const { data } = await supabase
        .from('minifig_sync_items')
        .select('*')
        .eq('user_id', userId)
        .eq('listing_status', 'PUBLISHED')
        .range(page * pageSize, (page + 1) * pageSize - 1);
      items.push(...(data ?? []));
      hasMore = (data?.length ?? 0) === pageSize;
      page++;
    }

    const results: FixResult[] = [];

    for (const item of items) {
      const result: FixResult = {
        itemId: item.id as string,
        sku: (item.ebay_sku as string) || '',
        name: (item.name as string) || null,
        inventoryUpdated: false,
        offerUpdated: false,
        dbUpdated: false,
      };

      try {
        const sku = item.ebay_sku as string;
        const offerId = item.ebay_offer_id as string;
        if (!sku || !offerId) {
          result.error = `Missing sku (${sku}) or offerId (${offerId})`;
          results.push(result);
          continue;
        }

        // Fix aspects: ensure Brand and Country/Region of Manufacture
        const currentAspects = (item.ebay_aspects as Record<string, string[]>) || {};
        const fixedAspects = { ...currentAspects };
        fixedAspects['Brand'] = ['LEGO'];
        fixedAspects['Country/Region of Manufacture'] = ['Denmark'];

        // Build inventory item from DB values (same pattern as syncInventoryItemToEbay)
        const images = item.images as Array<{ url: string }> | null;
        const imageUrls = images?.map((img) => img.url) ?? [];

        const inventoryItem: EbayInventoryItem = {
          product: {
            title: (item.ebay_title as string) || (item.name as string) || '',
            description: (item.ebay_description as string) || '',
            ...(imageUrls.length > 0 && { imageUrls }),
            aspects: fixedAspects,
          },
          condition: ((item.ebay_condition as string) || 'USED_EXCELLENT') as EbayConditionEnum,
          conditionDescription:
            (item.ebay_condition_description as string) ||
            (item.condition_notes as string) ||
            'Used, complete - in excellent condition',
          availability: {
            shipToLocationAvailability: { quantity: 1 },
          },
        };

        // Update inventory item on eBay
        await adapter.createOrReplaceInventoryItem(sku, inventoryItem);
        result.inventoryUpdated = true;

        // Update offer category on eBay - build clean body from known fields only
        try {
          const offer = await adapter.getOffer(offerId);

          const price = Number(item.recommended_price) || 0;
          const autoAccept = Number(item.best_offer_auto_accept) || Math.round(price * 0.95 * 100) / 100;
          const autoDecline = Number(item.best_offer_auto_decline) || Math.round(price * 0.75 * 100) / 100;

          // Strip listingPolicies to only known fields (response may include extras)
          const cleanPolicies = offer.listingPolicies ? {
            fulfillmentPolicyId: offer.listingPolicies.fulfillmentPolicyId,
            paymentPolicyId: offer.listingPolicies.paymentPolicyId,
            returnPolicyId: offer.listingPolicies.returnPolicyId,
          } : undefined;

          const updateBody = {
            sku,
            marketplaceId: 'EBAY_GB',
            format: 'FIXED_PRICE' as const,
            availableQuantity: 1,
            categoryId: CORRECT_CATEGORY_ID,
            listingDescription: (item.ebay_description as string) || offer.listingDescription || '',
            merchantLocationKey: offer.merchantLocationKey,
            listingPolicies: cleanPolicies,
            pricingSummary: {
              price: { value: price.toFixed(2), currency: 'GBP' },
            },
            bestOffer: {
              bestOfferEnabled: true,
              autoAcceptPrice: { value: autoAccept.toFixed(2), currency: 'GBP' },
              autoDeclinePrice: { value: autoDecline.toFixed(2), currency: 'GBP' },
            },
          };
          await adapter.updateOffer(offerId, updateBody);
          result.offerUpdated = true;
        } catch (offerErr) {
          result.error = `Inventory updated but offer update failed: ${offerErr instanceof Error ? offerErr.message : String(offerErr)}`;
        }

        // Update DB
        await supabase
          .from('minifig_sync_items')
          .update({
            ebay_aspects: fixedAspects,
            ebay_category_id: CORRECT_CATEGORY_ID,
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id as string)
          .eq('user_id', userId);
        result.dbUpdated = true;
      } catch (err) {
        result.error = err instanceof Error ? err.message : String(err);
      }

      results.push(result);
    }

    const summary = {
      total: results.length,
      fullyFixed: results.filter((r) => r.inventoryUpdated && r.offerUpdated && r.dbUpdated)
        .length,
      errors: results.filter((r) => r.error).length,
    };

    return NextResponse.json({ summary, results });
  } catch (error) {
    console.error('[POST /api/minifigs/sync/fix-listings] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fix listings', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
