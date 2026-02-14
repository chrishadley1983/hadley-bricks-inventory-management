/**
 * POST /api/purchases/review-queue/[id]/approve
 *
 * Approve a skipped email purchase by providing one or more set numbers (bundle support).
 * Enriches each item with Brickset lookup, ASIN, Amazon pricing, then creates
 * 1 purchase + N inventory records with proportional cost allocation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

const ApproveItemSchema = z.object({
  set_number: z.string().min(1, 'Set number is required'),
  condition: z.enum(['New', 'Used']).optional().default('New'),
});

const ApproveSchema = z.object({
  items: z.array(ApproveItemSchema).min(1, 'At least one item is required').max(10),
});

/** Make an authenticated internal API call for enrichment */
async function internalFetch(path: string): Promise<Response> {
  const serviceApiKey = process.env.SERVICE_API_KEY;
  if (!serviceApiKey) {
    throw new Error('SERVICE_API_KEY environment variable is not set');
  }

  // Use production URL to avoid Vercel deployment protection on preview URLs
  const baseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

  return fetch(`${baseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': serviceApiKey,
    },
  });
}

interface EnrichedItem {
  set_number: string;
  condition: 'New' | 'Used';
  set_name: string;
  amazon_asin: string | undefined;
  list_price: number | undefined;
}

/** Enrich a single item with ASIN, name (from ASIN title or Brickset), and Amazon pricing */
async function enrichItem(
  setNumber: string,
  condition: 'New' | 'Used'
): Promise<EnrichedItem> {
  let setName = setNumber; // Fallback to set number, never use bundle name
  let amazonAsin: string | undefined;
  let listPrice: number | undefined;

  // ASIN lookup (also returns title which is a good name source)
  try {
    const asinResponse = await internalFetch(
      `/api/service/inventory/lookup-asin?setNumber=${encodeURIComponent(setNumber)}`
    );
    if (asinResponse.ok) {
      const asinData = await asinResponse.json();
      amazonAsin = asinData.data?.asin;
      // Use ASIN title as name if available (more reliable than Brickset)
      if (asinData.data?.title) {
        setName = asinData.data.title;
      }
    } else {
      console.warn(`[enrichItem] ASIN lookup failed for ${setNumber}: ${asinResponse.status}`);
    }
  } catch (err) {
    console.warn(`[enrichItem] ASIN lookup error for ${setNumber}:`, err);
  }

  // Brickset lookup (overrides ASIN title if available - cleaner names)
  try {
    const bricksetResponse = await internalFetch(
      `/api/service/brickset/lookup?setNumber=${encodeURIComponent(setNumber)}`
    );
    if (bricksetResponse.ok) {
      const bricksetData = await bricksetResponse.json();
      if (bricksetData.data?.name) {
        setName = bricksetData.data.name;
      }
    }
  } catch {
    // Brickset is optional - ASIN title or set_number used as fallback
  }

  // Amazon pricing
  if (amazonAsin) {
    try {
      const pricingResponse = await internalFetch(
        `/api/service/amazon/competitive-summary?asins=${encodeURIComponent(amazonAsin)}`
      );
      if (pricingResponse.ok) {
        const pricingData = await pricingResponse.json();
        const asinPricing = pricingData.data?.[amazonAsin];
        listPrice = asinPricing?.buyBoxPrice ?? asinPricing?.lowestNewPrice;
      } else {
        console.warn(`[enrichItem] Amazon pricing failed for ${amazonAsin}: ${pricingResponse.status}`);
      }
    } catch (err) {
      console.warn(`[enrichItem] Amazon pricing error for ${amazonAsin}:`, err);
    }
  }

  return { set_number: setNumber, condition, set_name: setName, amazon_asin: amazonAsin, list_price: listPrice };
}

/** Allocate total cost across items proportionally by list_price, or equal split as fallback */
function allocateCosts(enrichedItems: EnrichedItem[], totalCost: number): number[] {
  const allHavePricing = enrichedItems.every((item) => item.list_price != null && item.list_price > 0);

  if (allHavePricing) {
    const totalListPrice = enrichedItems.reduce((sum, item) => sum + (item.list_price ?? 0), 0);
    return enrichedItems.map((item) => {
      const proportion = (item.list_price ?? 0) / totalListPrice;
      return Math.round(proportion * totalCost * 100) / 100;
    });
  }

  // Equal split fallback
  const perItem = Math.round((totalCost / enrichedItems.length) * 100) / 100;
  return enrichedItems.map(() => perItem);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Validate input
    const body = await request.json();
    const parsed = ApproveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { items } = parsed.data;
    const serviceSupabase = createServiceRoleClient();

    // Fetch the skipped email record
    const { data: emailRecord, error: fetchError } = await serviceSupabase
      .from('processed_purchase_emails')
      .select('*')
      .eq('id', id)
      .eq('status', 'skipped')
      .single();

    if (fetchError || !emailRecord) {
      return NextResponse.json(
        { error: 'Review item not found or already processed' },
        { status: 404 }
      );
    }

    // Enrich all items in parallel (ASIN lookup, Brickset name, Amazon pricing)
    const enrichedItems = await Promise.all(
      items.map((item) => enrichItem(item.set_number, item.condition))
    );

    // Cost allocation
    const totalCost = emailRecord.cost ? Number(emailRecord.cost) : 0;
    const allocatedCosts = allocateCosts(enrichedItems, totalCost);

    // Build purchase description
    const setNumberList = enrichedItems.map((i) => i.set_number).join(', ');
    const setNameList = enrichedItems.map((i) => `${i.set_number} ${i.set_name}`).join(', ');
    const sellerUsername = emailRecord.seller_username || emailRecord.source;
    const purchaseDate = emailRecord.email_date
      ? new Date(emailRecord.email_date).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    // Create 1 purchase record
    const { data: purchase, error: purchaseError } = await serviceSupabase
      .from('purchases')
      .insert({
        user_id: user.id,
        source: emailRecord.source,
        cost: totalCost,
        payment_method: emailRecord.source === 'Vinted' ? 'Vinted Wallet' : 'PayPal',
        purchase_date: purchaseDate,
        short_description: items.length === 1
          ? `${enrichedItems[0].set_number} ${enrichedItems[0].set_name}`
          : `Bundle: ${setNumberList}`,
        description: items.length === 1
          ? `${enrichedItems[0].set_name} from ${sellerUsername}`
          : `${setNameList} from ${sellerUsername}`,
        reference: emailRecord.order_reference,
      })
      .select('id')
      .single();

    if (purchaseError || !purchase) {
      return NextResponse.json(
        { error: `Failed to create purchase: ${purchaseError?.message}` },
        { status: 500 }
      );
    }

    // Get max SKU number once (shared across all items)
    const { data: skuRows } = await serviceSupabase
      .from('inventory_items')
      .select('sku')
      .not('sku', 'is', null)
      .order('created_at', { ascending: false })
      .limit(200);

    let maxNum = 0;
    if (skuRows) {
      for (const row of skuRows) {
        const match = row.sku?.match(/^[NU](\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxNum) maxNum = num;
        }
      }
    }

    // Create N inventory items
    const createdInventoryIds: string[] = [];
    const resultItems: Array<{
      inventory_id: string;
      set_number: string;
      set_name: string;
      allocated_cost: number;
      list_price: number | null;
      roi_percent: number | null;
      amazon_asin: string | null;
    }> = [];

    for (let i = 0; i < enrichedItems.length; i++) {
      const enriched = enrichedItems[i];
      const itemCost = allocatedCosts[i];
      const skuPrefix = enriched.condition === 'New' ? 'N' : 'U';
      const newSku = `${skuPrefix}${maxNum + 1 + i}`;

      const { data: inventory, error: inventoryError } = await serviceSupabase
        .from('inventory_items')
        .insert({
          user_id: user.id,
          set_number: enriched.set_number,
          item_name: enriched.set_name,
          condition: enriched.condition,
          cost: itemCost,
          purchase_id: purchase.id,
          linked_lot: emailRecord.order_reference,
          source: emailRecord.source,
          purchase_date: purchaseDate,
          listing_platform: 'amazon',
          storage_location: 'TBC',
          amazon_asin: enriched.amazon_asin,
          listing_value: enriched.list_price,
          sku: newSku,
          status: 'Not Yet Received',
          notes: `Imported from review queue. Seller: ${sellerUsername}. https://mail.google.com/mail/u/0/#all/${emailRecord.email_id}`,
        })
        .select('id')
        .single();

      if (inventoryError || !inventory) {
        // Rollback: delete all created inventory items + purchase
        for (const createdId of createdInventoryIds) {
          await serviceSupabase.from('inventory_items').delete().eq('id', createdId);
        }
        await serviceSupabase.from('purchases').delete().eq('id', purchase.id);
        return NextResponse.json(
          { error: `Failed to create inventory for ${enriched.set_number}: ${inventoryError?.message}` },
          { status: 500 }
        );
      }

      createdInventoryIds.push(inventory.id);

      // Calculate ROI for this item
      let roiPercent: number | null = null;
      if (enriched.list_price && itemCost > 0) {
        const estimatedNetRevenue = enriched.list_price * 0.85;
        const profit = estimatedNetRevenue - itemCost;
        roiPercent = Math.round((profit / itemCost) * 100);
      }

      resultItems.push({
        inventory_id: inventory.id,
        set_number: enriched.set_number,
        set_name: enriched.set_name,
        allocated_cost: itemCost,
        list_price: enriched.list_price ?? null,
        roi_percent: roiPercent,
        amazon_asin: enriched.amazon_asin ?? null,
      });
    }

    // Update processed email record to imported
    await serviceSupabase
      .from('processed_purchase_emails')
      .update({
        status: 'imported',
        purchase_id: purchase.id,
        // Don't set inventory_id for bundles (multiple items)
        ...(createdInventoryIds.length === 1 ? { inventory_id: createdInventoryIds[0] } : {}),
      })
      .eq('id', id);

    return NextResponse.json({
      data: {
        purchase_id: purchase.id,
        items: resultItems,
      },
    });
  } catch (error) {
    console.error('[POST /api/purchases/review-queue/[id]/approve] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
