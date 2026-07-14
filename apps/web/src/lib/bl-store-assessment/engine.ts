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
  type OverlapSection, type OverlapTagStat, type OverlapTagValue,
  type Verdict, type Condition, type ItemTypeCode, DEFAULT_INPUTS,
  type SetsSection, type SetDecisionRow, type StrCoverageSection, type StrGateColumn,
} from './types';
import { loadOwnStockIndex, classifyOverlap, type OwnStockIndex } from './overlap';
import { readSetsIntel, ASIN_TRUST_MIN, type SetIntel } from './sets-intel';
import { calculateAmazonFBMProfit } from '../arbitrage/calculations';
import { resolveBareCmfLots, isBareCmf } from './cmf-resolve';

/**
 * Bumped when scoring semantics change; persisted with every run.
 * v2 = audit fixes 2026-07-09. v3 = additive lot-overlap vs our own inventory.
 * v4 = additive SETS decision section (Amazon/POV/BL three-way, separate from grade).
 * v5 = STR is QUANTITY basis everywhere (matches bl-basket), and every buying view
 *      shows S-type lots as a DISTINCT split (Chris 2026-07-14: sets visible in all
 *      mechanisms, clearly separate, so they can carry their own decision — the [12]
 *      SETS view holds the per-set channel verdicts).
 * v6 = approved two-table format (Chris 2026-07-14): Table A = P&M-only STR gate table
 *      (bl-basket cart scope); Table B = SETS by sales method incl. CMF identity rows.
 *      Bare-CMF listings are name-RESOLVED to per-figure ids (cmf-resolve.ts);
 *      incomplete S-lots never price against complete-set guides.
 */
export const ENGINE_VERSION = 6;

/** Complete CMFs are BL-typed as sets but are commercially minifigs — they stay in the
 * normal Bricqer lot universe and NEVER enter the sets decision. */
const isCmf = (itemNo: string): boolean => /^col/i.test(itemNo);

/**
 * Worldwide 6-mo averages run ~11% below UK (2026-07-07 pg_summary coverage study,
 * UK+11% gap). Applied to world-fallback benchmarks so ask-vs-market and resale
 * projections aren't systematically biased against UK stores.
 */
export const WORLD_TO_UK_UPLIFT = 1.11;

// ---- damage-note filter (mirrors bl-basket, negation + boilerplate aware) ----

