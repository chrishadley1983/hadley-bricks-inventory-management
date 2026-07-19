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
    row('Liquid (no DUPs)', (g) => gbp(g.cappedNetNoDups)),
    row('DUP lots', (g) => String(g.dupLots)),
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
  L.push(rule);

  L.push('');
  L.push(`HEADLINE  (standalone order: full ${gbp(s.inboundPostage)} inbound postage · ${pct(m.inputs.feePct, 1)} fees · margin gate ${pct(m.inputs.minMargin)})`);
  L.push(`  Raw net (uncapped)                    ${padL(gbp(s.rawNet), 10)}   ${s.lots} lots · ${s.pieces} pcs · outlay ${gbp(s.outlay)}`);
  L.push(`  Demand-capped net                     ${padL(gbp(s.cappedNet), 10)}`);
  L.push(`  LIQUID (STR≥${s.liquidGate}, no DUPs, capped)    ${padL(gbp(s.liquidNet), 10)}   ${s.liquidLots} lots · outlay ${gbp(s.liquidOutlay)}   ← the honest buy`);
  L.push('');
  L.push(`  STR (qty basis)  median ${num(s.strMedian)} · mean ${num(s.strMean)} · outlay-w ${num(s.strOutlayWeighted)}`);
  const c = s.coverage;
  const cp = (n: number) => pct(c.totalLots ? n / c.totalLots : null);
  L.push(`  Coverage (all P/M lots): UK ${cp(c.ukLots)} · world† ${cp(c.worldLots)} · none ${cp(c.noneLots)} of ${c.totalLots}   († = world +11% UK calibration)`);
  L.push(`  Magnets ${s.magnetLots} · high-STR ${s.highStrLots} · DUPs ${s.dupLots} · ceiling-warn ${s.ceilingWarnLots}${s.setLotsExcluded ? ` · ${s.setLotsExcluded} set lots excluded (separate decision)` : ''}`);

  L.push('');
  L.push(`DECISION TABLE — buyable P/M lots, sorted by capped net  (Cap£ = net × min(qty, 6-mo absorption); flags: M=magnet ▲=price-ceiling !=damage)`);
  L.push(`  #   T Item          Name                            C     Ask    Bench    STR     List   Net/u  Mgn%  Qty     Raw£   Cap     Cap£   MoC  Ovl`);
  L.push(`  ${'-'.repeat(118)}`);
  rep.rows.slice(0, maxRows).forEach((r, i) => L.push(`  ${rowLine(r, i)}`));
  if (rep.rows.length > maxRows) L.push(`  … ${rep.rows.length - maxRows} more rows (full table in the md report)`);
  if (rep.rows.length === 0) L.push('  (no lots clear the buying gates)');

  L.push('');
  L.push('GATE LADDER  (each column standalone: full inbound postage charged to the subset)');
  L.push(...gateLadder(s.gates));
  L.push('');
  return L.join('\n');
}
