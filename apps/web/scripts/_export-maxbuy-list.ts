/**
 * _export-maxbuy-list.ts — max buy-in price list for retiring / soon-retiring sets.
 *
 * For every scored set that is retiring_soon or expected to retire by end-2026,
 * compute the max buy price using the HOUSE margin convention (vinted-sniper):
 *   margin % = profit / SALE price; green >= 25%, amber >= 15%; £4 ship
 *   => max_buy = sale*(1 - fees - margin) - ship  (0.58x sale for green @17% fees)
 * Sale price basis is the CONSERVATIVE prediction (half the predicted
 * appreciation); full-prediction max-buys are included in the CSV.
 *
 * Writes analysis/investment-maxbuy-YYYY-MM-DD.csv and prints the top rows.
 */
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import {
  computeMaxBuy,
  maxBuyForSale,
  MAX_BUY_GREEN_MARGIN,
  MAX_BUY_AMBER_MARGIN,
} from '../src/lib/investment/max-buy';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

(async () => {
  const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

  const { data, error } = await supabase
    .from('investment_predictions')
    .select(
      'set_num, investment_score, predicted_1yr_appreciation, predicted_1yr_price_gbp, confidence, risk_factors'
    )
    .not('predicted_1yr_appreciation', 'is', null)
    .order('investment_score', { ascending: false })
    .limit(1000);
  if (error) throw error;

  const setNums = (data ?? []).map((r) => (r as Record<string, unknown>).set_num as string);
  const setMap = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < setNums.length; i += 200) {
    const { data: sets } = await supabase
      .from('brickset_sets')
      .select('set_number, set_name, theme, uk_retail_price, retirement_status, expected_retirement_date')
      .in('set_number', setNums.slice(i, i + 200));
    for (const s of (sets ?? []) as unknown as Record<string, unknown>[]) {
      setMap.set(s.set_number as string, s);
    }
  }

  const rows: string[][] = [];
  for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
    const b = setMap.get(r.set_num as string);
    if (!b) continue;
    const status = b.retirement_status as string;
    const expected = b.expected_retirement_date as string | null;
    const inScope =
      status === 'retiring_soon' ||
      (status === 'available' && expected != null && expected <= '2026-12-31');
    if (!inScope) continue;

    const rrp = Number(b.uk_retail_price ?? 0);
    const predPct = Number(r.predicted_1yr_appreciation);
    if (!rrp || rrp <= 0) continue;

    const conf = Number(r.confidence ?? 0);
    const risks = (r.risk_factors as string[] | null) ?? [];
    const result = computeMaxBuy({
      rrp,
      predicted1yrAppreciationPct: predPct,
      confidence: conf,
      riskFactors: risks,
    });
    if (!result) continue;

    const pFull = result.fullPredictionSale;
    const pCons = rrp * (1 + predPct / 200); // p38-ish "half" basis
    const pP50 = rrp * (1 + (0.91 * predPct) / 100);
    const greenCons = maxBuyForSale(pCons, MAX_BUY_GREEN_MARGIN);
    const amberCons = maxBuyForSale(pCons, MAX_BUY_AMBER_MARGIN);
    const greenFull = maxBuyForSale(pFull, MAX_BUY_GREEN_MARGIN);
    const greenP50 = maxBuyForSale(pP50, MAX_BUY_GREEN_MARGIN);
    const highConfidence = result.tier === 'HIGH';
    const recommended = result.recommendedMaxBuy;
    const expectedSale = result.expectedSale;

    rows.push([
      r.set_num as string,
      String(b.set_name ?? ''),
      String(b.theme ?? ''),
      status,
      expected ?? '',
      rrp.toFixed(2),
      String(r.investment_score),
      predPct.toFixed(1),
      pFull.toFixed(2),
      pCons.toFixed(2),
      greenCons.toFixed(2),
      greenP50.toFixed(2),
      highConfidence ? 'HIGH' : 'standard',
      expectedSale.toFixed(2),
      recommended.toFixed(2),
      ((recommended / rrp) * 100).toFixed(0),
      amberCons.toFixed(2),
      greenFull.toFixed(2),
      String(r.confidence),
      risks.join('|'),
    ]);
  }

  // already ordered by score desc from the query
  const header = [
    'set_num', 'name', 'theme', 'status', 'expected_retirement', 'rrp',
    'score', 'pred_1yr_pct', 'pred_price_full', 'pred_price_cons',
    'maxbuy_green_p38', 'maxbuy_green_p50', 'tier', 'expected_sale_1yr', 'recommended_max_buy',
    'rec_pct_of_rrp', 'maxbuy_amber_p38', 'maxbuy_green_full',
    'confidence', 'risk_factors',
  ];
  const csv = [header, ...rows]
    .map((r) => r.map((c) => (c.includes(',') ? `"${c}"` : c)).join(','))
    .join('\n');

  const outDir = path.resolve(__dirname, '../../../analysis');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `investment-maxbuy-${new Date().toISOString().split('T')[0]}.csv`);
  fs.writeFileSync(outFile, csv);
  console.log(`[MaxBuy] ${rows.length} sets written to ${outFile}`);

  const high = rows.filter((r) => r[12] === 'HIGH');
  console.log(`\n${high.length} HIGH-confidence picks (p50 pricing applies):`);
  console.log('set | name | theme | rrp | score | pred% | rec_max_buy | %rrp');
  for (const r of high.slice(0, 30)) {
    console.log([r[0], r[1], r[2], r[5], r[6], r[7], r[14], r[15] + '%'].join(' | '));
  }
})();
