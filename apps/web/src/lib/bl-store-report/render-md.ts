/**
 * bl-store-report — full markdown renderer. Same data as the CLI view, every row,
 * written to tmp/stores/<slug>/store-report-<date>.md by the CLI entry points.
 */
import type { DecisionReport, DecisionRow, GateCol } from './types';
import { CEILING_WARN_SHARE } from './compute';
import { gbp, pct, num, benchMark, OVERLAP_SHORT, ts } from './fmt';

function mdRow(r: DecisionRow, i: number): string {
  const name = `${r.colourName && r.itemType === 'P' ? `${r.colourName} ` : ''}${r.itemName}`;
  const flags = [
    r.magnet ? 'M' : '',
    r.ceilingShare != null && r.ceilingShare < CEILING_WARN_SHARE ? '▲' : '',
    r.damage ? '!' : '',
  ].join('');
  return `| ${i + 1} | ${r.itemType} | ${r.itemNo} | ${name} | ${r.condition} | ${gbp(r.ask)} | ${gbp(r.benchmark)}${benchMark(r.benchProvenance)} | ${num(r.strQty)} | ${gbp(r.list)} | ${gbp(r.netPerUnit)} | ${r.marginPct == null ? '—' : `${Math.round(r.marginPct * 100)}%`} | ${r.qty} | ${gbp(r.lotNet)} | ${r.cappedQty ?? '—'} | ${gbp(r.cappedLotNet)} | ${r.moCover == null ? '—' : r.moCover.toFixed(1)} | ${r.overlap ? OVERLAP_SHORT[r.overlap] : ''} | ${flags} |`;
}

function mdGates(gates: GateCol[]): string[] {
  const head = `| Metric | ${gates.map((g) => `STR≥${g.gate}`).join(' | ')} |`;
  const sep = `|---|${gates.map(() => '---:').join('|')}|`;
  const row = (label: string, f: (g: GateCol) => string) => `| ${label} | ${gates.map(f).join(' | ')} |`;
  return [
    head, sep,
    row('Lots', (g) => String(g.lots)),
    row('Outlay', (g) => gbp(g.outlay)),
    row('Raw net', (g) => gbp(g.rawNet)),
    row('Capped net', (g) => gbp(g.cappedNet)),
    row('**Liquid (no DUPs)**', (g) => `**${gbp(g.cappedNetNoDups)}**`),
    row('DUP lots', (g) => String(g.dupLots)),
    row('Margin / ROI', (g) => `${g.marginPct != null ? Math.round(g.marginPct * 100) : '—'}% / ${g.roiPct != null ? Math.round(g.roiPct * 100) : '—'}%`),
    row('Median STR', (g) => num(g.medianStr)),
    row('Median mo cover', (g) => (g.medianMoCover == null ? '—' : g.medianMoCover.toFixed(1))),
    row('Additional lots', (g) => String(g.addlLots)),
    row('Additional capped net', (g) => gbp(g.addlCappedNet)),
  ];
}

export function renderDecisionMd(rep: DecisionReport): string {
  const { meta: m, summary: s } = rep;
  const L: string[] = [];

  L.push(`# Store decision report — ${m.storeName ?? m.slug}`);
  L.push('');
  L.push(`**${m.slug}** (${m.country ?? '?'}) · lens **${m.lens}**${m.engineVersion ? ` · engine v${m.engineVersion}` : ''} · scanned ${ts(m.scannedAt)} · generated ${ts(m.generatedAt)} · ${m.ukGroundedOnly === false ? 'ESTIMATE lens (world† fills gaps)' : 'UK-grounded'}`);
  if (m.scanTruncated) L.push('\n> ⚠ **Scan truncated** — every total understates the store.');
  if (m.partialRows) L.push('\n> ⚠ **Partial rows** — built from a persisted assessment\'s top-N lists; recompute from the stored scrape for the full table.');
  if (m.dataGapNote) L.push(`\n> ⚠ ${m.dataGapNote}`);
  L.push('');

  L.push('## Headline');
  L.push('');
  L.push(`All figures are a **standalone order**: full ${gbp(s.inboundPostage)} inbound postage, ${pct(m.inputs.feePct, 1)} fees, margin gate ${pct(m.inputs.minMargin)}.`);
  L.push('');
  L.push('| | Net | Lots | Outlay |');
  L.push('|---|---:|---:|---:|');
  L.push(`| Raw (uncapped) | ${gbp(s.rawNet)} | ${s.lots} | ${gbp(s.outlay)} |`);
  L.push(`| Demand-capped | ${gbp(s.cappedNet)} | ${s.lots} | ${gbp(s.outlay)} |`);
  L.push(`| **Liquid** (STR≥${s.liquidGate}, no DUPs, capped) | **${gbp(s.liquidNet)}** | ${s.liquidLots} | ${gbp(s.liquidOutlay)} |`);
  L.push('');
  L.push(`- **STR (qty basis)**: median **${num(s.strMedian)}** · mean ${num(s.strMean)} · outlay-weighted ${num(s.strOutlayWeighted)}`);
  const c = s.coverage;
  const cp = (n: number) => pct(c.totalLots ? n / c.totalLots : null);
  L.push(`- **Benchmark coverage** (all P/M lots): UK ${cp(c.ukLots)} · world† ${cp(c.worldLots)} · none ${cp(c.noneLots)} of ${c.totalLots} († = world +11% UK calibration)`);
  L.push(`- Magnets ${s.magnetLots} · high-STR ${s.highStrLots} · DUPs ${s.dupLots} · ceiling-warnings ${s.ceilingWarnLots}${s.setLotsExcluded ? ` · ${s.setLotsExcluded} set lots excluded (separate decision — see the assessment SETS section)` : ''}`);
  L.push('');

  L.push('## Decision table — buyable P/M lots');
  L.push('');
  L.push('Sorted by capped net. `Cap£` = net/u × min(qty, 6-mo market absorption × capture). Flags: **M** magnet · **▲** price-ceiling (under ' + pct(CEILING_WARN_SHARE) + ' of 6-mo sold qty at/above our list) · **!** damage note.');
  L.push('');
  L.push('| # | T | Item | Name | C | Ask | Bench | STR | List | Net/u | Mgn | Qty | Raw£ | Cap | Cap£ | MoC | Ovl | Fl |');
  L.push('|---:|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|');
  rep.rows.forEach((r, i) => L.push(mdRow(r, i)));
  if (rep.rows.length === 0) L.push('| — | | | *(no lots clear the buying gates)* | | | | | | | | | | | | | | |');
  L.push('');

  L.push('## Gate ladder');
  L.push('');
  L.push('Each column is a standalone order (full inbound postage charged to the subset).');
  L.push('');
  L.push(...mdGates(s.gates));
  L.push('');

  L.push('## Conventions');
  L.push('');
  L.push('- STR = 6-mo sold qty ÷ current stock qty (UK-first; † rows use worldwide ×1.11).');
  L.push(`- Net/u = Bricqer-modelled list × (1 − ${pct(m.inputs.feePct, 1)}) − ask, ex-postage; postage is charged once to the whole selection.`);
  L.push('- Demand cap: units clearable in 6 months = market 6-mo sold qty × capture fraction f(STR) (liquidity-pov curve).');
  L.push('- Liquid = the headline to act on: within margin, STR≥' + String(s.liquidGate) + ', DUPs excluded, demand-capped, postage charged.');
  L.push('');
  return L.join('\n');
}
