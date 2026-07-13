/**
 * Identity enrichment — re-derive brickset_sets.amazon_asin authoritatively from
 * barcodes via Keepa (Amazon-UK, domain 2), stamping the provenance columns added in
 * migration 20260713170000. Barcode match (EAN=conf 100 / UPC=95) OVERWRITES any prior
 * title-guessed ASIN. Also backfills/repairs the set's ean/upc from Keepa's eanList
 * (fixes the 11-digit leading-zero-stripped values authoritatively).
 *
 * Keepa: 100 codes/request, ~1 token per matched product. Budget-aware + resumable.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/enrich-brickset-identity.ts --limit=200 --dry-run
 *   npx tsx scripts/enrich-brickset-identity.ts --max-tokens=8000
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { KeepaClient } from '../src/lib/keepa/keepa-client';

dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const argv = process.argv.slice(2).reduce<Record<string, string>>((a, s) => { const [k, v] = s.replace(/^--/, '').split('='); a[k] = v ?? 'true'; return a; }, {});
const LIMIT = parseInt(argv['limit'] ?? '0', 10);          // 0 = all eligible
const DRY_RUN = argv['dry-run'] === 'true';
const MAX_TOKENS = parseInt(argv['max-tokens'] ?? '15000', 10);
const BATCH = 100;

const isLego = (t: string | undefined | null) => !!t && /lego/i.test(t);
const pad12 = (s: string) => (s.length === 11 ? '0' + s : s); // recover leading-zero-stripped UPC

interface SetRow { id: string; set_number: string; ean: string | null; upc: string | null; }

async function eligibleSets(): Promise<SetRow[]> {
  // barcoded sets that are NOT yet barcode-verified (need an authoritative ASIN)
  const out: SetRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('brickset_sets')
      .select('id,set_number,ean,upc,asin_source,asin_confidence')
      .or('ean.not.is.null,upc.not.is.null')
      .order('set_number')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const r of data as any[]) {
      const barcodeVerified = (r.asin_confidence ?? 0) >= 95 && /^(keepa|spapi)_/.test(r.asin_source ?? '');
      if (!barcodeVerified) out.push({ id: r.id, set_number: r.set_number, ean: r.ean, upc: r.upc });
    }
    if (data.length < PAGE) break;
    if (LIMIT && out.length >= LIMIT) break;
  }
  return LIMIT ? out.slice(0, LIMIT) : out;
}

async function main() {
  const keepa = new KeepaClient();
  if (!keepa.isConfigured()) throw new Error('KEEPA_API_KEY not set');

  const sets = await eligibleSets();
  console.log(`[enrich] ${sets.length} barcoded set(s) needing authoritative ASIN${DRY_RUN ? ' (DRY RUN)' : ''}`);

  let tokensUsed = 0, matched = 0, written = 0, barcodeFixed = 0, changedAsin = 0;
  for (let i = 0; i < sets.length; i += BATCH) {
    if (tokensUsed >= MAX_TOKENS) { console.log(`[enrich] token budget ${MAX_TOKENS} reached — stopping (resume by re-running)`); break; }
    const batch = sets.slice(i, i + BATCH);
    // one lookup per set: prefer EAN, else UPC; remember which barcode we queried
    const codeToSet = new Map<string, SetRow>();
    for (const s of batch) {
      const code = pad12(s.ean ?? '') || pad12(s.upc ?? '');
      if (code) codeToSet.set(code, s);
    }
    const codes = [...codeToSet.keys()];
    let products: any[] = [];
    try { products = await keepa.searchByCode(codes); }
    catch (e) {
      const msg = (e as Error).message;
      // Token bucket drained → stop cleanly and resume next run (don't spin in 60s
      // refill-waits until the process is killed). Everything written so far persists.
      if (/429|Too Many Requests|rate limit/i.test(msg)) {
        console.log(`[enrich] Keepa tokens exhausted — pausing cleanly at ${i}/${sets.length}. Re-run to resume.`);
        break;
      }
      console.error(`[enrich] batch ${i / BATCH} keepa error: ${msg}`); continue;
    }
    tokensUsed += products.length;

    // index products by every barcode they carry
    const byCode = new Map<string, any>();
    for (const p of products) for (const e of (p.eanList ?? [])) byCode.set(String(e), p);

    const updates: any[] = [];
    for (const [code, s] of codeToSet) {
      const p = byCode.get(code);
      if (!p || !p.asin || !isLego(p.title)) continue;
      matched++;
      const usedUpc = !s.ean; // matched via the upc field
      const row: any = {
        id: s.id, amazon_asin: p.asin, has_amazon_listing: true,
        asin_source: usedUpc ? 'keepa_upc' : 'keepa_ean',
        asin_confidence: usedUpc ? 95 : 100,
        asin_verified_at: new Date().toISOString(),
      };
      // authoritative barcode repair from Keepa's eanList (fixes 11-digit values)
      const eanFromKeepa = (p.eanList ?? []).find((e: string) => String(e).length === 13);
      if (eanFromKeepa && eanFromKeepa !== s.ean) { row.ean = String(eanFromKeepa); row.barcode_source = 'keepa'; barcodeFixed++; }
      updates.push(row);
    }
    if (!DRY_RUN && updates.length) {
      for (const u of updates) {
        const { error } = await supabase.from('brickset_sets').update(u).eq('id', u.id);
        if (error) { console.error(`[enrich] write ${u.id}: ${error.message}`); continue; }
        written++;
      }
    }
    if ((i / BATCH) % 5 === 0) console.log(`[enrich] ${i + batch.length}/${sets.length} done · matched ${matched} · tokens ${tokensUsed} · left ${keepa.getTokensLeft?.() ?? '?'}`);
  }
  console.log(`\n[enrich] DONE${DRY_RUN ? ' (dry-run, no writes)' : ''}: matched ${matched}, written ${written}, barcodes repaired ${barcodeFixed}, tokens used ${tokensUsed}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
