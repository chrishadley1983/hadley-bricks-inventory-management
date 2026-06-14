/**
 * Terminal renderer for the store-quality scorecard.
 * Pure string output — no external deps.
 */

import type { ActionItem, ProfileRow, StoreQualityResult } from './types';

const gbp = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `£${n.toFixed(2)}`;
const pctf = (x: number | null | undefined) => `${Math.round((x ?? 0) * 100)}%`;
const pad = (s: string | number, w: number) => String(s).padEnd(w);
const padL = (s: string | number, w: number) => String(s).padStart(w);
const bar = (score: number, width = 20) => {
  const filled = Math.round((clamp(score, 0, 100) / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
};
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const rule = (c = '─', w = 72) => c.repeat(w);

function profileTable(title: string, rows: ProfileRow[]): string {
  const out = [`  ${title}`];
  for (const r of rows) {
    out.push(
      `    ${pad(r.bucket, 14)} ${padL(r.lots, 7)} lots  ${padL(gbp(r.value), 11)}  ${padL(pctf(r.valueShare), 5)}`
    );
  }
  return out.join('\n');
}

function actionTable(title: string, items: ActionItem[], top: number): string {
  if (items.length === 0) return `  ${title}: none`;
  const shown = items.slice(0, top);
  const out = [`  ${title}  (${items.length} lots, £${sum(items.map((i) => i.listValue)).toFixed(2)})`];
  for (const a of shown) {
    const colour = a.colorName ? ` ${a.colorName}` : '';
    out.push(
      `    ${pad(a.itemNumber + colour, 26)} ${pad(a.condition, 4)} ` +
        `${padL('×' + a.quantity, 5)} ${padL(gbp(a.bricqerPrice), 8)}  ${a.note}`
    );
  }
  if (items.length > top) out.push(`    … +${items.length - top} more`);
  return out.join('\n');
}

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

export function renderScorecard(r: StoreQualityResult, opts: { top?: number } = {}): string {
  const top = opts.top ?? 25;
  const L: string[] = [];

  L.push(rule('═'));
  L.push('  STORE QUALITY SCORECARD — Hadley Bricks BrickLink store');
  L.push(rule('═'));
  L.push(
    `  Segment: ${r.segment}   Window: ${r.windowDays}d   Generated: ${r.generatedAt.slice(0, 16).replace('T', ' ')}`
  );
  L.push(
    `  Snapshot: ${r.snapshotDate ? r.snapshotDate.slice(0, 10) : 'unknown'}` +
      (r.snapshotAgeDays !== null ? ` (${r.snapshotAgeDays}d old)` : '')
  );
  if (r.stale) {
    L.push('  ' + rule('!', 68));
    L.push(`  ⚠  STALE SNAPSHOT — figures are as of ${r.snapshotDate?.slice(0, 10)}. Refresh recommended.`);
    L.push('  ' + rule('!', 68));
  }
  L.push('');
  L.push(
    `  In scope: ${r.totals.lots.toLocaleString()} lots · ${r.totals.pieces.toLocaleString()} pieces · ${gbp(
      r.totals.value
    )} list value`
  );
  for (const c of r.composition) {
    L.push(`    ${pad(c.label, 9)} ${padL(c.lots, 7)} lots  ${padL(gbp(c.value), 11)}  ${padL(pctf(c.share), 5)}`);
  }
  L.push('');

  // ---- score ----
  L.push(rule());
  L.push(`  STORE QUALITY SCORE: ${r.compositeScore.toFixed(1)} / 100   ${bar(r.compositeScore)}`);
  L.push(rule());
  for (const d of r.dimensions) {
    L.push(
      `  ${pad(d.label, 26)} ${padL(d.score.toFixed(1), 5)}  ${bar(d.score, 14)}  ${padL('w' + Math.round(d.weight * 100) + '%', 5)}`
    );
    L.push(`  ${pad('', 26)} ${d.detail}`);
  }
  L.push('');

  // ---- profiles ----
  L.push(rule());
  L.push('  VELOCITY PROFILE (value-weighted)');
  L.push(profileTable('', r.velocityProfile));
  L.push('');
  L.push('  PRICE-POSITION PROFILE (price ÷ 6-month market avg)');
  L.push(profileTable('', r.pricePositionProfile));
  L.push('');

  // ---- picking ----
  L.push(rule());
  L.push('  PICKING PROFILE');
  L.push(`    Avg value per lot     ${gbp(r.picking.avgValuePerLot)}`);
  L.push(
    `    Sub-10p tail          ${pctf(r.picking.subFloorLotShare)} of lots · ${pctf(r.picking.subFloorValueShare)} of value`
  );
  L.push(`    Storage locations     ${r.picking.distinctLocations} (${r.picking.lotsPerLocation} lots/location)`);
  L.push(
    `    Grind-order picks      ${r.picking.grindOrderPickShare === null ? 'n/a' : pctf(r.picking.grindOrderPickShare)} of picks in <£10 / ≥10-lot orders`
  );
  L.push('');

  // ---- coverage ----
  L.push(rule());
  L.push('  COVERAGE (what we can measure)');
  L.push(`    Price coverage        ${pctf(r.coverage.priceCoverage)} of value has a usable 6-month avg`);
  L.push(`    Velocity coverage     ${pctf(r.coverage.velocityCoverage)} of value has a sale or market STR`);
  L.push(actionTable('Biggest BLIND lots (enrichment shortlist)', r.coverage.blindHighValue, Math.min(top, 15)));
  L.push('');

  // ---- actions ----
  L.push(rule('═'));
  L.push('  ACTION LISTS');
  L.push(rule('═'));
  L.push(actionTable('STUCK-HIGH — re-price toward market', r.actions['STUCK-HIGH'], top));
  L.push('');
  L.push(actionTable('UNDER-PRICED — nudge up (sells but cheap)', r.actions['UNDER-PRICED'], top));
  L.push('');
  L.push(actionTable('OVERSTOCK — stop re-sourcing / bulk-relist', r.actions['OVERSTOCK'], top));
  L.push('');
  L.push(actionTable('DEAD — quarantine / bundle (do NOT mass-cull)', r.actions['DEAD'], top));
  L.push('');
  L.push(actionTable('LOW-YIELD-PICK — bundle cheap movers', r.actions['LOW-YIELD-PICK'], top));
  L.push('');

  return L.join('\n');
}
