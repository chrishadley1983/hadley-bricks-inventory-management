/**
 * BL Store Assessment — terminal / markdown renderer.
 * Produces the `report_md` persisted alongside the structured assessment.
 */
import type { StoreAssessment, ScoredLot, Bucket } from './types';

const gbp = (n: number | null | undefined): string => (n == null ? '—' : `£${n.toFixed(2)}`);
const pct = (n: number | null | undefined, dp = 0): string => (n == null ? '—' : `${(n * 100).toFixed(dp)}%`);
const num = (n: number | null | undefined, dp = 2): string => (n == null ? '—' : n.toFixed(dp));

function lotLabel(s: ScoredLot): string {
  const col = s.colourName ? ` ${s.colourName}` : '';
  return `${s.itemNo}${col} (${s.condition}) ${s.itemName}`.slice(0, 54);
}

function bar(share: number, width = 20): string {
  const n = Math.round(share * width);
  return '█'.repeat(n) + '░'.repeat(width - n);
}

function bucketLines(buckets: Bucket[]): string {
  return buckets
    .map((b) => `  ${b.key.padEnd(24)} ${bar(b.valueShare)} ${pct(b.valueShare, 0).padStart(4)}  ${String(b.lots).padStart(5)} lots  ${gbp(b.value)}`)
    .join('\n');
}

function lotTable(rows: ScoredLot[], cols: 'margin' | 'str' | 'magnet' | 'size'): string {
  if (rows.length === 0) return '  (none)';
  return rows
    .map((s) => {
      const base = `  ${lotLabel(s).padEnd(54)} ask ${gbp(s.ask).padStart(8)}`;
      if (cols === 'margin') return `${base}  6MA ${gbp(s.ukSoldAvg).padStart(8)}  list ${gbp(s.ourList).padStart(8)}  net/u ${gbp(s.netPerUnit).padStart(7)}  ${pct(s.marginPct, 0).padStart(5)}  ×${s.invQty}`;
      if (cols === 'str') return `${base}  STR ${num(s.strLots, 2).padStart(5)}  6MA ${gbp(s.ukSoldAvg).padStart(8)}  ${s.withinMargin ? 'BUY' : '   '}`;
      if (cols === 'magnet') return `${base}  supply ${String(s.worldSupplyLots ?? '—').padStart(3)}  STR ${num(s.strLots, 2).padStart(5)}  ${s.withinMargin ? 'BUY' : '   '}`;
      return `${base}  ×${s.invQty}  = ${gbp(s.lotAskValue)}`;
    })
    .join('\n');
}

