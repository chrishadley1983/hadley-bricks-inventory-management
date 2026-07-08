import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { TupleDetail, type SummaryCacheRow, type PriceGuideCacheRow, type PovRow } from '@/components/features/brickradar';
import { CredentialsRepository } from '@/lib/repositories';
import { BrickLinkClient } from '@/lib/bricklink';
import type { BrickLinkCredentials } from '@/lib/bricklink';
import { resolveItemName, type CatalogItemType } from '@/lib/bricklink/item-names';

export const dynamic = 'force-dynamic';

/** Sets carry a "-N" catalogPG sequence suffix on L1/L3, but not always what the
 * user types in (or what pg_screen_* rows use) — try the raw value, the bare
 * number, and the bare number + "-1" and let whichever query matches win. */
function itemNoCandidates(itemType: string, rawNo: string): string[] {
  if (itemType !== 'S') return [rawNo];
  const bare = rawNo.replace(/-\d+$/, '');
  return [...new Set([rawNo, `${bare}-1`, bare])];
}

export default async function TuplePage({
  params,
}: {
  params: Promise<{ type: string; no: string; colour: string }>;
}) {
  const { type, no, colour } = await params;
  const itemType = type.toUpperCase();
  const itemNo = decodeURIComponent(no);
  const colourId = Number.parseInt(colour, 10) || 0;

  if (!['P', 'S', 'M'].includes(itemType)) notFound();

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const userId = user.id;

  const candidates = itemNoCandidates(itemType, itemNo);
  const bareSetNo = itemType === 'S' ? itemNo.replace(/-\d+$/, '') : null;

  /**
   * Resolve a human-readable BrickLink catalog name for this one tuple —
   * cache-first (bl_catalog_names), falling back to a live BL API lookup only
   * on a genuine miss. This is the single-item drill-down, so one BL call here
   * is fine (unlike the screen tables, which must never call the API per row —
   * see the page's batched bl_catalog_names lookup instead).
   * Every failure (missing credentials, BL API error, cache read/write) is
   * non-fatal and resolves to null; TupleDetail falls back to a synthesized
   * "Part 3023 in Black" label when this is null.
   */
  async function resolveTupleName(): Promise<string | null> {
    let blClient: BrickLinkClient | null = null;
    try {
      const credentialsRepo = new CredentialsRepository(supabase);
      const credentials = await credentialsRepo.getCredentials<BrickLinkCredentials>(userId, 'bricklink');
      if (credentials) {
        blClient = new BrickLinkClient(credentials, { supabase, caller: 'brickradar-tuple-page' });
      }
    } catch (err) {
      console.warn('[BrickRadar tuple page] BrickLink client init failed (non-fatal):', err);
    }

    try {
      return await resolveItemName(supabase, blClient, itemType as CatalogItemType, itemNo);
    } catch (err) {
      console.warn('[BrickRadar tuple page] resolveItemName failed (non-fatal):', err);
      return null;
    }
  }

  const [l1Res, l3Res, povRes, itemName] = await Promise.all([
    supabase
      .from('bricklink_pg_summary_cache')
      .select('*')
      .eq('item_type', itemType)
      .in('item_no', candidates)
      .eq('colour_id', colourId)
      .limit(1),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not yet in generated Database types
    (supabase as any)
      .from('bricklink_price_guide_cache')
      .select('*')
      .eq('item_type', itemType)
      .in('item_no', candidates)
      .eq('colour_id', colourId)
      .limit(1),
    bareSetNo
      ? supabase
          .from('bricklink_part_out_value_cache')
          .select('*')
          .eq('set_number', bareSetNo)
          .eq('condition', 'N')
          .order('fetched_at', { ascending: false })
          .limit(1)
      : Promise.resolve({ data: [], error: null }),
    resolveTupleName(),
  ]);

  const l1 = ((l1Res.data ?? [])[0] ?? null) as SummaryCacheRow | null;
  const l3 = ((l3Res.error ? [] : (l3Res.data ?? []))[0] ?? null) as PriceGuideCacheRow | null;
  const pov = ((povRes.data ?? [])[0] ?? null) as PovRow | null;

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link href="/brickradar" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to BrickRadar
        </Link>
      </div>

      <TupleDetail itemType={itemType} itemNo={itemNo} colourId={colourId} itemName={itemName} l1={l1} l3={l3} pov={pov} />
    </div>
  );
}
