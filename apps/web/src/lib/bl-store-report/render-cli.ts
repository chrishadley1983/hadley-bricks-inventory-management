/**
 * bl-store-report — terminal renderer. The canonical CLI view of a store review.
 */
import type { DecisionReport, DecisionRow, GateCol } from './types';
import { CEILING_WARN_SHARE } from './compute';
import { gbp, pct, num, padL, padR, benchMark, OVERLAP_SHORT, ts } from './fmt';

function rowFlags(r: DecisionRow): string {
  let f = '';
  if (r.magnet) f += 'M';
  if (r.ceilingShare != null && r.ceilingShare < CEILING_WARN_SHARE) f += '▲';
  if (r.damage) f += '!';
  return f;
}

function rowLine(r: DecisionRow, i: number): string {
  const name = `${r.colourName && r.itemType === 'P' ? `${r.colourName} ` : ''}${r.itemName}`.slice(0, 30);
  return [
    padL(i + 1, 3),
    ` ${r.itemType} `,
    padR(r.itemNo.slice(0, 13), 13),
    ' ', padR(name, 30),
    ` ${r.condition} `,
    padL(gbp(r.ask), 7),
    padL(`${gbp(r.benchmark)}${benchMark(r.benchProvenance)}`, 9),
    padL(num(r.strQty), 6),
    padL(gbp(r.list), 8),
    padL(gbp(r.netPerUnit), 7),
    padL(r.marginPct == null ? '—' : `${Math.round(r.marginPct * 100)}%`, 5),
    padL(r.qty, 5),
    padL(gbp(r.lotNet), 8),
    padL(r.cappedQty ?? '—', 5),
    padL(gbp(r.cappedLotNet), 8),
    padL(r.moCover == null ? '—' : r.moCover.toFixed(1), 6),
    ' ', padR(r.overlap ? OVERLAP_SHORT[r.overlap] : '', 6),
    rowFlags(r),
  ].join('');
}

function gateLadder(gates: GateCol[]): string[] {
  const row = (label: string, f: (g: GateCol) => string) =>
    `  ${padR(label, 18)}${gates.map((g) => padL(f(g), 10)).join('')}`;
  return [
    row('', (g) => `STR≥${g.gate}`),
    row('Lots', (g) => String(g.lots)),
    row('Outlay', (g) => gbp(g.outlay)),
    row('Raw net', (g) => gbp(g.rawNet)),
    row('Capped net', (g) => gbp(g.cappedNet)),
    row('  ex-DUP (info)', (g) => gbp(g.cappedNetNoDups)),
    row('  DUP lots (info)', (g) => String(g.dupLots)),
    row('Margin / ROI', (g) => `${g.marginPct != null ? Math.round(g.marginPct * 100) : '—'}/${g.roiPct != null ? Math.round(g.roiPct * 100) : '—'}%`),
    row('Median STR', (g) => num(g.medianStr)),
    row('Median mo cover', (g) => (g.medianMoCover == null ? '—' : g.medianMoCover.toFixed(1))),
    row('Addl lots', (g) => String(g.addlLots)),
    row('Addl capped net', (g) => gbp(g.addlCappedNet)),
  ];
}

