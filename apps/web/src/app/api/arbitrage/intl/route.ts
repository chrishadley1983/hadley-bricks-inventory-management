/**
 * Intl set-arb purchase view API (intl-set-arb F7).
 * GET: active candidates grouped into per-seller consignment baskets (exact
 * basket math server-side via buildConsignment), plus zone calibration meta.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validateAuth } from '@/lib/api/validate-auth';
import { buildConsignment, type ConsignmentItem } from '@/lib/intl-set-arb/consignment';
import type { ZoneCosts } from '@/lib/intl-set-arb/landed-cost';

export const dynamic = 'force-dynamic';

interface CandRow {
  id: string;
  item_no: string;
  sell_channel: string;
  source_zone: string;
  source_country: string | null;
  source_store_id: number;
  source_store_name: string | null;
  buy_price_gbp: number;
  buy_qty: number;
  weight_g: number | null;
  landed_unit_gbp: number | null;
  sell_price_gbp: number | null;
  sell_net_gbp: number | null;
  net_margin_gbp: number | null;
  net_margin_pct: number | null;
  velocity_drops90: number | null;
  amazon_asin: string | null;
  uk_cheapest_gbp: number | null;
  flags: Record<string, boolean>;
  status: string;
  computed_at: string;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await validateAuth(request);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const channel = request.nextUrl.searchParams.get('channel') ?? 'amazon';
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const [{ data: zonesData, error: zErr }, { data: candsData, error: cErr }, { data: names }] = await Promise.all([
      supabase.from('bl_import_zone_costs').select('*'),
      supabase.from('bl_set_arb_candidates').select('*').eq('sell_channel', channel).eq('status', 'active').limit(5000),
      supabase.from('bl_catalog_items').select('item_no,item_name').eq('item_type', 'S').limit(1), // names fetched per-basket below
    ]);
    void names;
    if (zErr) throw new Error(zErr.message);
    if (cErr) throw new Error(cErr.message);
    const zones = (zonesData ?? []) as ZoneCosts[];
    const cands = (candsData ?? []) as CandRow[];

    // set names for everything on view
    const setNos = [...new Set(cands.map((c) => (c.item_no.includes('-') ? c.item_no : `${c.item_no}-1`)))];
    const nameBy = new Map<string, string>();
    for (let i = 0; i < setNos.length; i += 300) {
      const { data } = await supabase.from('bl_catalog_items')
        .select('item_no,item_name').eq('item_type', 'S').in('item_no', setNos.slice(i, i + 300));
      for (const r of (data ?? []) as { item_no: string; item_name: string }[]) nameBy.set(r.item_no, r.item_name);
    }

    const byStore = new Map<number, CandRow[]>();
    for (const c of cands) {
      if (!byStore.has(c.source_store_id)) byStore.set(c.source_store_id, []);
      byStore.get(c.source_store_id)!.push(c);
    }

    const baskets = [...byStore.entries()].map(([storeId, items]) => {
      const zone = zones.find((z) => z.zone === items[0].source_zone);
      const cItems: (ConsignmentItem & { row: CandRow })[] = items
        .filter((c) => c.weight_g != null)
        .map((c) => ({
          itemNo: c.item_no,
          buyPriceGbp: Number(c.buy_price_gbp),
          weightG: Number(c.weight_g),
          sellNetGbp: c.sell_net_gbp == null ? null : Number(c.sell_net_gbp),
          qty: 1,
          row: c,
        }));
      if (!zone || cItems.length === 0) return null;
      const b = buildConsignment(zone, cItems);
      const velocities = items.map((i) => i.velocity_drops90 ?? 0);
      return {
        storeId,
        storeName: items[0].source_store_name,
        country: items[0].source_country,
        zone: zone.zone,
        calibrated: zone.calibrated_at != null,
        sets: cItems.length,
        breakdown: {
          itemsGbp: b.itemsGbp, shippingGbp: b.shippingGbp, dutyGbp: b.dutyGbp,
          vatGbp: b.vatGbp, handlingGbp: b.handlingGbp, landedGbp: b.landedGbp,
          sellNetGbp: b.sellNetGbp, netMarginGbp: b.netMarginGbp, netMarginPct: b.netMarginPct,
          clearsFloor: b.clearsFloor, totalWeightG: b.totalWeightG,
        },
        velocitySum: velocities.reduce((a, v) => a + v, 0),
        items: b.perItem.map((pi, idx) => {
          const row = cItems[idx].row;
          const norm = row.item_no.includes('-') ? row.item_no : `${row.item_no}-1`;
          return {
            candidateId: row.id,
            itemNo: row.item_no,
            name: nameBy.get(norm) ?? null,
            buyGbp: pi.buyPriceGbp,
            landedShareGbp: pi.landedShareGbp,
            sellGbp: row.sell_price_gbp,
            sellNetGbp: row.sell_net_gbp,
            marginGbp: pi.itemMarginGbp,
            drops90: row.velocity_drops90,
            asin: row.amazon_asin,
            ukCheapestGbp: row.uk_cheapest_gbp,
            weightG: row.weight_g,
            flags: row.flags,
          };
        }),
      };
    }).filter((x): x is NonNullable<typeof x> => x != null);

    baskets.sort((a, b) => b.breakdown.netMarginGbp - a.breakdown.netMarginGbp);

    const lastComputed = cands.reduce<string | null>((m, c) => (m == null || c.computed_at > m ? c.computed_at : m), null);
    return NextResponse.json({
      channel,
      baskets,
      meta: {
        candidates: cands.length,
        sellers: baskets.length,
        lastComputed,
        zones: zones.map((z) => ({ zone: z.zone, calibrated: z.calibrated_at != null })),
      },
    });
  } catch (e) {
    console.error('[api/arbitrage/intl] GET failed:', e);
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}

/** PATCH: update a candidate's status (exclude / bought / restore to active). */
export async function PATCH(request: NextRequest) {
  try {
    const auth = await validateAuth(request);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = (await request.json()) as { candidateId?: string; status?: string };
    if (!body.candidateId || !['active', 'excluded', 'bought'].includes(body.status ?? '')) {
      return NextResponse.json({ error: 'candidateId and status(active|excluded|bought) required' }, { status: 400 });
    }
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { error } = await supabase.from('bl_set_arb_candidates')
      .update({ status: body.status }).eq('id', body.candidateId);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[api/arbitrage/intl] PATCH failed:', e);
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
