/**
 * Part-out lot toolkit — one CLI for the buy-lot part-out workflow.
 *
 *   npx tsx scripts/partout/partout.ts <command> [flags]
 *
 *   screen     --lot="43020:75,31171:25,..."   Fast cached-POV screen of a whole
 *                (or --file=lot.json)           seller lot. Zero BrickLink calls.
 *   count      --sets=43020,31171,76321         Exact API-call preflight to ground
 *                [--ttl=180]                     N sets, with a TTL-sensitivity table.
 *   ground     --lot="43020:75,..."             Full grounding: BOM -> fetch only
 *                (or --sets=...) [--new] [--top=15]  uncached PGs -> canonical v4
 *                                                Bricqer per lot. Writes a rows file.
 *   breakdown  --rows=<rows.json> [--set=43020] STR brackets, New-vs-Dup (vs your
 *                                                live store), New-vs-Used. Zero calls.
 *
 * See ~/.claude/skills/lego-partout/SKILL.md for the workflow + how to read the numbers.
 */
import * as path from 'path';
import * as fs from 'fs';
import {
  clients, fetchBoms, readViews, fetchUncached, valueLot, keyOf, blColour, normSet, bareSet,
  parseArgs, parseLot, table, gbp, POV_TTL_DAYS, CACHE_PATH, type Lot,
} from './lib';

const OUT_DIR = path.resolve(__dirname, '.out');

// ---------------------------------------------------------------- screen
async function screen(o: Record<string, string>) {
  const lot = parseLot(o);
  const { supabase } = clients('partout-screen');
  const { data, error } = await supabase
    .from('bricklink_part_out_value_cache')
    .select('set_number,set_name,condition,sold_6mo_avg_gbp,for_sale_avg_gbp,uk_retail_gbp,fetched_at')
    .in('set_number', lot.map((l) => l.set)).eq('condition', 'U');
  if (error) throw new Error(error.message);
  const byNum = new Map((data ?? []).map((r) => [r.set_number, r]));
  const now = Date.now();

  const rows = lot.map(({ set, ask }) => {
    const r = byNum.get(set);
    const sold = r?.sold_6mo_avg_gbp == null ? null : Number(r.sold_6mo_avg_gbp);
    const mult = sold != null && ask ? sold / ask : null;
    const age = r ? Math.round((now - new Date(r.fetched_at).getTime()) / 86400000) : null;
    const tier = mult == null ? '—'
      : mult >= 3 ? 'BUY (part-out)' : mult >= 2.5 ? 'near-gate' : mult >= 2 ? 'marginal'
      : mult >= 1 ? 'flip complete' : 'flip / skip';
    return { set, name: (r?.set_name ?? '(not cached)').slice(0, 34), ask, sold, mult, age, tier };
  }).sort((a, b) => (b.mult ?? -1) - (a.mult ?? -1));

  console.log(table(
    ['SET', 'NAME', 'ASK', 'SOLD-POV', 'MULT', 'AGEd', 'VERDICT'],
    rows.map((r) => [r.set, r.name, r.ask ?? '?', r.sold == null ? '—' : gbp(r.sold),
      r.mult == null ? '—' : r.mult.toFixed(2) + 'x', r.age == null ? '—' : (r.age > 30 ? `${r.age}!` : r.age), r.tier]),
  ));
  const tot = rows.reduce((a, r) => ({ ask: a.ask + (r.ask ?? 0), sold: a.sold + (r.sold ?? 0) }), { ask: 0, sold: 0 });
  console.log(`\nLot: ask £${gbp(tot.ask)}  |  sold-POV £${gbp(tot.sold)}  |  blended ${(tot.sold / tot.ask).toFixed(2)}x`);
  console.log('Notes: mult = 6mo-sold POV / ask (gross, incl. figs). AGEd with "!" = stale >30d. POV is a screen — ground the winners before committing.');
}

// ---------------------------------------------------------------- count
async function count(o: Record<string, string>) {
  const sets = parseLot(o).map((l) => l.set);
  const c = clients('partout-count');
  const boms = await fetchBoms(c.bl, sets);
  const union = new Map<string, Lot>();
  for (const s of sets) for (const l of boms[bareSet(normSet(s))] ?? []) union.set(keyOf(l.t, l.no, l.col), l);
  const lots = [...union.values()];

  console.log(`unique tuples (deduped across ${sets.length} sets): ${lots.length}\n`);
  const ttls = o.ttl ? [Number(o.ttl)] : [180, 30, 14, 7];
  const out: (string | number)[][] = [];
  for (const ttl of ttls) {
    const v = await readViews(c.supabase, lots, ttl);
    const cached = lots.filter((l) => v.get(keyOf(l.t, l.no, l.col))?.coverage === 'uk').length;
    out.push([ttl, cached, lots.length - cached, lots.length - cached + sets.length]);
  }
  console.log(table(['TTL_days', 'CACHED', 'NEED_FETCH', 'TOTAL_CALLS(+subsets)'], out));
  console.log(`\nSubsets already spent fetching BOMs: ${sets.length}. Ground cost ≈ NEED_FETCH at your chosen TTL (default ${POV_TTL_DAYS}).`);
}