export function renderDecisionCli(rep: DecisionReport, opts: { maxRows?: number; title?: string } = {}): string {
  const { meta: m, summary: s } = rep;
  const maxRows = opts.maxRows ?? 40;
  const rule = '═'.repeat(120);
  const L: string[] = [];

  L.push(rule);
  L.push(`STORE DECISION REPORT — ${m.storeName ?? m.slug} (${m.country ?? '?'})   lens: ${m.lens}${m.engineVersion ? ` · engine v${m.engineVersion}` : ''}`);
  L.push(`scanned ${ts(m.scannedAt)} · generated ${ts(m.generatedAt)} · ${m.ukGroundedOnly === false ? 'ESTIMATE lens (world† fills gaps)' : 'UK-grounded'}`);
  if (m.scanTruncated) L.push('⚠ SCAN TRUNCATED — every total understates the store.');
  if (m.partialRows) L.push('⚠ PARTIAL ROWS — built from a persisted assessment\'s top-N lists; recompute from the stored scrape for the full table.');
  if (m.dataGapNote) L.push(`⚠ ${m.dataGapNote}`);
  L.push(rule);

  L.push('');
  L.push(`BUY LADDER — parts & minifigs by STR band  (each band a STANDALONE order: full Basket inbound postage ${gbp(s.inboundPostage)} · ${pct(m.inputs.feePct, 1)} fees · margin gate ${pct(m.inputs.minMargin)})`);
  L.push(...gateLadder(s.gates));
  L.push('');
  L.push(`  Whole buyable (STR≥0):  raw ${gbp(s.rawNet)} · demand-capped ${gbp(s.cappedNet)}   —  ${s.lots} lots · ${s.pieces} pcs · outlay ${gbp(s.outlay)} · Basket inbound postage ${gbp(s.inboundPostage)}`);
  L.push(`  STR (qty basis)  median ${num(s.strMedian)} · mean ${num(s.strMean)} · outlay-w ${num(s.strOutlayWeighted)}`);
  const c = s.coverage;
  const cp = (n: number) => pct(c.totalLots ? n / c.totalLots : null);
  L.push(`  Coverage (all P/M lots): UK ${cp(c.ukLots)} · world† ${cp(c.worldLots)} · none ${cp(c.noneLots)} of ${c.totalLots}   († = world +11% UK calibration)`);
  L.push(`  Advisory (never removes lots): NEW/R-OUT are buy indicators, DUP ${s.dupLots} = already-deep flag · magnets ${s.magnetLots} · high-STR ${s.highStrLots} · ceiling-warn ${s.ceilingWarnLots}${s.setLotsExcluded ? ` · ${s.setLotsExcluded} set lots in the SETS section below` : ''}`);

  L.push('');
  L.push(`DECISION TABLE — buyable P/M lots, sorted by capped net  (Cap£ = net × min(qty, 6-mo absorption); flags: M=magnet ▲=price-ceiling !=damage)`);
  L.push(`  #   T Item          Name                            C     Ask    Bench    STR     List   Net/u  Mgn%  Qty     Raw£   Cap     Cap£   MoC  Ovl`);
  L.push(`  ${'-'.repeat(118)}`);
  rep.rows.slice(0, maxRows).forEach((r, i) => L.push(`  ${rowLine(r, i)}`));
  if (rep.rows.length > maxRows) L.push(`  … ${rep.rows.length - maxRows} more rows (full table in the md report)`);
  if (rep.rows.length === 0) L.push('  (no lots clear the buying gates)');

  L.push('');
  L.push(...setsCli(rep));
  return L.join('\n');
}

/** SETS — a SEPARATE buying decision from parts/minifigs (never mixed into the P/M figure). */
function setsCli(rep: DecisionReport): string[] {
  const st = rep.sets;
  if (!st || st.lots === 0) {
    return [`SETS — ${rep.summary.setLotsExcluded || 0} set lot(s) seen; no sets assessment on this lens (run store-assessment for the sets breakdown).`];
  }
  const m = st.methods;
  const line = (label: string, r: { lots: number; outlay: number; net: number }, note: string) =>
    `  ${padR(label, 22)}${padL(r.lots, 5)}${padL(gbp(r.outlay), 11)}${padL(gbp(r.net), 11)}   ${note}`;
  return [
    `SETS — separate decision  (${st.lots} S-type lots · ${gbp(st.askValue)} ask; how the margin is achieved)`,
    `  ${padR('Method', 22)}${padL('Lots', 5)}${padL('Outlay', 11)}${padL('Net', 11)}`,
    `  ${'-'.repeat(60)}`,
    line('FLIP-AMAZON', m.flipAmazon, 'buy box via trusted ASIN, FBM fees (NEW only)'),
    line('SELL-BL', m.sellBl, 'sell complete at BL 6-mo avg, condition-matched'),
    line('PART-OUT', m.partOut, 'POV ≥2× ask and ≥£10 gap (signal, not booked)'),
    line('CMFs, identified', m.cmfIdentified, 'per-figure ids, sold as figures on BL'),
    line('CMFs, no identity', m.cmfNoIdentity, 'bare colNN — unpriceable without photos'),
    line('SKIP (no margin)', m.skip, ''),
    `  ${'-'.repeat(60)}`,
    line('SETS TOTAL (sellable)', st.totalSellable, ''),
  ];
}
