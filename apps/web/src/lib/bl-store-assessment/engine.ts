/**
 * BL Store Assessment engine — pure compute over a scraped store + the cached
 * price-guide / STR / worldwide-supply layers.
 *
 * One scrape in, one StoreAssessment out. Every market number is sourced from the
 * Supabase caches via `readPriceGuide` (UK-first, worldwide fallback) plus a direct
 * pg_summary read for worldwide seller supply (magnets). No external network calls —
 * the CLI does the scraping; live gap-fill (full mode) happens before this runs.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { readPriceGuide, pgKey, type ItemRef, type PriceGuideView, type SideView } from '../bricklink/price-guide/read';
import { bricqerListPrice } from '../bricklink/bricqer-pricing';
import {
  type StoreLot, type StoreProfile, type ScoredLot, type AssessmentInputs, type AssessMode,
  type StoreAssessment, type PricePosition, type PriceSource, type Bucket, type SizeSection,
  type PricingSection, type PartMixCell, type PartMixSection, type MarginSection, type HighStrSection,
  type MagnetSection, type ConfidenceSection, type AgeingSection, type ConcentrationSection,
  type Verdict, type Condition, type ItemTypeCode, DEFAULT_INPUTS,
} from './types';

// ---- damage-note filter (mirrors bl-basket, negation + boilerplate aware) ----

const DAMAGE_KEYWORDS = new Set([
  'dent', 'dents', 'scratch', 'scratches', 'scratched', 'crack', 'cracks', 'cracked',
  'chip', 'chipped', 'chips', 'damage', 'damaged', 'damages', 'fade', 'faded',
  'yellow', 'yellowed', 'yellowing', 'marked', 'marks', 'broken', 'bent',
  'tear', 'torn', 'sticky', 'cloudy', 'scuffed', 'scuff', 'worn',
  'discolour', 'discoloured', 'discolor', 'discolored', 'bitten', 'warped', 'flaw', 'flawed',
]);
const NEGATION_PREFIXES: string[][] = [['no'], ['without'], ['not'], ['free', 'of'], ['free', 'from'], ['zero']];

/** Descriptions repeated on >=3% of stock are stock disclaimers, not per-item damage. */
function computeBoilerplate(lots: StoreLot[], pct = 0.03): Set<string> {
  const out = new Set<string>();
  if (lots.length === 0) return out;
  const counts = new Map<string, number>();
  for (const it of lots) {
    const d = (it.description ?? '').trim();
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const minOccur = Math.max(2, Math.ceil(lots.length * pct));
  for (const [desc, n] of counts) if (n >= minOccur) out.add(desc);
  return out;
}

function hasDamageNote(desc: string | null | undefined, boilerplate: Set<string>): boolean {
  if (!desc) return false;
  if (boilerplate.has(desc.trim())) return false;
  const cleaned = desc.toLowerCase().replace(/[-–—,;:()/]/g, ' ').replace(/[.!?"']/g, '').replace(/\s+/g, ' ').trim();
  const words = cleaned.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    if (!DAMAGE_KEYWORDS.has(words[i])) continue;
    let negated = false;
    for (const neg of NEGATION_PREFIXES) {
      const start = i - neg.length;
      if (start < 0) continue;
      let match = true;
      for (let k = 0; k < neg.length; k++) if (words[start + k] !== neg[k]) { match = false; break; }
      if (match) { negated = true; break; }
    }
    if (!negated && i + 1 < words.length && words[i + 1] === 'free') negated = true;
    if (!negated) return true;
  }
  return false;
}

// ---- small numeric helpers ----

const round = (n: number, dp = 2): number => Math.round(n * 10 ** dp) / 10 ** dp;
const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Value-weighted median of `value`s weighted by `weight`s. */
function weightedMedian(pairs: { value: number; weight: number }[]): number | null {
  const rows = pairs.filter((p) => p.weight > 0).sort((a, b) => a.value - b.value);
  if (rows.length === 0) return null;
  const total = sum(rows.map((r) => r.weight));
  let acc = 0;
  for (const r of rows) {
    acc += r.weight;
    if (acc >= total / 2) return r.value;
  }
  return rows[rows.length - 1].value;
}

function classifyPosition(askVsUk: number | null): PricePosition {
  if (askVsUk == null) return 'UNKNOWN';
  if (askVsUk < 0.70) return 'UNDER';
  if (askVsUk < 0.95) return 'KEEN';
  if (askVsUk < 1.15) return 'AT-MARKET';
  if (askVsUk < 1.50) return 'PREMIUM';
  return 'OVER';
}

// ---- worldwide supply (pg_summary) for magnet detection ----

interface WorldSupply { stockLotsNew: number | null; stockLotsUsed: number | null; demandRank: number | null }

async function readWorldSupply(
  supabase: SupabaseClient,
  refs: { itemType: ItemTypeCode; itemNo: string; blColourId: number }[],
): Promise<Map<string, WorldSupply>> {
  const out = new Map<string, WorldSupply>();
  const itemNos = [...new Set(refs.map((r) => r.itemNo))];
  if (itemNos.length === 0) return out;
  const COLS = 'item_type,item_no,colour_id,stock_new_lots,stock_used_lots,demand_rank';
  for (let i = 0; i < itemNos.length; i += 300) {
    const batch = itemNos.slice(i, i + 300);
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('bricklink_pg_summary_cache')
        .select(COLS)
        .in('item_no', batch)
        .order('id')
        .range(from, from + 999);
      if (error) throw new Error(`readWorldSupply failed: ${error.message}`);
      for (const r of (data ?? []) as Record<string, unknown>[]) {
        out.set(pgKey(String(r.item_type), String(r.item_no), Number(r.colour_id)), {
          stockLotsNew: r.stock_new_lots == null ? null : Number(r.stock_new_lots),
          stockLotsUsed: r.stock_used_lots == null ? null : Number(r.stock_used_lots),
          demandRank: r.demand_rank == null ? null : Number(r.demand_rank),
        });
      }
      if (!data || data.length < 1000) break;
      from += 1000;
    }
  }
  return out;
}

// ---- scoring ----

const blColour = (l: { itemType: ItemTypeCode; colourId: number }): number => (l.itemType === 'P' ? l.colourId : 0);

function scoreLot(
  lot: StoreLot,
  pv: PriceGuideView | undefined,
  supply: WorldSupply | undefined,
  boilerplate: Set<string>,
  inp: AssessmentInputs,
): ScoredLot {
  const condition: Condition = lot.invNew === 'New' ? 'N' : 'U';
  const side: SideView | null = pv ? (condition === 'N' ? pv.new : pv.used) : null;
  const priceSource: PriceSource = pv?.coverage === 'uk' ? 'uk' : pv?.coverage === 'world_fallback' ? 'world' : 'none';

  const ukSoldAvg = side?.soldAvg ?? null;
  const strLots = side?.strLots ?? null;
  const strQty = side?.strQty ?? null;
  const worldSupplyLots = supply ? (condition === 'N' ? supply.stockLotsNew : supply.stockLotsUsed) : null;

  const ask = lot.unitPriceGBP;
  const damageNote = hasDamageNote(lot.description, boilerplate);
  const askVsUk = ukSoldAvg && ukSoldAvg > 0 ? ask / ukSoldAvg : null;

  // What we'd realise reselling it: parts/minifigs priced by the Bricqer formula,
  // sets by their whole-set 6mo sold avg (modelling, not mirroring — Bricqer doesn't
  // auto-price sets).
  const ourList = lot.itemType === 'S'
    ? (ukSoldAvg && ukSoldAvg > 0 ? ukSoldAvg : null)
    : bricqerListPrice(ukSoldAvg, condition, strQty ?? 0);

  const feePct = inp.feeModel.blFee + inp.feeModel.bricqerFee + inp.feeModel.paypalPct;
  const netPerUnit = ourList == null ? null : ourList * (1 - feePct) - ask - inp.inboundPerUnit;
  const marginPct = ourList && ourList > 0 && netPerUnit != null ? netPerUnit / ourList : null;
  const lotProfit = netPerUnit == null ? null : netPerUnit * lot.invQty;

  const eligible = ask >= inp.minAsk && !damageNote;
  const withinMargin = eligible && netPerUnit != null && netPerUnit > 0 && marginPct != null && marginPct >= inp.minMargin;
  const highStr = eligible && strLots != null && strLots >= inp.minStr;
  const magnet = eligible && highStr && worldSupplyLots != null && worldSupplyLots > 0 && worldSupplyLots <= inp.magnetMaxSupplyLots;

  return {
    invID: lot.invID, itemType: lot.itemType, itemNo: lot.itemNo, colourId: lot.colourId,
    colourName: lot.colourName, itemName: lot.itemName, condition, invQty: lot.invQty,
    ask, lotAskValue: round(ask * lot.invQty), damageNote,
    ukSoldAvg, strLots, strQty, worldSupplyLots, demandRank: supply?.demandRank ?? null,
    priceSource, askVsUk, position: classifyPosition(askVsUk),
    ourList: ourList == null ? null : round(ourList, 4),
    netPerUnit: netPerUnit == null ? null : round(netPerUnit, 4),
    marginPct: marginPct == null ? null : round(marginPct, 4),
    lotProfit: lotProfit == null ? null : round(lotProfit),
    withinMargin, highStr, magnet,
  };
}

// ---- section builders ----

function buildSize(scored: ScoredLot[]): SizeSection {
  const totalLots = scored.length;
  const totalPieces = sum(scored.map((s) => s.invQty));
  const totalValue = round(sum(scored.map((s) => s.lotAskValue)));
  const byTypeMap = new Map<ItemTypeCode, ScoredLot[]>();
  for (const s of scored) (byTypeMap.get(s.itemType) ?? byTypeMap.set(s.itemType, []).get(s.itemType)!).push(s);
  const byType: Bucket[] = (['P', 'S', 'M'] as ItemTypeCode[])
    .filter((t) => byTypeMap.has(t))
    .map((t) => {
      const rows = byTypeMap.get(t)!;
      const value = round(sum(rows.map((r) => r.lotAskValue)));
      return { key: t === 'P' ? 'Parts' : t === 'S' ? 'Sets' : 'Minifigs', lots: rows.length, pieces: sum(rows.map((r) => r.invQty)), value, valueShare: totalValue ? round(value / totalValue, 4) : 0 };
    });
  return {
    totalLots, totalPieces, totalValue,
    avgValuePerLot: totalLots ? round(totalValue / totalLots, 4) : 0,
    medianLotPrice: round(median(scored.map((s) => s.ask)), 4),
    byType,
    biggestLots: [...scored].sort((a, b) => b.lotAskValue - a.lotAskValue).slice(0, 8),
  };
}

function buildPricing(scored: ScoredLot[]): PricingSection {
  const covered = scored.filter((s) => s.askVsUk != null && s.position !== 'UNKNOWN');
  const coveredValue = round(sum(covered.map((s) => s.lotAskValue)));
  const order: PricePosition[] = ['UNDER', 'KEEN', 'AT-MARKET', 'PREMIUM', 'OVER'];
  const positions: Bucket[] = order.map((p) => {
    const rows = covered.filter((s) => s.position === p);
    const value = round(sum(rows.map((r) => r.lotAskValue)));
    return { key: p, lots: rows.length, pieces: sum(rows.map((r) => r.invQty)), value, valueShare: coveredValue ? round(value / coveredValue, 4) : 0 };
  });
  const wm = weightedMedian(covered.map((s) => ({ value: s.askVsUk as number, weight: s.lotAskValue })));
  const label: PricingSection['label'] = wm == null ? 'unknown' : wm < 0.90 ? 'cheap' : wm <= 1.10 ? 'at-market' : 'premium';
  return { covered: covered.length, weightedMedianAskVsUk: wm == null ? null : round(wm, 3), label, positions };
}

function buildPartMix(scored: ScoredLot[]): PartMixSection {
  const cells = new Map<string, PartMixCell>();
  for (const s of scored) {
    const k = `${s.itemType}:${s.condition}`;
    const c = cells.get(k) ?? { itemType: s.itemType, condition: s.condition, lots: 0, pieces: 0, value: 0 };
    c.lots += 1; c.pieces += s.invQty; c.value = round(c.value + s.lotAskValue);
    cells.set(k, c);
  }
  const totalValue = round(sum(scored.map((s) => s.lotAskValue)));
  const newValue = round(sum(scored.filter((s) => s.condition === 'N').map((s) => s.lotAskValue)));
  const usedLots = scored.filter((s) => s.condition === 'U');
  const damaged = usedLots.filter((s) => s.damageNote).length;
  // setCompleteness is filled by the caller from raw invComplete (not on ScoredLot).
  const completeness = { complete: 0, incomplete: 0, sealed: 0, unknown: 0 };
  return {
    matrix: [...cells.values()].sort((a, b) => b.value - a.value),
    newValueShare: totalValue ? round(newValue / totalValue, 4) : 0,
    usedValueShare: totalValue ? round((totalValue - newValue) / totalValue, 4) : 0,
    damageNoteShare: usedLots.length ? round(damaged / usedLots.length, 4) : 0,
    setCompleteness: completeness,
  };
}

function buildMargin(scored: ScoredLot[]): MarginSection {
  const within = scored.filter((s) => s.withinMargin);
  const outlay = round(sum(within.map((s) => s.ask * s.invQty)));
  const projectedNet = round(sum(within.map((s) => s.lotProfit ?? 0)));
  const saleValue = sum(within.map((s) => (s.ourList ?? 0) * s.invQty));
  return {
    lots: within.length, outlay, projectedNet,
    blendedMarginPct: saleValue > 0 ? round((projectedNet / saleValue) * 100, 2) : null,
    roiPct: outlay > 0 ? round((projectedNet / outlay) * 100, 2) : null,
    top: [...within].sort((a, b) => (b.lotProfit ?? 0) - (a.lotProfit ?? 0)).slice(0, 12),
  };
}

function buildHighStr(scored: ScoredLot[]): HighStrSection {
  const hs = scored.filter((s) => s.highStr);
  return {
    lots: hs.length, value: round(sum(hs.map((s) => s.lotAskValue))),
    alsoWithinMargin: hs.filter((s) => s.withinMargin).length,
    top: [...hs].sort((a, b) => (b.strLots ?? 0) - (a.strLots ?? 0)).slice(0, 15),
  };
}

function buildMagnets(scored: ScoredLot[]): MagnetSection {
  const mg = scored.filter((s) => s.magnet);
  return {
    lots: mg.length, value: round(sum(mg.map((s) => s.lotAskValue))),
    alsoWithinMargin: mg.filter((s) => s.withinMargin).length,
    top: [...mg].sort((a, b) => (a.worldSupplyLots ?? 99) - (b.worldSupplyLots ?? 99) || (b.strLots ?? 0) - (a.strLots ?? 0)).slice(0, 15),
  };
}

function buildConfidence(scored: ScoredLot[]): ConfidenceSection {
  const totalValue = sum(scored.map((s) => s.lotAskValue));
  const share = (pred: (s: ScoredLot) => boolean) => (totalValue ? round(sum(scored.filter(pred).map((s) => s.lotAskValue)) / totalValue, 4) : 0);
  return {
    ukValueShare: share((s) => s.priceSource === 'uk'),
    worldValueShare: share((s) => s.priceSource === 'world'),
    noneValueShare: share((s) => s.priceSource === 'none'),
    ukLotShare: scored.length ? round(scored.filter((s) => s.priceSource === 'uk').length / scored.length, 4) : 0,
  };
}

function buildAgeing(scored: ScoredLot[], soldQtyOf: (s: ScoredLot) => number | null): AgeingSection {
  const totalValue = sum(scored.map((s) => s.lotAskValue));
  type Acc = { lots: number; pieces: number; value: number };
  const z = (): Acc => ({ lots: 0, pieces: 0, value: 0 });
  const buckets = { fresh: z(), normal: z(), overstock: z(), dead: z() };
  const add = (b: Acc, s: ScoredLot) => { b.lots += 1; b.pieces += s.invQty; b.value += s.lotAskValue; };
  for (const s of scored) {
    const sold6m = soldQtyOf(s);
    if (!sold6m || sold6m <= 0) { add(buckets.dead, s); continue; }
    const mos = s.invQty / (sold6m / 6); // months of cover at market rate
    if (mos < 3) add(buckets.fresh, s);
    else if (mos < 12) add(buckets.normal, s);
    else if (mos < 36) add(buckets.overstock, s);
    else add(buckets.dead, s);
  }
  const mk = (key: string, b: Acc): Bucket => ({ key, lots: b.lots, pieces: b.pieces, value: round(b.value), valueShare: totalValue ? round(b.value / totalValue, 4) : 0 });
  const overstockValueShare = totalValue ? round((buckets.overstock.value + buckets.dead.value) / totalValue, 4) : 0;
  return {
    buckets: [mk('fresh (<3mo)', buckets.fresh), mk('normal (3–12mo)', buckets.normal), mk('overstock (12–36mo)', buckets.overstock), mk('dead (>36mo / no sales)', buckets.dead)],
    overstockValueShare,
    motivatedSeller: overstockValueShare >= 0.5,
  };
}

function buildConcentration(scored: ScoredLot[]): ConcentrationSection {
  const totalValue = sum(scored.map((s) => s.lotAskValue));
  const top10 = [...scored].sort((a, b) => b.lotAskValue - a.lotAskValue).slice(0, 10);
  return {
    top10ValueShare: totalValue ? round(sum(top10.map((s) => s.lotAskValue)) / totalValue, 4) : 0,
    distinctItems: new Set(scored.map((s) => `${s.itemType}:${s.itemNo}:${s.colourId}`)).size,
  };
}

function buildVerdict(pricing: PricingSection, margin: MarginSection, confidence: ConfidenceSection, magnets: MagnetSection): Verdict {
  const wm = pricing.weightedMedianAskVsUk;
  const price = wm == null ? 0.5 : clamp01((1.10 - wm) / (1.10 - 0.70));
  const marginSig = clamp01(margin.projectedNet / 100) * 0.6 + clamp01(margin.lots / 40) * 0.4;
  const coverage = clamp01(confidence.ukValueShare);
  const magnet = clamp01(magnets.lots / 15);
  const grade = round(100 * (0.40 * price + 0.30 * marginSig + 0.15 * coverage + 0.15 * magnet), 1);
  let label: Verdict['label'] = grade >= 60 ? 'BUY' : grade >= 35 ? 'REVIEW' : 'SKIP';
  if (margin.projectedNet < 10 && margin.lots < 3) label = 'SKIP';
  const reasons: string[] = [];
  reasons.push(wm == null ? 'No price benchmark coverage — cannot judge pricing.' : `Prices at ${Math.round(wm * 100)}% of 6-mo market avg (${pricing.label}).`);
  reasons.push(`${margin.lots} lots within margin → £${margin.projectedNet.toFixed(2)} projected net${margin.blendedMarginPct != null ? ` (${margin.blendedMarginPct}% margin)` : ''}.`);
  if (magnets.lots) reasons.push(`${magnets.lots} magnet lots (scarce + selling) — ${magnets.alsoWithinMargin} also within buying margin.`);
  reasons.push(`${Math.round(confidence.ukValueShare * 100)}% of store value has UK price data.`);
  const headline = margin.lots
    ? `£${margin.projectedNet.toFixed(2)} projected net across ${margin.lots} buyable lots${margin.blendedMarginPct != null ? ` (${margin.blendedMarginPct}% margin)` : ''}`
    : 'No lots clear the buying margin';
  return { grade, label, headline, reasons, signals: { price: round(price, 3), margin: round(marginSig, 3), coverage: round(coverage, 3), magnet: round(magnet, 3) } };
}

// ---- entry point ----

export interface AssessArgs {
  slug: string;
  storeMeta: { storeId: number | null; storeName: string | null; country: string | null };
  lots: StoreLot[];
  profile: StoreProfile | null;
  mode: AssessMode;
  inputs?: Partial<AssessmentInputs>;
  scannedAt?: string;
}

export async function computeStoreAssessment(supabase: SupabaseClient, args: AssessArgs): Promise<StoreAssessment> {
  const inputs: AssessmentInputs = { ...DEFAULT_INPUTS, ...(args.inputs ?? {}), feeModel: { ...DEFAULT_INPUTS.feeModel, ...(args.inputs?.feeModel ?? {}) } };

  // Dedupe item refs for the cache reads.
  const refs: ItemRef[] = [];
  const seen = new Set<string>();
  for (const l of args.lots) {
    const k = pgKey(l.itemType, l.itemNo, blColour(l));
    if (seen.has(k)) continue;
    seen.add(k);
    refs.push({ itemType: l.itemType, itemNo: l.itemNo, colourId: blColour(l), scheme: 'bl' });
  }

  const [pgMap, supplyMap] = await Promise.all([
    readPriceGuide(supabase, refs, { ttlDays: inputs.cacheTtlDays ?? undefined }),
    readWorldSupply(supabase, refs.map((r) => ({ itemType: r.itemType, itemNo: r.itemNo, blColourId: blColour({ itemType: r.itemType, colourId: r.colourId }) }))),
  ]);

  return assembleAssessment({ ...args, inputs, pgMap, supplyMap });
}

export interface AssembleArgs extends Omit<AssessArgs, 'inputs'> {
  inputs: AssessmentInputs; // fully resolved (no partials)
  pgMap: Map<string, PriceGuideView>;
  supplyMap: Map<string, WorldSupply>;
}

/**
 * Pure assembly from already-read caches — the testable core. Everything above the
 * two cache reads lives here; `computeStoreAssessment` is just those reads + this.
 */
export function assembleAssessment(args: AssembleArgs): StoreAssessment {
  const { inputs, lots, pgMap, supplyMap } = args;
  const boilerplate = computeBoilerplate(lots);
  const scored = lots.map((l) => {
    const k = pgKey(l.itemType, l.itemNo, blColour(l));
    return scoreLot(l, pgMap.get(k), supplyMap.get(k), boilerplate, inputs);
  });

  // Per-lot 6mo market sold qty (for the ageing proxy), keyed by scored order.
  const soldQtyByInv = new Map<number, number | null>();
  for (const l of lots) {
    const pv = pgMap.get(pgKey(l.itemType, l.itemNo, blColour(l)));
    const cond = l.invNew === 'New' ? 'new' : 'used';
    soldQtyByInv.set(l.invID, pv ? (pv[cond] as SideView).soldQty || null : null);
  }

  const size = buildSize(scored);
  const pricing = buildPricing(scored);
  const partMix = buildPartMix(scored);
  // set completeness from raw lots
  for (const l of lots.filter((x) => x.itemType === 'S')) {
    const c = (l.invComplete ?? '').toLowerCase();
    if (c.includes('sealed')) partMix.setCompleteness.sealed += 1;
    else if (c.includes('incomplete')) partMix.setCompleteness.incomplete += 1;
    else if (c.includes('complete')) partMix.setCompleteness.complete += 1;
    else partMix.setCompleteness.unknown += 1;
  }
  const withinMargin = buildMargin(scored);
  const highStr = buildHighStr(scored);
  const magnets = buildMagnets(scored);
  const confidence = buildConfidence(scored);
  const ageing = buildAgeing(scored, (s) => soldQtyByInv.get(s.invID) ?? null);
  const concentration = buildConcentration(scored);
  const verdict = buildVerdict(pricing, withinMargin, confidence, magnets);

  return {
    store: { slug: args.slug, storeId: args.storeMeta.storeId, storeName: args.storeMeta.storeName, country: args.storeMeta.country },
    mode: args.mode,
    scannedAt: args.scannedAt ?? new Date().toISOString(),
    inputs,
    verdict, size, pricing, feedback: args.profile, partMix,
    withinMargin, highStr, magnets, confidence, ageing, concentration,
  };
}