// ---------------------------------------------------------------- ground
async function ground(o: Record<string, string>) {
  const lot = parseLot(o);
  const askOf = new Map(lot.map((l) => [l.set, l.ask]));
  const sets = lot.map((l) => l.set);
  const ttl = o.ttl ? Number(o.ttl) : POV_TTL_DAYS;
  const withNew = o.new === 'true';
  const c = clients('partout-ground');

  const boms = await fetchBoms(c.bl, sets);
  const allLots = sets.flatMap((s) => boms[bareSet(normSet(s))] ?? []);
  const fetched = await fetchUncached(c, allLots, ttl);
  const views = await readViews(c.supabase, allLots, ttl);

  const rows: any[] = [];
  const perSet: (string | number)[][] = [];
  let tList = 0, tSold = 0;
  for (const s of sets) {
    const lots = boms[bareSet(normSet(s))] ?? [];
    let list = 0, sold = 0, units = 0, nodata = 0, figList = 0, nList = 0;
    for (const l of lots) {
      const v = views.get(keyOf(l.t, l.no, l.col));
      const u = valueLot(v, 'U', l.qty);
      units += l.qty; if (u.avg == null) nodata++;
      list += u.extList; sold += u.extSold; if (l.t === 'M') figList += u.extList;
      if (withNew) nList += valueLot(v, 'N', l.qty).extList;
      rows.push({ set: bareSet(normSet(s)), key: `${l.t}:${l.no}:${l.col}`, name: l.name, qty: l.qty });
    }
    tList += list; tSold += sold;
    const ask = askOf.get(s) ?? null;
    perSet.push([bareSet(normSet(s)), lots.length, units, nodata, gbp(list), gbp(sold),
      gbp(figList), ask ?? '?', ask ? (list / ask).toFixed(2) + 'x' : '—', ask ? (sold / ask).toFixed(2) + 'x' : '—',
      ...(withNew ? [gbp(nList)] : [])]);
  }
  console.log('\n' + table(
    ['SET', 'LOTS', 'UNITS', 'NODATA', 'LIST£', 'SOLD£', 'FIG£', 'ASK', 'LISTx', 'SOLDx', ...(withNew ? ['NEW£'] : [])],
    perSet));
  const totAsk = lot.reduce((a, l) => a + (l.ask ?? 0), 0);
  console.log(`\nCOMBINED  list £${gbp(tList)}  |  sold-avg £${gbp(tSold)}` +
    (totAsk ? `  vs ask £${totAsk}  →  list ${(tList / totAsk).toFixed(2)}x / sold ${(tSold / totAsk).toFixed(2)}x` : ''));
  console.log(`API calls this run: ${fetched} price-guide + ${sets.length} subsets = ${fetched + sets.length}`);

  const topN = Number(o.top ?? 15);
  const valued = rows.map((r) => {
    const [t, no, col] = r.key.split(':');
    const u = valueLot(views.get(keyOf(t, no, Number(col))), 'U', r.qty);
    return { ...r, ...u };
  }).sort((a, b) => b.extList - a.extList);
  console.log(`\nTOP ${topN} LOTS BY EXT LIST VALUE`);
  console.log(table(['SET', 'KEY', 'QTY', 'SOLDAVG', 'STR', 'LIST/ea', 'EXT', 'NAME'],
    valued.slice(0, topN).map((r) => [r.set, r.key, r.qty, r.avg == null ? 'NODATA' : gbp(r.avg),
      (r.str ?? 0).toFixed(2), gbp(r.list), gbp(r.extList), (r.name || '').slice(0, 40)])));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = o.out ?? path.join(OUT_DIR, `rows-${sets.map(bareSet).join('_')}.json`);
  fs.writeFileSync(outFile, JSON.stringify(rows));
  console.log(`\nRows written to ${outFile}  (feed to: breakdown --rows=<file>)`);
}

// ---------------------------------------------------------------- breakdown
const STR_ORDER = ['≥1.5 (1.90x)', '1.0–1.5 (1.40x)', '0.75–1.0 (1.25x)', '0.5–0.75 (1.15x)',
  '0.25–0.5 (0.93x)', '0–0.25 (0.90x)', '0 no-sales (0.90x)', 'no-stock n/a (0.90x)', 'no price data'];
function strBucket(avg: number | null, str: number | null): string {
  if (avg == null) return 'no price data';
  if (str == null) return 'no-stock n/a (0.90x)';
  if (str >= 1.5) return '≥1.5 (1.90x)'; if (str >= 1) return '1.0–1.5 (1.40x)';
  if (str >= 0.75) return '0.75–1.0 (1.25x)'; if (str >= 0.5) return '0.5–0.75 (1.15x)';
  if (str >= 0.25) return '0.25–0.5 (0.93x)'; if (str > 0) return '0–0.25 (0.90x)';
  return '0 no-sales (0.90x)';
}

