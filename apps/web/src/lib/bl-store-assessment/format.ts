/**
 * BL Store Assessment — terminal / markdown renderer.
 * Produces the `report_md` persisted alongside the structured assessment.
 */
import type { StoreAssessment, ScoredLot, Bucket } from './types';
import { THIN_COVER_MONTHS } from './overlap';

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

/** Benchmark with provenance: † = worldwide fallback (+UK calibration applied). */
const bench = (s: ScoredLot): string => `${gbp(s.benchmarkAvg)}${s.priceSource === 'world' ? '†' : ' '}`;

const OVERLAP_SHORT: Record<string, string> = { NEW: 'NEW', RESTOCK_OUT: 'R-OUT', RESTOCK_THIN: 'R-THIN', DUPLICATE: 'DUP' };
const overlapCol = (s: ScoredLot): string => (s.overlap ? OVERLAP_SHORT[s.overlap] ?? '' : '').padEnd(6);

function lotTable(rows: ScoredLot[], cols: 'margin' | 'str' | 'magnet' | 'size'): string {
  if (rows.length === 0) return '  (none)';
  return rows
    .map((s) => {
      const base = `  ${lotLabel(s).padEnd(54)} ask ${gbp(s.ask).padStart(8)}`;
      if (cols === 'margin') return `${base}  6MA ${bench(s).padStart(9)}  list ${gbp(s.ourList).padStart(8)}  net/u ${gbp(s.netPerUnit).padStart(7)}  ${pct(s.marginPct, 0).padStart(5)}  ×${s.invQty}  ${overlapCol(s)}`;
      if (cols === 'str') return `${base}  STR ${num(s.strLots, 2).padStart(5)}  6MA ${bench(s).padStart(9)}  ${s.withinMargin ? 'BUY' : '   '}`;
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
  L.push(`mode: ${a.mode.toUpperCase()}   scanned: ${a.scannedAt.slice(0, 16).replace('T', ' ')}   engine v${a.engineVersion}   lens: ${a.inputs.ukGroundedOnly ? 'UK-GROUNDED (full scan in place)' : 'ESTIMATE (world-calibrated fills gaps)'}`);
  if (a.scanTruncated) L.push(`⚠ SCAN TRUNCATED — inventory hit the page cap; every total below understates the store.`);
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
  const wmStr = a.pricing.weightedMedianAskVsMarket != null ? `${Math.round(a.pricing.weightedMedianAskVsMarket * 100)}% of 6-mo market avg` : '—';
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
  L.push(`\n[5] LOTS WITHIN PRICING MARGIN (≥${pct(a.inputs.minMargin)} net, inbound/unit ${gbp(a.inputs.inboundPerUnit)}${a.inputs.inboundPerUnit === 0 ? ' — ex-postage' : ''})`);
  L.push(`  ${a.withinMargin.lots} lots · outlay ${gbp(a.withinMargin.outlay)} · projected net ${gbp(a.withinMargin.projectedNet)} · margin ${num(a.withinMargin.blendedMarginPct, 1)}% · ROI ${num(a.withinMargin.roiPct, 0)}%`);
  L.push(lotTable(a.withinMargin.top, 'margin'));

  // 6. High STR
  L.push(`\n[6] HIGH-STR LOTS (STR ≥ ${a.inputs.minStr}, qty basis)`);
  L.push(`  ${a.highStr.lots} lots · ${gbp(a.highStr.value)} · ${a.highStr.alsoWithinMargin} also within margin`);
  L.push(lotTable(a.highStr.top, 'str'));

  // 7. Magnets
  L.push(`\n[7] MAGNETS (very low supply ≤${a.inputs.magnetMaxSupplyLots} sellers + decent STR)`);
  L.push(`  ${a.magnets.lots} lots · ${gbp(a.magnets.value)} · ${a.magnets.alsoWithinMargin} also within margin`);
  L.push(lotTable(a.magnets.top, 'magnet'));

  // Extras
  L.push(`\n[8] DATA CONFIDENCE  († = worldwide benchmark, +11% UK calibration)`);
  L.push(`  value with UK data ${pct(a.confidence.ukValueShare)} · world-fallback ${pct(a.confidence.worldValueShare)} · no benchmark ${pct(a.confidence.noneValueShare)}`);

  L.push(`\n[9] AGEING / MOTIVATED-SELLER SIGNAL  ${a.ageing.motivatedSeller ? '⚠ MOTIVATED (>50% of benchmarked value overstock/dead)' : ''}`);
  L.push(bucketLines(a.ageing.buckets));
  L.push(`  benchmarked value: ${pct(a.ageing.benchmarkedValueShare)} of store (no-data lots excluded from the signal)`);

  L.push(`\n[10] CONCENTRATION`);
  L.push(`  top-10 lots = ${pct(a.concentration.top10ValueShare)} of value · ${a.concentration.distinctItems} distinct items`);

  // 11. Overlap vs our store
  L.push(`\n[11] OVERLAP vs OUR STORE  (buyable lots only)`);
  if (a.overlap.available) {
    const label: Record<string, string> = {
      NEW: 'NEW (not stocked, never sold)', RESTOCK_OUT: 'RESTOCK-OUT (sold out, proven)',
      RESTOCK_THIN: `RESTOCK-THIN (<${THIN_COVER_MONTHS}mo of our sell rate)`, DUPLICATE: 'DUPLICATE (already deep)',
    };
    for (const t of a.overlap.buyableTags) {
      L.push(`  ${label[t.tag].padEnd(36)} ${String(t.lots).padStart(4)} lots  outlay ${gbp(t.outlay).padStart(8)}  net ${gbp(t.projectedNet).padStart(8)}`);
    }
    if (a.overlap.untaggedBuyableLots) L.push(`  (sets, outside Bricqer)                 ${String(a.overlap.untaggedBuyableLots).padStart(4)} lots`);
    if (a.overlap.freshNetShare != null) L.push(`  fresh demand (NEW + RESTOCK-OUT) = ${pct(a.overlap.freshNetShare)} of buyable net`);
    L.push(`  our snapshot: ${a.overlap.snapshotAt ? a.overlap.snapshotAt.slice(0, 16).replace('T', ' ') : 'unknown age'} · our sales window: ${a.overlap.salesWindowDays ?? '—'}d`);
  } else {
    L.push('  (no user index — run the CLI with a resolvable user id to tag overlap)');
  }

  // 12. Table A (approved 2026-07-14): PARTS & MINIFIGS by inclusive STR gate.
  if (a.strCoverage) {
    const c = a.strCoverage.coverage;
    const gates = a.strCoverage.gates;
    L.push(`\n[12] PARTS & MINIFIGS — BUYABLE BY STR GATE   (bl-basket scope; STR = qty basis; ${a.inputs.ukGroundedOnly ? 'UK-grounded' : 'estimate lens'})`);
    L.push(`  benchmark coverage (P+M): UK ${pct(c.ukLots / Math.max(1, c.totalLots))} · world-fallback ${pct(c.worldLots / Math.max(1, c.totalLots))} · none ${pct(c.noneLots / Math.max(1, c.totalLots))} of ${c.totalLots} lots`);
    const row = (label: string, f: (x: (typeof gates)[number]) => string) =>
      `  ${label.padEnd(20)}${gates.map((x) => f(x).padStart(11)).join('')}`;
    L.push(row('', (x) => `STR≥${x.gate}`));
    L.push(row('Lots', (x) => String(x.lots)));
    L.push(row('Outlay', (x) => gbp(x.outlay)));
    L.push(row('Net', (x) => gbp(x.net)));
    L.push(row('Margin / ROI', (x) => `${x.marginPct != null ? Math.round(x.marginPct * 100) : '—'}%/${x.roiPct != null ? Math.round(x.roiPct * 100) : '—'}%`));
    L.push(row('Median STR', (x) => (x.medianStr != null ? x.medianStr.toFixed(2) : '—')));
    L.push(row('Median mo to clear', (x) => (x.medianMonths != null ? `${x.medianMonths}` : '—')));
    L.push(row('80% net by (mo)', (x) => (x.monthsTo80PctNet != null ? `${x.monthsTo80PctNet}` : '—')));
    L.push(row('£/lot/mo', (x) => (x.capacityPerLotMo != null ? x.capacityPerLotMo.toFixed(3) : '—')));
    L.push(row('Additional lots', (x) => String(x.addlLots)));
    L.push(row('Additional net', (x) => gbp(x.addlNet)));
  }

  // 13. Table B (approved 2026-07-14): SETS by sales method.
  if (a.sets && a.sets.lots > 0) {
    const s = a.sets;
    const m = s.methods;
    L.push(`\n[13] SETS — BY SALES METHOD   (${s.lots} S-type lots · ${gbp(s.askValue)} ask; how the margin is achieved)`);
    const mrow = (label: string, r: { lots: number; outlay: number; net: number }, note: string, showNet = true) =>
      `  ${label.padEnd(22)}${String(r.lots).padStart(6)} ${gbp(r.outlay).padStart(11)} ${showNet ? gbp(r.net).padStart(10) : '—'.padStart(10)}   ${note}`;
    L.push(`  ${'Method'.padEnd(22)}${'Lots'.padStart(6)} ${'Outlay'.padStart(11)} ${'Net'.padStart(10)}   Note`);
    L.push(mrow('FLIP-AMAZON', m.flipAmazon, 'buy box via trusted ASIN, FBM fees (NEW only)'));
    L.push(mrow('SELL-BL', m.sellBl, 'sell complete at BL 6-mo avg, 9.4% fees'));
    L.push(mrow('PART-OUT', m.partOut, 'POV ≥2× ask and ≥£10 gap (net = POV−ask signal)'));
    L.push(mrow('SKIP (no margin)', m.skip, '', false));
    L.push(mrow('CMFs, identified', m.cmfIdentified, `per-figure ids${s.cmfResolvedCount ? ` (${s.cmfResolvedCount} resolved by name)` : ''}, sold as figures on BL`));
    L.push(mrow('CMFs, no identity', m.cmfNoIdentity, 'bare colNN — unpriceable without listing photos', false));
    L.push(`  ${'─'.repeat(60)}`);
    L.push(mrow('SETS TOTAL (sellable)', s.totalSellable, ''));
    const shown = s.decided.filter((r) => r.verdict !== 'SKIP').slice(0, 10);
    if (shown.length) {
      L.push('  top set decisions:');
      for (const r of shown) {
        const name = `${r.itemNo} (${r.condition}) ${r.setName ?? ''}`.slice(0, 50);
        const amz = r.amazonBuyBox != null ? `AMZ ${gbp(r.amazonBuyBox)}${r.amazonNet != null ? `→${gbp(r.amazonNet)}` : ''}` : 'AMZ n/t';
        const pov = r.povGbp != null ? `POV ${gbp(r.povGbp)}${r.povMultiple != null ? ` (${r.povMultiple}x)` : ''}` : '';
        L.push(`   ${name.padEnd(50)} ask ${gbp(r.ask).padStart(8)}  BL ${gbp(r.blNet).padStart(7)}  ${amz.padEnd(20)} ${pov.padEnd(16)} → ${r.verdict}`);
      }
    }
  }

  L.push(`\n${rule}`);
  return L.join('\n');
}