// Exported: bl-basket imports this so both damage filters stay in lockstep — its private
// copy missed the bite/teeth expansion and let the bitemark Hulk into a wanted list
// (caught live 2026-07-14).
export const DAMAGE_KEYWORDS = new Set([
  'dent', 'dents', 'scratch', 'scratches', 'scratched', 'crack', 'cracks', 'cracked',
  'chip', 'chipped', 'chips', 'damage', 'damaged', 'damages', 'fade', 'faded',
  'yellow', 'yellowed', 'yellowing', 'marked', 'marks', 'broken', 'bent',
  'tear', 'torn', 'sticky', 'cloudy', 'scuffed', 'scuff', 'worn',
  'discolour', 'discoloured', 'discolor', 'discolored', 'bitten', 'warped', 'flaw', 'flawed',
  // bite/teeth damage (missed a live Hulk "several bitemarks on the head", 2026-07-13)
  'bite', 'bites', 'bitemark', 'bitemarks', 'teeth', 'tooth', 'gnaw', 'gnawed', 'chew', 'chewed',
  // wear (Chris 2026-07-14: "minor wear"/"minimal wear on legs" must not pass — only
  // 'worn' was listed). Token matching means 'wearing' is unaffected. 'playwear' covers
  // "playwear on the head"-style notes.
  'wear', 'playwear',
  // other unambiguous condition-note damage (completeness handled separately via invComplete,
  // so 'missing'/'incomplete' are deliberately excluded; 'hole'/'cut' excluded — legit part names)
  'glued', 'repaired', 'melted', 'burnt', 'burned', 'stain', 'stained', 'mould', 'mouldy',
  'rusty', 'brittle', 'snapped', 'ripped',
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
  // Boilerplate exemption is for repeated DISCLAIMER SENTENCES ("used parts may have
  // small marks..."), not short repeated damage notes: Agnes stamped a bare "minor wear"
  // on 3% of stock and the exemption waved 20 damaged lots into a wanted list
  // (2026-07-14). A genuine disclaimer is a sentence — require length before exempting.
  if (desc.trim().length >= 40 && boilerplate.has(desc.trim())) return false;
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

// One price scale everywhere: per-lot buckets, the store label, and the verdict's
// price signal all break at the same points.
export const PRICE_BANDS = { under: 0.70, keen: 0.95, atMarket: 1.15, premium: 1.50 };

function classifyPosition(askVsMarket: number | null): PricePosition {
  if (askVsMarket == null) return 'UNKNOWN';
  if (askVsMarket < PRICE_BANDS.under) return 'UNDER';
  if (askVsMarket < PRICE_BANDS.keen) return 'KEEN';
  if (askVsMarket < PRICE_BANDS.atMarket) return 'AT-MARKET';
  if (askVsMarket < PRICE_BANDS.premium) return 'PREMIUM';
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
  pvIn: PriceGuideView | undefined,
  supply: WorldSupply | undefined,
  boilerplate: Set<string>,
  inp: AssessmentInputs,
): ScoredLot {
  // Ambiguous CMF identity: a bare "col13" S-lot matches the catalog entry for the
  // COMPLETE SERIES BOX — benchmarking a £3 figure against a £25 box produced fake 70%+
  // margins (Alpine8 2026-07-14). Name-resolvable lots were re-keyed to their figure id
  // upstream (cmf-resolve.ts); whatever is STILL bare here has no identity → no benchmark.
  const ambiguousCmf = isBareCmf(lot);
  // Set condition guard (Chris 2026-07-14 "be careful on set condition"): an INCOMPLETE
  // S-lot must never price against the complete-set guide.
  const incompleteSet = lot.itemType === 'S' && /incomplete/i.test(lot.invComplete ?? '');
  // Grounded lens (Chris 2026-07-14): once a store has been fully price-scanned, a
  // checked tuple with no UK sales is GROUND TRUTH ("no UK market"), not a gap to
  // estimate — world-calibrated fallback is for triage of unswept stores only.
  const pv = ambiguousCmf || incompleteSet || (inp.ukGroundedOnly && pvIn?.coverage === 'world_fallback') ? undefined : pvIn;
  const condition: Condition = lot.invNew === 'New' ? 'N' : 'U';
  const side: SideView | null = pv ? (condition === 'N' ? pv.new : pv.used) : null;
  const priceSource: PriceSource = pv?.coverage === 'uk' ? 'uk' : pv?.coverage === 'world_fallback' ? 'world' : 'none';

  // Benchmark: UK sold avg where covered; worldwide avg calibrated up to UK level otherwise.
  const rawAvg = side?.soldAvg ?? null;
  const benchmarkAvg = rawAvg && rawAvg > 0
    ? round(priceSource === 'world' ? rawAvg * WORLD_TO_UK_UPLIFT : rawAvg, 4)
    : null;
  const strLots = side?.strLots ?? null;
  const strQty = side?.strQty ?? null;
  const worldSupplyLots = supply ? (condition === 'N' ? supply.stockLotsNew : supply.stockLotsUsed) : null;

  const ask = lot.unitPriceGBP;
  const damageNote = hasDamageNote(lot.description, boilerplate);
  const askVsMarket = benchmarkAvg ? ask / benchmarkAvg : null;

  // What we'd realise reselling it: parts/minifigs priced by the Bricqer formula,
  // sets by their whole-set 6mo sold avg (modelling, not mirroring — Bricqer doesn't
  // auto-price sets).
  const ourList = lot.itemType === 'S'
    ? benchmarkAvg
    : bricqerListPrice(benchmarkAvg, condition, strQty ?? 0);

  const feePct = inp.feeModel.blFee + inp.feeModel.bricqerFee + inp.feeModel.paypalPct;
  const netPerUnit = ourList == null ? null : ourList * (1 - feePct) - ask - inp.inboundPerUnit;
  const marginPct = ourList && ourList > 0 && netPerUnit != null ? netPerUnit / ourList : null;
  const lotProfit = netPerUnit == null ? null : netPerUnit * lot.invQty;

  const eligible = ask >= inp.minAsk && !damageNote;
  const withinMargin = eligible && netPerUnit != null && netPerUnit > 0 && marginPct != null && marginPct >= inp.minMargin;
  // QUANTITY-basis STR (Chris 2026-07-14) — consistent with bl-basket.
  const highStr = eligible && strQty != null && strQty >= inp.minStr;
  const magnet = eligible && highStr && worldSupplyLots != null && worldSupplyLots > 0 && worldSupplyLots <= inp.magnetMaxSupplyLots;

  return {
    invID: lot.invID, itemType: lot.itemType, itemNo: lot.itemNo, colourId: lot.colourId,
    colourName: lot.colourName, itemName: lot.itemName, condition, invQty: lot.invQty,
    ask, lotAskValue: round(ask * lot.invQty), damageNote,
    benchmarkAvg, strLots, strQty, worldSupplyLots, demandRank: supply?.demandRank ?? null,
    priceSource, askVsMarket, position: classifyPosition(askVsMarket),
    ourList: ourList == null ? null : round(ourList, 4),
    netPerUnit: netPerUnit == null ? null : round(netPerUnit, 4),
    marginPct: marginPct == null ? null : round(marginPct, 4),
    lotProfit: lotProfit == null ? null : round(lotProfit),
    withinMargin, highStr, magnet,
    // Overlap is a post-pass (assembleAssessment) — scoring never depends on it.
    overlap: null, ourQty: null, ourSoldWindow: null,
    cmfResolved: lot.cmfResolved ?? false,
  };
}

// ---- section builders ----

function buildSize(scored: ScoredLot[]): SizeSection {
  const totalLots = scored.length;
  const totalPieces = sum(scored.map((s) => s.invQty));
  const totalValue = round(sum(scored.map((s) => s.lotAskValue)));
  const byTypeMap = new Map<ItemTypeCode, ScoredLot[]>();
  for (const s of scored) {
    let rows = byTypeMap.get(s.itemType);
    if (!rows) byTypeMap.set(s.itemType, (rows = []));
    rows.push(s);
  }
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
  const covered = scored.filter((s) => s.askVsMarket != null && s.position !== 'UNKNOWN');
  const coveredValue = round(sum(covered.map((s) => s.lotAskValue)));
  const order: PricePosition[] = ['UNDER', 'KEEN', 'AT-MARKET', 'PREMIUM', 'OVER'];
  const positions: Bucket[] = order.map((p) => {
    const rows = covered.filter((s) => s.position === p);
    const value = round(sum(rows.map((r) => r.lotAskValue)));
    return { key: p, lots: rows.length, pieces: sum(rows.map((r) => r.invQty)), value, valueShare: coveredValue ? round(value / coveredValue, 4) : 0 };
  });
  const wm = weightedMedian(covered.map((s) => ({ value: s.askVsMarket as number, weight: s.lotAskValue })));
  // Label breaks on the same bands as the per-lot buckets: cheap = below KEEN's
  // ceiling, premium = at/above AT-MARKET's ceiling.
  const label: PricingSection['label'] =
    wm == null ? 'unknown' : wm < PRICE_BANDS.keen ? 'cheap' : wm < PRICE_BANDS.atMarket ? 'at-market' : 'premium';
  return { covered: covered.length, weightedMedianAskVsMarket: wm == null ? null : round(wm, 3), label, positions };
}

function buildPartMix(scored: ScoredLot[]): PartMixSection {
  const cells = new Map<string, PartMixCell>();
  for (const s of scored) {
    const k = `${s.itemType}:${s.condition}`;
    const c = cells.get(k) ?? { itemType: s.itemType, condition: s.condition, lots: 0, pieces: 0, value: 0 };
    c.lots += 1; c.pieces += s.invQty; c.value += s.lotAskValue;
    cells.set(k, c);
  }
  for (const c of cells.values()) c.value = round(c.value);
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
    top: [...hs].sort((a, b) => (b.strQty ?? 0) - (a.strQty ?? 0)).slice(0, 15),
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

/**
 * Months-of-cover distribution. `soldQtyOf` returns the market 6-mo sold qty, or
 * null when the lot has NO benchmark at all — those go to a separate no-data bucket
 * and are excluded from the motivated-seller ratio, so poor cache coverage can't
 * masquerade as dead stock. A benchmark with zero sales is genuinely dead.
 */
function buildAgeing(scored: ScoredLot[], soldQtyOf: (s: ScoredLot) => number | null): AgeingSection {
  const totalValue = sum(scored.map((s) => s.lotAskValue));
  type Acc = { lots: number; pieces: number; value: number };
  const z = (): Acc => ({ lots: 0, pieces: 0, value: 0 });
  const buckets = { fresh: z(), normal: z(), overstock: z(), dead: z(), noData: z() };
  const add = (b: Acc, s: ScoredLot) => { b.lots += 1; b.pieces += s.invQty; b.value += s.lotAskValue; };
  for (const s of scored) {
    const sold6m = soldQtyOf(s);
    if (sold6m == null) { add(buckets.noData, s); continue; }
    if (sold6m <= 0) { add(buckets.dead, s); continue; }
    const mos = s.invQty / (sold6m / 6); // months of cover at market rate
    if (mos < 3) add(buckets.fresh, s);
    else if (mos < 12) add(buckets.normal, s);
    else if (mos < 36) add(buckets.overstock, s);
    else add(buckets.dead, s);
  }
  const mk = (key: string, b: Acc): Bucket => ({ key, lots: b.lots, pieces: b.pieces, value: round(b.value), valueShare: totalValue ? round(b.value / totalValue, 4) : 0 });
  const benchmarkedValue = totalValue - buckets.noData.value;
  const benchmarkedValueShare = totalValue ? round(benchmarkedValue / totalValue, 4) : 0;
  const overstockValueShare = benchmarkedValue > 0 ? round((buckets.overstock.value + buckets.dead.value) / benchmarkedValue, 4) : 0;
  return {
    buckets: [
      mk('fresh (<3mo)', buckets.fresh), mk('normal (3–12mo)', buckets.normal),
      mk('overstock (12–36mo)', buckets.overstock), mk('dead (>36mo / no sales)', buckets.dead),
      mk('no benchmark data', buckets.noData),
    ],
    overstockValueShare,
    benchmarkedValueShare,
    // Don't call a seller motivated off a sliver of benchmarked value.
    motivatedSeller: overstockValueShare >= 0.5 && benchmarkedValueShare >= 0.3,
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

/** Roll up overlap tags over the BUYABLE lots — the actionable set. */
function buildOverlap(scored: ScoredLot[], index: OwnStockIndex | null | undefined): OverlapSection {
  const buyable = scored.filter((s) => s.withinMargin);
  if (!index) {
    return {
      available: false, snapshotAt: null, salesWindowDays: null,
      buyableTags: [], untaggedBuyableLots: buyable.length, freshNetShare: null,
    };
  }
  const order: OverlapTagValue[] = ['NEW', 'RESTOCK_OUT', 'RESTOCK_THIN', 'DUPLICATE'];
  const buyableTags: OverlapTagStat[] = order.map((tag) => {
    const rows = buyable.filter((s) => s.overlap === tag);
    return {
      tag,
      lots: rows.length,
      outlay: round(sum(rows.map((s) => s.ask * s.invQty))),
      projectedNet: round(sum(rows.map((s) => s.lotProfit ?? 0))),
    };
  });
  const totalNet = sum(buyable.map((s) => s.lotProfit ?? 0));
  const freshNet = sum(buyable.filter((s) => s.overlap === 'NEW' || s.overlap === 'RESTOCK_OUT').map((s) => s.lotProfit ?? 0));
  return {
    available: true,
    snapshotAt: index.snapshotAt,
    salesWindowDays: index.salesWindowDays,
    buyableTags,
    untaggedBuyableLots: buyable.filter((s) => s.overlap == null).length,
    freshNetShare: totalNet > 0 ? round(freshNet / totalNet, 4) : null,
  };
}

/**
 * Verdict calibration. Cherry-pick-first: arbitrage IS cherry-picking, so the money
 * on the table (buyable net + breadth) dominates the grade. Whole-store price posture
 * is only a search-cost modifier — a premium store hiding a strong sub-basket should
 * read REVIEW, not SKIP.
 */
const VERDICT = {
  weights: { value: 0.45, efficiency: 0.15, magnet: 0.15, price: 0.10, coverage: 0.15 },
  /** £ projected net that maxes the value signal. */
  netSaturationGbp: 150,
  /** Buyable-lot count that maxes the breadth half of the value signal. */
  lotsSaturation: 40,
  /** Magnet-lot count that maxes the magnet signal. */
  magnetSaturation: 15,
  /** Grade thresholds. */
  buyAt: 60, reviewAt: 35,
  /** Hard SKIP floor: nothing meaningful to buy, whatever the other signals say. */
  minNetGbp: 10, minLots: 3,
} as const;

interface VerdictCaveats { scanTruncated: boolean }

function buildVerdict(
  pricing: PricingSection, margin: MarginSection, confidence: ConfidenceSection,
  magnets: MagnetSection, caveats: VerdictCaveats,
): Verdict {
  const wm = pricing.weightedMedianAskVsMarket;
  const value = 0.7 * clamp01(margin.projectedNet / VERDICT.netSaturationGbp) + 0.3 * clamp01(margin.lots / VERDICT.lotsSaturation);
  const efficiency = clamp01((margin.roiPct ?? 0) / 100);
  const magnet = clamp01(magnets.lots / VERDICT.magnetSaturation);
  // Search-cost modifier on the shared price bands: UNDER-floor → 1, AT-MARKET ceiling → 0.
  const price = wm == null ? 0.5 : clamp01((PRICE_BANDS.atMarket - wm) / (PRICE_BANDS.atMarket - PRICE_BANDS.under));
  // Benchmark confidence: UK counts in full, calibrated world-fallback at half.
  const coverage = clamp01(confidence.ukValueShare + 0.5 * confidence.worldValueShare);
  const w = VERDICT.weights;
  const grade = round(100 * (w.value * value + w.efficiency * efficiency + w.magnet * magnet + w.price * price + w.coverage * coverage), 1);
  let label: Verdict['label'] = grade >= VERDICT.buyAt ? 'BUY' : grade >= VERDICT.reviewAt ? 'REVIEW' : 'SKIP';
  if (margin.projectedNet < VERDICT.minNetGbp && margin.lots < VERDICT.minLots) label = 'SKIP';

  const reasons: string[] = [];
  reasons.push(`${margin.lots} lots within margin → £${margin.projectedNet.toFixed(2)} projected net${margin.blendedMarginPct != null ? ` (${margin.blendedMarginPct}% margin)` : ''}${margin.roiPct != null ? `, ${margin.roiPct}% ROI` : ''}.`);
  reasons.push(wm == null ? 'No price benchmark coverage — cannot judge pricing.' : `Prices at ${Math.round(wm * 100)}% of 6-mo market avg (${pricing.label}) — search-cost signal only.`);
  if (magnets.lots) reasons.push(`${magnets.lots} magnet lots (scarce + selling) — ${magnets.alsoWithinMargin} also within buying margin.`);
  reasons.push(`Benchmarks: ${Math.round(confidence.ukValueShare * 100)}% of value UK data, ${Math.round(confidence.worldValueShare * 100)}% worldwide (+${Math.round((WORLD_TO_UK_UPLIFT - 1) * 100)}% UK calibration).`);
  if (caveats.scanTruncated) reasons.push('⚠ Inventory scan truncated at the page cap — totals and buyables understate the store.');
  if (confidence.noneValueShare > 0.3) reasons.push(`⚠ ${Math.round(confidence.noneValueShare * 100)}% of store value has NO benchmark — grade is low-confidence.`);

  const headline = margin.lots
    ? `£${margin.projectedNet.toFixed(2)} projected net across ${margin.lots} buyable lots${margin.blendedMarginPct != null ? ` (${margin.blendedMarginPct}% margin)` : ''}`
    : 'No lots clear the buying margin';
  return {
    grade, label, headline, reasons,
    signals: { value: round(value, 3), efficiency: round(efficiency, 3), magnet: round(magnet, 3), price: round(price, 3), coverage: round(coverage, 3) },
  };
}

// ---- STR × coverage: inclusive gate columns (Chris 2026-07-14) ----

const STR_GATES = [0, 0.25, 0.5, 0.75, 1.0];

/** Null-propagating median (the file's shared `median` returns 0 on empty, which would
 * render as a real value in the gate table). */
function medianOrNull(xs: number[]): number | null {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function buildStrCoverage(scored: ScoredLot[]): StrCoverageSection {
  const coverage = {
    totalLots: scored.length,
    ukLots: scored.filter((s) => s.priceSource === 'uk').length,
    worldLots: scored.filter((s) => s.priceSource === 'world').length,
    noneLots: scored.filter((s) => s.priceSource === 'none').length,
  };
  const gates: StrGateColumn[] = STR_GATES.map((gate) => {
    const sel = scored.filter((s) => s.withinMargin && (s.strQty ?? 0) >= gate);
    const outlay = sum(sel.map((s) => s.lotAskValue));
    const net = sum(sel.map((s) => s.lotProfit ?? 0));
    const listValue = sum(sel.map((s) => (s.ourList ?? 0) * s.invQty));
    // Market months-of-supply per lot: 6-month window ÷ qty sell-through. Capped at 36
    // so dead-slow lots don't swamp the medians.
    const months = sel.map((s) => (s.strQty && s.strQty > 0 ? Math.min(36, 6 / s.strQty) : 36));
    const med = medianOrNull(months);
    // Profit-weighted 80th percentile of months — when ~80% of the net has cleared.
    let monthsTo80: number | null = null;
    if (sel.length && net > 0) {
      const byMonths = sel
        .map((s, i) => ({ m: months[i], p: Math.max(0, s.lotProfit ?? 0) }))
        .sort((a, b) => a.m - b.m);
      let acc = 0;
      for (const r of byMonths) {
        acc += r.p;
        if (acc >= net * 0.8) { monthsTo80 = r.m; break; }
      }
    }
    return {
      gate,
      lots: sel.length,
      outlay: round(outlay),
      net: round(net),
      marginPct: listValue > 0 ? round(net / listValue, 4) : null,
      roiPct: outlay > 0 ? round(net / outlay, 4) : null,
      medianStr: medianOrNull(sel.map((s) => s.strQty ?? 0)),
      medianMonths: med == null ? null : round(med, 1),
      monthsTo80PctNet: monthsTo80 == null ? null : round(monthsTo80, 1),
      capacityPerLotMo: sel.length && med ? round(net / sel.length / med, 3) : null,
      addlLots: sel.filter((s) => s.overlap === 'NEW' || s.overlap === 'RESTOCK_OUT').length,
      addlNet: round(sum(sel.filter((s) => s.overlap === 'NEW' || s.overlap === 'RESTOCK_OUT').map((s) => s.lotProfit ?? 0))),
      pmLots: sel.filter((s) => s.itemType !== 'S').length,
      pmNet: round(sum(sel.filter((s) => s.itemType !== 'S').map((s) => s.lotProfit ?? 0))),
      setLots: sel.filter((s) => s.itemType === 'S').length,
      setNet: round(sum(sel.filter((s) => s.itemType === 'S').map((s) => s.lotProfit ?? 0))),
    };
  });
  return { coverage, gates };
}

// ---- sets decision (separate from the parts grade) ----

/** POV must clear this multiple of the ask before part-out beats flipping — parting out
 * is labour-heavy, so a thin multiple isn't worth the bench time. */
const POV_MULTIPLE_MIN = 2.0;
/** ...and the absolute POV-vs-ask gap must be worth the labour at all. */
const POV_MIN_GAP_GBP = 10;

function buildSets(
  scored: ScoredLot[],
  setsIntel: Map<string, SetIntel>,
  inputs: AssessmentInputs,
): SetsSection {
  const allS = scored.filter((s) => s.itemType === 'S');
  const setLots = allS.filter((s) => !isCmf(s.itemNo));
  const cmfPriced = allS.filter((s) => isCmf(s.itemNo) && s.itemNo.includes('-'));
  const cmfBare = allS.filter((s) => isCmf(s.itemNo) && !s.itemNo.includes('-'));
  const rows: SetDecisionRow[] = [];
  const mkRow = () => ({ lots: 0, outlay: 0, net: 0 });
  const methods = {
    flipAmazon: mkRow(), sellBl: mkRow(), partOut: mkRow(), skip: mkRow(),
    cmfIdentified: mkRow(), cmfNoIdentity: mkRow(),
  };
  const add = (m: { lots: number; outlay: number; net: number }, s: ScoredLot, netU: number | null) => {
    m.lots += 1; m.outlay += s.lotAskValue; if (netU != null) m.net += netU * s.invQty;
  };

  for (const s of setLots) {
    const intel = setsIntel.get(s.itemNo);
    // blNet: the engine's own scoring already models selling at BL whole-set 6mo avg.
    const blNet = s.damageNote ? null : s.netPerUnit;
    const asinTrusted = !!intel?.amazonBuyBox && (intel?.asinConfidence ?? 0) >= ASIN_TRUST_MIN;
    // Amazon flip is NEW-only (used sets aren't Amazon inventory for us).
    const amazonNet =
      s.condition === 'N' && !s.damageNote && asinTrusted && intel?.amazonBuyBox
        ? (calculateAmazonFBMProfit(intel.amazonBuyBox, s.ask)?.totalProfit ?? null)
        : null;
    const povGbp = intel ? intel.povSoldGbp[s.condition] : null;
    const povMultiple = povGbp != null && s.ask > 0 ? round(povGbp / s.ask, 2) : null;

    const channels: Array<{ verdict: SetDecisionRow['verdict']; net: number }> = [];
    if (blNet != null && blNet > 0) channels.push({ verdict: 'SELL-BL', net: blNet });
    if (amazonNet != null && amazonNet > 0) channels.push({ verdict: 'FLIP-AMAZON', net: amazonNet });
    channels.sort((a, b) => b.net - a.net);
    let best: { verdict: SetDecisionRow['verdict']; net: number } | null = channels[0] ?? null;

    // Part-out wins only when POV dwarfs both the ask and the best flip channel.
    const povWins =
      povGbp != null && povMultiple != null &&
      povMultiple >= POV_MULTIPLE_MIN && povGbp - s.ask >= POV_MIN_GAP_GBP &&
      (best == null || povGbp - s.ask > best.net * 2);

    let verdict: SetDecisionRow['verdict'];
    if (povWins) verdict = 'PART-OUT';
    else if (best && best.net >= Math.max(0.5, s.ask * inputs.minMargin)) verdict = best.verdict;
    else { verdict = 'SKIP'; best = null; }

    const bestNet = best?.net ?? null;
    if (verdict === 'FLIP-AMAZON') add(methods.flipAmazon, s, bestNet);
    else if (verdict === 'SELL-BL') add(methods.sellBl, s, bestNet);
    else if (verdict === 'PART-OUT') add(methods.partOut, s, povGbp == null ? null : povGbp - s.ask);
    else add(methods.skip, s, null);

    rows.push({
      itemNo: s.itemNo, setName: intel?.setName ?? s.itemName ?? null, condition: s.condition,
      invQty: s.invQty, ask: s.ask, blNet: blNet == null ? null : round(blNet, 2),
      amazonBuyBox: intel?.amazonBuyBox ?? null, amazonNet: amazonNet == null ? null : round(amazonNet, 2),
      asinTrusted, ebayNewMin: intel?.ebayNewMin ?? null,
      povGbp: povGbp == null ? null : round(povGbp, 2), povMultiple,
      verdict, bestNet: bestNet == null ? null : round(bestNet, 2),
    });
  }

  // Per-figure CMFs (suffixed originally or name-resolved): sellable on BL like
  // minifigs. Condition-matched pricing already happened in scoreLot.
  for (const s of cmfPriced) {
    if (s.withinMargin && s.netPerUnit != null && s.netPerUnit > 0) add(methods.cmfIdentified, s, s.netPerUnit);
    else add(methods.skip, s, null);
  }
  // Bare-series CMFs the resolver could NOT identify — unpriceable, surfaced as a category.
  for (const s of cmfBare) add(methods.cmfNoIdentity, s, null);

  rows.sort((a, b) => {
    const av = a.verdict === 'SKIP' ? -1 : (a.bestNet ?? 0) * a.invQty;
    const bv = b.verdict === 'SKIP' ? -1 : (b.bestNet ?? 0) * b.invQty;
    return bv - av;
  });

  const roundRow = (m: { lots: number; outlay: number; net: number }) => ({ lots: m.lots, outlay: round(m.outlay), net: round(m.net) });
  const sellable = {
    lots: methods.flipAmazon.lots + methods.sellBl.lots + methods.cmfIdentified.lots,
    outlay: methods.flipAmazon.outlay + methods.sellBl.outlay + methods.cmfIdentified.outlay,
    net: methods.flipAmazon.net + methods.sellBl.net + methods.cmfIdentified.net,
  };
  return {
    lots: allS.length,
    askValue: round(sum(allS.map((s) => s.lotAskValue))),
    methods: {
      flipAmazon: roundRow(methods.flipAmazon), sellBl: roundRow(methods.sellBl),
      partOut: roundRow(methods.partOut), skip: roundRow(methods.skip),
      cmfIdentified: roundRow(methods.cmfIdentified), cmfNoIdentity: roundRow(methods.cmfNoIdentity),
    },
    cmfResolvedCount: allS.filter((s) => s.cmfResolved).length,
    totalSellable: roundRow(sellable),
    decided: rows.slice(0, 20),
  };
}

// ---- entry point ----

export interface AssessArgs {
  slug: string;
  storeMeta: { storeId: number | null; storeName: string | null; country: string | null };
  lots: StoreLot[];
  profile: StoreProfile | null;
  mode: AssessMode;
  /** True when the inventory scrape hit its page cap — carried into the verdict caveats. */
  scanTruncated?: boolean;
  /** When set, suggested lots are overlap-tagged against THIS user's Bricqer stock + sales. */
  userId?: string | null;
  inputs?: Partial<AssessmentInputs>;
  scannedAt?: string;
}

export async function computeStoreAssessment(supabase: SupabaseClient, args: AssessArgs): Promise<StoreAssessment> {
  const inputs: AssessmentInputs = { ...DEFAULT_INPUTS, ...(args.inputs ?? {}), feeModel: { ...DEFAULT_INPUTS.feeModel, ...(args.inputs?.feeModel ?? {}) } };

  // Resolve bare-CMF identities BEFORE building cache refs, so the per-figure guides
  // are what we read (assembleAssessment re-resolves idempotently).
  args = { ...args, lots: resolveBareCmfLots(args.lots).lots };

  // Dedupe item refs for the cache reads.
  const refs: ItemRef[] = [];
  const seen = new Set<string>();
  for (const l of args.lots) {
    const k = pgKey(l.itemType, l.itemNo, blColour(l));
    if (seen.has(k)) continue;
    seen.add(k);
    refs.push({ itemType: l.itemType, itemNo: l.itemNo, colourId: blColour(l), scheme: 'bl' });
  }

  const [pgMap, supplyMap, ownStock, setsIntel] = await Promise.all([
    readPriceGuide(supabase, refs, { ttlDays: inputs.cacheTtlDays ?? undefined }),
    // refs were built with blColour() already applied — colourId is canonical here.
    readWorldSupply(supabase, refs.map((r) => ({ itemType: r.itemType, itemNo: r.itemNo, blColourId: r.colourId }))),
    args.userId ? loadOwnStockIndex(supabase, args.userId) : Promise.resolve(null),
    readSetsIntel(supabase, refs.filter((r) => r.itemType === 'S' && !isCmf(r.itemNo)).map((r) => r.itemNo)),
  ]);

  // AUTO lens: once ≥95% of this store's tuples have been price-checked (a full scan is
  // in place), switch to grounded UK-only pricing — world calibration is triage-of-gaps
  // only (Chris 2026-07-14).
  if (inputs.ukGroundedOnly == null) {
    const checked = refs.filter((r) => pgMap.has(pgKey(r.itemType, r.itemNo, r.colourId))).length;
    inputs.ukGroundedOnly = refs.length > 0 && checked / refs.length >= 0.95;
  }

  return assembleAssessment({ ...args, inputs, pgMap, supplyMap, ownStock, setsIntel });
}

export interface AssembleArgs extends Omit<AssessArgs, 'inputs'> {
  inputs: AssessmentInputs; // fully resolved (no partials)
  pgMap: Map<string, PriceGuideView>;
  supplyMap: Map<string, WorldSupply>;
  ownStock?: OwnStockIndex | null; // overlap index; absent → overlap.available = false
  /** Amazon/eBay/POV intel for proper sets; absent → sets section uses BL channel only. */
  setsIntel?: Map<string, SetIntel>;
}

/**
 * Pure assembly from already-read caches — the testable core. Everything above the
 * two cache reads lives here; `computeStoreAssessment` is just those reads + this.
 */
export function assembleAssessment(args: AssembleArgs): StoreAssessment {
  const { inputs, pgMap, supplyMap } = args;
  // Bare-CMF name resolution (idempotent — computeStoreAssessment already resolved so
  // its cache reads used the right ids; direct assemble callers get it here).
  const { lots } = resolveBareCmfLots(args.lots);
  const boilerplate = computeBoilerplate(lots);
  const scored = lots.map((l) => {
    const k = pgKey(l.itemType, l.itemNo, blColour(l));
    return scoreLot(l, pgMap.get(k), supplyMap.get(k), boilerplate, inputs);
  });

  // Per-lot 6mo market sold qty for the ageing proxy. null = NO benchmark (no-data
  // bucket); a covered row with 0 sales stays 0 (genuinely dead).
  const soldQtyByInv = new Map<number, number | null>();
  for (const l of lots) {
    const pv = pgMap.get(pgKey(l.itemType, l.itemNo, blColour(l)));
    const cond = l.invNew === 'New' ? 'new' : 'used';
    soldQtyByInv.set(l.invID, pv && pv.coverage !== 'none' ? (pv[cond] as SideView).soldQty : null);
  }

  // Overlap tagging vs OUR stock — post-pass so scoring stays independent of it.
  if (args.ownStock) {
    for (const s of scored) {
      const r = classifyOverlap(
        { itemType: s.itemType, itemNo: s.itemNo, blColourId: blColour(s), colourName: s.colourName, condition: s.condition },
        args.ownStock,
      );
      s.overlap = r.tag; s.ourQty = r.ourQty; s.ourSoldWindow = r.ourSoldWindow;
    }
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
  // v6 (approved format): the buying sections + grade are PARTS+MINIFIGS only — the
  // bl-basket cart scope. Every S-type lot is decided in the SETS section instead.
  const partsScored = scored.filter((s) => s.itemType !== 'S');
  const withinMargin = buildMargin(partsScored);
  const highStr = buildHighStr(partsScored);
  const magnets = buildMagnets(partsScored);
  const confidence = buildConfidence(partsScored);
  const ageing = buildAgeing(scored, (s) => soldQtyByInv.get(s.invID) ?? null);
  const concentration = buildConcentration(scored);
  const overlap = buildOverlap(scored, args.ownStock);
  const sets = buildSets(scored, args.setsIntel ?? new Map(), inputs);
  const strCoverage = buildStrCoverage(partsScored);
  const scanTruncated = args.scanTruncated ?? false;
  const verdict = buildVerdict(pricing, withinMargin, confidence, magnets, { scanTruncated });
  if (overlap.available && overlap.freshNetShare != null) {
    const fresh = overlap.buyableTags.filter((t) => t.tag === 'NEW' || t.tag === 'RESTOCK_OUT');
    verdict.reasons.push(`${sum(fresh.map((t) => t.lots))} buyable lots are fresh demand (new to us / sold-out restock) — ${Math.round(overlap.freshNetShare * 100)}% of the projected net.`);
  }
  if (sets.totalSellable.net >= 25 || sets.methods.cmfNoIdentity.lots >= 50) {
    verdict.reasons.push(
      `Sets (separate decision, NOT in this grade): £${sets.totalSellable.net.toFixed(2)} sellable net across ` +
        `${sets.totalSellable.lots} lot(s)${sets.methods.cmfNoIdentity.lots ? `; ${sets.methods.cmfNoIdentity.lots} CMF lot(s) unpriceable (no identity)` : ''} — see SETS section.`,
    );
  }

  return {
    engineVersion: ENGINE_VERSION,
    store: { slug: args.slug, storeId: args.storeMeta.storeId, storeName: args.storeMeta.storeName, country: args.storeMeta.country },
    mode: args.mode,
    scannedAt: args.scannedAt ?? new Date().toISOString(),
    scanTruncated,
    inputs,
    verdict, size, pricing, feedback: args.profile, partMix,
    withinMargin, highStr, magnets, confidence, ageing, concentration, overlap, sets, strCoverage,
  };
}