async function breakdown(o: Record<string, string>) {
  if (!o.rows) throw new Error('breakdown needs --rows=<file written by ground>');
  const rows: Lot[] = JSON.parse(fs.readFileSync(o.rows, 'utf-8')).map((r: any) => {
    const [t, no, col] = r.key.split(':'); return { t, no, col: Number(col), qty: r.qty, name: r.name, set: r.set };
  });
  const { supabase } = clients('partout-breakdown');
  const views = await readViews(supabase, rows);
  const sets = [...new Set(rows.map((r) => r.set))];

  // --- STR breakdown per set
  for (const set of sets) {
    const agg: Record<string, { lots: number; units: number; list: number }> = {};
    for (const r of rows.filter((x) => x.set === set)) {
      const v = views.get(keyOf(r.t, r.no, r.col)); const u = valueLot(v, 'U', r.qty);
      const b = strBucket(u.avg, u.str); (agg[b] ??= { lots: 0, units: 0, list: 0 });
      agg[b].lots++; agg[b].units += r.qty; agg[b].list += u.extList;
    }
    console.log(`\n=== ${set} — STR breakdown ===`);
    console.log(table(['BRACKET', 'LOTS', 'UNITS', 'LIST£'],
      STR_ORDER.filter((b) => agg[b]).map((b) => [b, agg[b].lots, agg[b].units, gbp(agg[b].list)])));
  }

  // --- New vs Dup vs live Bricqer store (Used lots)
  const dup = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('bricqer_inventory_snapshot')
      .select('item_number,item_type,color_name').eq('condition', 'Used').range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const fig = String(r.item_type).toLowerCase().startsWith('minifig');
      dup.add(fig ? `M|${r.item_number}` : `P|${r.item_number}|${(r.color_name || '').toLowerCase()}`);
    }
    if (!data || data.length < 1000) break;
  }
  const dupKey = (r: Lot) => r.t === 'M' ? `M|${r.no}` : `P|${r.no}|${blColour(r.col).toLowerCase()}`;
  console.log('\n=== NEW vs DUP lots (vs live Bricqer store, Used) ===');
  const dRows = sets.map((set) => {
    let dl = 0, nl = 0, dv = 0, nv = 0;
    for (const r of rows.filter((x) => x.set === set)) {
      const u = valueLot(views.get(keyOf(r.t, r.no, r.col)), 'U', r.qty);
      if (dup.has(dupKey(r))) { dl++; dv += u.extList; } else { nl++; nv += u.extList; }
    }
    return [set, dl + nl, dl, nl, `${Math.round((100 * dl) / (dl + nl))}%`, gbp(dv), gbp(nv)];
  });
  console.log(table(['SET', 'LOTS', 'DUP', 'NEW', '%DUP', 'DUP£', 'NEW£'], dRows));

  // --- New vs Used for one set (optional)
  if (o.set) {
    const set = bareSet(o.set);
    const subset = rows.filter((r) => r.set === set);
    const acc = (cond: 'U' | 'N') => subset.reduce((a, r) => {
      const v = views.get(keyOf(r.t, r.no, r.col)); const side = cond === 'N' ? v?.new : v?.used;
      const val = valueLot(v, cond, r.qty);
      return { pov: a.pov + val.extSold, list: a.list + val.extList, nodata: a.nodata + (side?.soldAvg == null ? 1 : 0),
        str: a.str + (side?.strQty ?? 0), strn: a.strn + (side?.strQty != null ? 1 : 0) };
    }, { pov: 0, list: 0, nodata: 0, str: 0, strn: 0 });
    const u = acc('U'), n = acc('N');
    console.log(`\n=== ${set} — NEW vs USED (${subset.length} lots) ===`);
    console.log(table(['METRIC', 'USED', 'NEW'], [
      ['sold-avg POV £', gbp(u.pov), gbp(n.pov)], ['Bricqer list £', gbp(u.list), gbp(n.list)],
      ['no-data lots', u.nodata, n.nodata], ['mean STR (stocked)', (u.str / u.strn).toFixed(3), (n.str / n.strn).toFixed(3)],
    ]));
  }
}

// ---------------------------------------------------------------- dispatch
async function main() {
  const { cmd, o } = parseArgs(process.argv.slice(2));
  const fns: Record<string, (o: Record<string, string>) => Promise<void>> = { screen, count, ground, breakdown };
  if (!cmd || !fns[cmd]) {
    console.log('commands: screen | count | ground | breakdown  (see header of scripts/partout/partout.ts)');
    process.exit(cmd ? 1 : 0);
  }
  await fns[cmd](o);
}
main().catch((e) => { console.error('ERR:', e?.message || e); process.exit(1); });
void CACHE_PATH;