export function renderAssessment(a: StoreAssessment): string {
  const L: string[] = [];
  const rule = '─'.repeat(72);
  L.push(rule);
  L.push(`STORE ASSESSMENT — ${a.store.storeName ?? a.store.slug}  (${a.store.country ?? '?'}, ID ${a.store.storeId ?? '?'})`);
  L.push(`mode: ${a.mode.toUpperCase()}   scanned: ${a.scannedAt.slice(0, 16).replace('T', ' ')}`);
  L.push(rule);

  // Verdict
  L.push(`\n▓▓ VERDICT: ${a.verdict.label}   grade ${a.verdict.grade}/100`);
  L.push(`   ${a.verdict.headline}`);
  for (const r of a.verdict.reasons) L.push(`   • ${r}`);

  // 1. Size & value
  L.push(`\n[1] STORE SIZE & VALUE`);
  L.push(`  ${a.size.totalLots} lots · ${a.size.totalPieces} pieces · ${gbp(a.size.totalValue)} value · avg ${gbp(a.size.avgValuePerLot)}/lot · median ask ${gbp(a.size.medianLotPrice)}`);
  L.push(bucketLines(a.size.byType));

  // 2. Pricing strategy
  const wmStr = a.pricing.weightedMedianAskVsUk != null ? `${Math.round(a.pricing.weightedMedianAskVsUk * 100)}% of 6-mo market avg` : '—';
  L.push(`\n[2] PRICING STRATEGY  —  ${a.pricing.label.toUpperCase()} (weighted median ask = ${wmStr})`);
  L.push(`  covered lots: ${a.pricing.covered}`);
  L.push(bucketLines(a.pricing.positions));

  // 3. Feedback & order rate
  L.push(`\n[3] FEEDBACK & ORDER RATE`);
  if (a.feedback) {
    L.push(`  feedback ${a.feedback.feedbackScore ?? '—'} (${a.feedback.positivePct != null ? a.feedback.positivePct.toFixed(1) + '% positive' : '—'})  ·  member since ${a.feedback.memberSince ?? '—'}`);
    L.push(`  order rate ≈ ${a.feedback.ordersPerMonth != null ? a.feedback.ordersPerMonth.toFixed(1) + '/mo' : '—'}${a.feedback.feedbackLast6mo != null ? ` (${a.feedback.feedbackLast6mo} feedback in 6mo)` : ''}`);
  } else {
    L.push('  (profile scrape unavailable)');
  }

  // 4. Part mix
  L.push(`\n[4] PART MIX (type × condition)`);
  for (const c of a.partMix.matrix) {
    const t = c.itemType === 'P' ? 'Parts' : c.itemType === 'S' ? 'Sets' : 'Minifigs';
    L.push(`  ${(`${t} ${c.condition === 'N' ? 'New' : 'Used'}`).padEnd(18)} ${String(c.lots).padStart(5)} lots  ${String(c.pieces).padStart(7)} pcs  ${gbp(c.value)}`);
  }
  L.push(`  New/Used by value: ${pct(a.partMix.newValueShare)} / ${pct(a.partMix.usedValueShare)}   ·   used lots with damage note: ${pct(a.partMix.damageNoteShare, 1)}`);
  const sc = a.partMix.setCompleteness;
  if (sc.complete + sc.incomplete + sc.sealed + sc.unknown > 0) L.push(`  sets: ${sc.complete} complete · ${sc.incomplete} incomplete · ${sc.sealed} sealed · ${sc.unknown} unknown`);

  // 5. Within margin
  L.push(`\n[5] LOTS WITHIN PRICING MARGIN (≥${pct(a.inputs.minMargin)} net, ex-postage=${a.inputs.inboundPerUnit === 0})`);
  L.push(`  ${a.withinMargin.lots} lots · outlay ${gbp(a.withinMargin.outlay)} · projected net ${gbp(a.withinMargin.projectedNet)} · margin ${num(a.withinMargin.blendedMarginPct, 1)}% · ROI ${num(a.withinMargin.roiPct, 0)}%`);
  L.push(lotTable(a.withinMargin.top, 'margin'));

  // 6. High STR
  L.push(`\n[6] HIGH-STR LOTS (STR ≥ ${a.inputs.minStr}, lots basis)`);
  L.push(`  ${a.highStr.lots} lots · ${gbp(a.highStr.value)} · ${a.highStr.alsoWithinMargin} also within margin`);
  L.push(lotTable(a.highStr.top, 'str'));

  // 7. Magnets
  L.push(`\n[7] MAGNETS (very low supply ≤${a.inputs.magnetMaxSupplyLots} sellers + decent STR)`);
  L.push(`  ${a.magnets.lots} lots · ${gbp(a.magnets.value)} · ${a.magnets.alsoWithinMargin} also within margin`);
  L.push(lotTable(a.magnets.top, 'magnet'));

  // Extras
  L.push(`\n[8] DATA CONFIDENCE`);
  L.push(`  value with UK data ${pct(a.confidence.ukValueShare)} · world-fallback ${pct(a.confidence.worldValueShare)} · no benchmark ${pct(a.confidence.noneValueShare)}`);

  L.push(`\n[9] AGEING / MOTIVATED-SELLER SIGNAL  ${a.ageing.motivatedSeller ? '⚠ MOTIVATED (>50% overstock)' : ''}`);
  L.push(bucketLines(a.ageing.buckets));

  L.push(`\n[10] CONCENTRATION`);
  L.push(`  top-10 lots = ${pct(a.concentration.top10ValueShare)} of value · ${a.concentration.distinctItems} distinct items`);

  L.push(`\n${rule}`);
  return L.join('\n');
}
