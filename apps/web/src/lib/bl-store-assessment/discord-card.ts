/**
 * BL Store Assessment — Discord alert card builder.
 *
 * Renders the FULL persisted assessment (store_assessments.assessment jsonb) into a
 * rich embed: verdict reasoning, basket economics (outlay/net/margin/ROI), fresh-demand
 * split, magnets, seller quality, benchmark confidence, and the top buyable picks.
 * Shared by the nightly sweep (store-assessment-batch.ts) and any ad-hoc sender so
 * every surface posts an identical card.
 */
import type { StoreAssessment, ScoredLot } from './types';
import type { DeltaAlert } from './batch';

const gbp = (n: number | null | undefined): string => (n == null ? '—' : `£${n.toFixed(2)}`);
const pct0 = (n: number | null | undefined): string => (n == null ? '—' : `${Math.round(n * 100)}%`);

const VERDICT_COLOUR: Record<string, number> = { BUY: 0x2ecc71, REVIEW: 0xf1c40f, SKIP: 0x95a5a6 };

const OVERLAP_TAG: Record<string, string> = {
  NEW: 'NEW', RESTOCK_OUT: 'R-OUT', RESTOCK_THIN: 'R-THIN', DUPLICATE: 'DUP',
};

function pickLine(s: ScoredLot): string {
  const name = (s.itemName ?? '').slice(0, 34);
  const col = s.colourName ? ` ${s.colourName}` : '';
  const src = s.priceSource === 'world' ? '†' : '';
  const tag = s.overlap ? ` \`${OVERLAP_TAG[s.overlap] ?? s.overlap}\`` : '';
  const lotNet = s.lotProfit != null ? ` = **${gbp(s.lotProfit)}**` : '';
  const str = s.strLots != null ? ` · STR ${s.strLots.toFixed(2)}` : '';
  return `**${s.itemNo}**${col} (${s.condition}) ${name}\n` +
    `　ask ${gbp(s.ask)} vs 6MA ${gbp(s.benchmarkAvg)}${src} → ${gbp(s.netPerUnit)}/u (${pct0(s.marginPct)}) ×${s.invQty}${lotNet}${str}${tag}`;
}

/** Keep a multi-line field under Discord's 1024-char limit, dropping whole lines. */
function fitField(lines: string[], max = 1024): string {
  const out: string[] = [];
  let len = 0;
  for (const l of lines) {
    if (len + l.length + 1 > max) break;
    out.push(l);
    len += l.length + 1;
  }
  return out.length ? out.join('\n') : '(none)';
}

export function buildStoreAlertCard(
  a: StoreAssessment,
  alerts: DeltaAlert[],
  slug: string,
  storeName?: string | null,
): object {
  const v = a.verdict;
  const name = storeName ?? a.store.storeName ?? slug;
  const wm = a.pricing.weightedMedianAskVsMarket;

  const descLines: string[] = alerts.map((al) => `• ${al.headline}`);
  // Honesty ladder first (2026-07-19 audit): the uncapped net flattered stores with
  // one deep slow lot (Beeble's "£5,000") — lead with the liquid figure when stamped.
  if (a.decision) {
    const d = a.decision;
    descLines.push('', `**STR≥${d.liquidGate}: ${gbp(d.liquidNet)}** (${d.liquidLots} lots, demand-capped, DUPs incl.) · all-band capped ${gbp(d.cappedNet)} · raw ${gbp(d.rawNet)}`);
  } else {
    descLines.push('', `**${v.headline}**`);
  }
  // Reasons repeat the field numbers below — keep only the caveat/warning ones.
  for (const r of v.reasons) if (r.startsWith('⚠')) descLines.push(r);
  if (a.scanTruncated) descLines.push('⚠ Scan truncated at page cap — all totals understate the store.');

  const fresh = a.overlap.available
    ? a.overlap.buyableTags.filter((t) => t.tag === 'NEW' || t.tag === 'RESTOCK_OUT')
    : [];
  const freshLots = fresh.reduce((n, t) => n + t.lots, 0);
  const freshNet = fresh.reduce((n, t) => n + t.projectedNet, 0);

  const fields: object[] = [
    {
      name: '💰 Buyable basket',
      value: a.decision
        ? `**${gbp(a.decision.liquidNet)} @STR≥${a.decision.liquidGate}** (${a.decision.liquidLots} lots · ${gbp(a.decision.liquidOutlay)})\n` +
          `raw ${gbp(a.decision.rawNet)} → capped ${gbp(a.decision.cappedNet)} · ${a.withinMargin.lots} lots in margin`
        : `${a.withinMargin.lots} lots · outlay ${gbp(a.withinMargin.outlay)} → **${gbp(a.withinMargin.projectedNet)} net**\n` +
          `margin ${a.withinMargin.blendedMarginPct != null ? a.withinMargin.blendedMarginPct.toFixed(1) : '—'}% · ROI ${a.withinMargin.roiPct != null ? Math.round(a.withinMargin.roiPct) : '—'}%`,
      inline: true,
    },
    {
      name: '🔥 Fresh demand',
      value: a.overlap.available
        ? `${freshLots} lots (NEW + restock-out)\n${gbp(freshNet)} net · ${pct0(a.overlap.freshNetShare)} of buyable`
        : '(no overlap index)',
      inline: true,
    },
    {
      name: '📈 Demand signals',
      value: `${a.highStr.lots} high-STR lots (≥${a.inputs.minStr}) · ${a.highStr.alsoWithinMargin} buyable\n🧲 ${a.magnets.lots} magnets · ${a.magnets.alsoWithinMargin} buyable`,
      inline: true,
    },
    {
      name: '🏬 Store & pricing',
      value: `${a.size.totalLots} lots · ${gbp(a.size.totalValue)} · median ${gbp(a.size.medianLotPrice)}\n${wm != null ? `${Math.round(wm * 100)}% of market` : '—'} (${a.pricing.label})`,
      inline: true,
    },
    {
      name: '⭐ Seller',
      value: a.feedback
        ? `${a.feedback.feedbackScore ?? '—'} fb (${a.feedback.positivePct != null ? a.feedback.positivePct.toFixed(1) : '—'}% +)\n~${a.feedback.ordersPerMonth != null ? a.feedback.ordersPerMonth.toFixed(1) : '—'} orders/mo`
        : '(profile unavailable)',
      inline: true,
    },
    {
      name: '📊 Benchmarks',
      value: `UK ${pct0(a.confidence.ukValueShare)} · world† ${pct0(a.confidence.worldValueShare)}\nno data ${pct0(a.confidence.noneValueShare)}`,
      inline: true,
    },
    {
      name: `🛒 Top picks (of ${a.withinMargin.lots} buyable)`,
      value: fitField(a.withinMargin.top.slice(0, 5).map(pickLine)),
      inline: false,
    },
  ];

  return {
    embeds: [{
      title: `🏪 ${name} — ${v.label} (grade ${v.grade})`,
      url: `https://store.bricklink.com/${encodeURIComponent(slug)}#/shop`,
      color: VERDICT_COLOUR[v.label] ?? 0x95a5a6,
      description: descLines.join('\n'),
      fields,
      footer: { text: `store-assessment nightly sweep · /arbitrage/store-assessment/${slug} · engine v${a.engineVersion}` },
      timestamp: a.scannedAt,
    }],
  };
}
