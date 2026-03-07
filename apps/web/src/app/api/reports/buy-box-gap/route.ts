/**
 * GET /api/reports/buy-box-gap
 *
 * Returns buy box gap data from cached DB tables:
 * - tracked_asins: your price, quantity, name
 * - amazon_arbitrage_pricing: buy box price, sales rank, offer count
 * - inventory_items: COG (purchase cost)
 * - asin_bricklink_mapping: set number
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Amazon FBM UK fee constants
const REFERRAL_FEE_RATE = 0.15;
const DST_RATE = 0.02;
const VAT_RATE = 0.2;
const SHIPPING_THRESHOLD = 14.0;
const SHIPPING_COST_LOW = 3.0;
const SHIPPING_COST_HIGH = 4.0;

interface ProfitBreakdown {
  salePrice: number;
  productCost: number;
  totalAmazonFee: number;
  shippingCost: number;
  totalProfit: number;
  profitMarginPercent: number;
}

function calculateProfit(salePrice: number, productCost: number): ProfitBreakdown | null {
  if (salePrice <= 0 || productCost <= 0) return null;
  const referralFee = salePrice * REFERRAL_FEE_RATE;
  const dst = referralFee * DST_RATE;
  const vatOnFees = (referralFee + dst) * VAT_RATE;
  const totalAmazonFee = referralFee + dst + vatOnFees;
  const shippingCost = salePrice < SHIPPING_THRESHOLD ? SHIPPING_COST_LOW : SHIPPING_COST_HIGH;
  const netPayout = salePrice - totalAmazonFee - shippingCost;
  const totalProfit = netPayout - productCost;
  return {
    salePrice,
    productCost,
    totalAmazonFee,
    shippingCost,
    totalProfit,
    profitMarginPercent: (totalProfit / salePrice) * 100,
  };
}

export interface BuyBoxGapRow {
  asin: string;
  name: string;
  setNumber: string | null;
  yourPrice: number;
  yourQty: number;
  buyBoxPrice: number;
  gapAbsolute: number;
  gapPercent: number;
  inventoryCost: number | null;
  costItemCount: number;
  salesRank: number | null;
  offerCount: number | null;
  profitAtBuyBox: ProfitBreakdown | null;
  profitAtYourPrice: ProfitBreakdown | null;
  priceSource: 'buy_box' | 'was90d' | 'cached';
  buyBoxIsYours: boolean;
  snapshotDate: string | null;
}

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Step 1: Get in-stock ASINs from tracked_asins
    const allTracked: Array<{
      asin: string;
      name: string | null;
      price: number | null;
      quantity: number;
    }> = [];
    const pageSize = 500;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from('tracked_asins')
        .select('asin, name, price, quantity')
        .eq('status', 'active')
        .gt('quantity', 0)
        .range(offset, offset + pageSize - 1);

      if (error) throw new Error(`tracked_asins query: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const row of data) {
        allTracked.push({
          asin: row.asin,
          name: row.name,
          price: row.price,
          quantity: row.quantity ?? 0,
        });
      }
      hasMore = data.length === pageSize;
      offset += pageSize;
    }

    if (allTracked.length === 0) {
      return NextResponse.json({ data: { items: [], summary: { totalInStock: 0, losingBuyBox: 0, winningBuyBox: 0, matchBB: 0, review: 0, loss: 0, noCost: 0, avgGap: 0, totalGapValue: 0 } } });
    }

    const asinList = allTracked.map((t) => t.asin);

    // Step 2: Get buy box prices from amazon_arbitrage_pricing (latest snapshot per ASIN)
    const buyBoxMap = new Map<string, { buyBoxPrice: number | null; salesRank: number | null; offerCount: number | null; buyBoxIsYours: boolean; snapshotDate: string | null }>();
    for (let i = 0; i < asinList.length; i += 500) {
      const batch = asinList.slice(i, i + 500);
      // Paginate to handle >1,000 rows (multiple snapshots per ASIN)
      let bbOffset = 0;
      const bbPageSize = 1000;
      let bbHasMore = true;
      while (bbHasMore) {
        const { data } = await supabase
          .from('amazon_arbitrage_pricing')
          .select('asin, buy_box_price, sales_rank, offer_count, buy_box_is_yours, snapshot_date')
          .in('asin', batch)
          .order('snapshot_date', { ascending: false })
          .range(bbOffset, bbOffset + bbPageSize - 1);

        if (!data || data.length === 0) break;
        for (const row of data) {
          if (!buyBoxMap.has(row.asin)) {
            buyBoxMap.set(row.asin, {
              buyBoxPrice: row.buy_box_price ? Number(row.buy_box_price) : null,
              salesRank: row.sales_rank,
              offerCount: row.offer_count,
              buyBoxIsYours: row.buy_box_is_yours ?? false,
              snapshotDate: row.snapshot_date,
            });
          }
        }
        // Once we have all ASINs in this batch mapped, no need for more pages
        if (buyBoxMap.size >= asinList.length || data.length < bbPageSize) {
          bbHasMore = false;
        } else {
          bbOffset += bbPageSize;
        }
      }
    }

    // Step 3: Get set numbers
    const setMap = new Map<string, string>();
    for (let i = 0; i < asinList.length; i += 500) {
      const batch = asinList.slice(i, i + 500);
      const { data } = await supabase
        .from('asin_bricklink_mapping')
        .select('asin, bricklink_set_number')
        .in('asin', batch);

      if (data) {
        for (const row of data) {
          setMap.set(row.asin, row.bricklink_set_number);
        }
      }
    }

    // Step 4: Get inventory costs
    const costMap = new Map<string, number[]>();
    for (let i = 0; i < asinList.length; i += 500) {
      const batch = asinList.slice(i, i + 500);
      const { data } = await supabase
        .from('inventory_items')
        .select('amazon_asin, cost')
        .in('amazon_asin', batch)
        .not('cost', 'is', null)
        .in('status', ['LISTED', 'BACKLOG', 'listed', 'in_stock', 'backlog']);

      if (data) {
        for (const row of data) {
          if (!row.amazon_asin || row.cost === null) continue;
          const cost = Number(row.cost);
          if (cost <= 0) continue;
          if (!costMap.has(row.amazon_asin)) costMap.set(row.amazon_asin, []);
          costMap.get(row.amazon_asin)!.push(cost);
        }
      }
    }

    // Step 5: Build gap items
    const items: BuyBoxGapRow[] = [];
    let winningCount = 0;

    for (const tracked of allTracked) {
      const bb = buyBoxMap.get(tracked.asin);
      if (!bb || bb.buyBoxPrice === null) continue;

      const yourPrice = tracked.price ? Number(tracked.price) : 0;
      if (yourPrice <= 0) continue;

      if (bb.buyBoxIsYours) {
        winningCount++;
        continue;
      }

      const gapAbsolute = yourPrice - bb.buyBoxPrice;
      const gapPercent = yourPrice > 0 ? (gapAbsolute / yourPrice) * 100 : 0;

      const costs = costMap.get(tracked.asin);
      const avgCost = costs && costs.length > 0
        ? costs.reduce((a, b) => a + b, 0) / costs.length
        : null;

      items.push({
        asin: tracked.asin,
        name: tracked.name ?? 'Unknown',
        setNumber: setMap.get(tracked.asin) ?? null,
        yourPrice,
        yourQty: tracked.quantity,
        buyBoxPrice: bb.buyBoxPrice,
        gapAbsolute,
        gapPercent,
        inventoryCost: avgCost,
        costItemCount: costs?.length ?? 0,
        salesRank: bb.salesRank,
        offerCount: bb.offerCount,
        profitAtBuyBox: avgCost ? calculateProfit(bb.buyBoxPrice, avgCost) : null,
        profitAtYourPrice: avgCost ? calculateProfit(yourPrice, avgCost) : null,
        priceSource: 'cached',
        buyBoxIsYours: false,
        snapshotDate: bb.snapshotDate,
      });
    }

    // Sort by gap (biggest first)
    items.sort((a, b) => b.gapAbsolute - a.gapAbsolute);

    const matchBB = items.filter((i) => i.profitAtBuyBox && i.profitAtBuyBox.profitMarginPercent >= 15).length;
    const review = items.filter((i) => i.profitAtBuyBox && i.profitAtBuyBox.profitMarginPercent >= 5 && i.profitAtBuyBox.profitMarginPercent < 15).length;
    const loss = items.filter((i) => i.profitAtBuyBox && i.profitAtBuyBox.profitMarginPercent < 5).length;
    const avgGap = items.length > 0 ? items.reduce((sum, i) => sum + i.gapAbsolute, 0) / items.length : 0;
    const totalGapValue = items.reduce((sum, i) => sum + i.gapAbsolute * i.yourQty, 0);

    return NextResponse.json({
      data: {
        items,
        summary: {
          totalInStock: allTracked.length,
          losingBuyBox: items.length,
          winningBuyBox: winningCount,
          matchBB,
          review,
          loss,
          noCost: items.filter((i) => i.inventoryCost === null).length,
          avgGap: Math.round(avgGap * 100) / 100,
          totalGapValue: Math.round(totalGapValue * 100) / 100,
        },
      },
    });
  } catch (error) {
    console.error('[GET /api/reports/buy-box-gap] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
