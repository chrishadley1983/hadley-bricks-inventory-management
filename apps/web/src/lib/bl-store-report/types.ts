/**
 * bl-store-report — THE common BL store decision report (2026-07-19 audit).
 *
 * One lens-neutral contract for "should I buy from this store, and what exactly":
 * every surface that reports on a BL store (store-assessment, bl-basket, nightly
 * sweep Discord cards, ad-hoc conversational queries) renders THIS structure via
 * render-cli / render-md — never an improvised table.
 *
 * The columns are Chris's actual decision set, ranked by how consistently he used
 * them across the Jul 12–19 sessions:
 *   1. STR (qty basis, UK-first, world fallback labelled †)
 *   2. Honest net (full 9.4% fees; the SELECTION carries the FULL inbound postage
 *      as a standalone order — the PR #618 lesson)
 *   3. Ask vs benchmark → margin %, with provenance (uk / world† / none)
 *   4. Overlap vs our stock (NEW / R-OUT / R-THIN / DUP) — DUPs excluded from the
 *      liquid headline
 *   5. Magnets (worldwide supply ≤3 lots + decent STR)
 *   6. Benchmark coverage split
 *   7. Demand-cap ADVISORY (capped net alongside raw — never a filter; Chris
 *      decides high-volume lots case by case)
 *   8. Sold-price ceiling (share of 6-mo sold qty at/above our list — sw0775)
 *   9. The STR-gate ladder × overlap matrix
 * The 0–100 grade and seller-quality stats are deliberately NOT here — a week of
 * transcripts showed zero decision weight on them.
 */
import type { OverlapTagValue, Condition, ItemTypeCode, SetsSection } from '../bl-store-assessment/types';

export type Lens = 'assess' | 'basket';
export type BenchProvenance = 'uk' | 'world' | 'none';

/** One lot, lens-neutral. Per-unit net is EX-POSTAGE (postage is charged to the
 * selection as a whole — see DecisionSummary). */
export interface DecisionRow {
  itemType: ItemTypeCode;
  itemNo: string;
  colourName: string | null;
  itemName: string;
  condition: Condition;
  qty: number;
  ask: number;
  /** UK 6-mo sold avg where covered; world avg ×1.11 otherwise (see provenance). */
  benchmark: number | null;
  benchProvenance: BenchProvenance;
  /** House STR — qty basis (sold_qty ÷ stock_qty). */
  strQty: number | null;
  /** Bricqer-modelled list (P/M) or set sold avg (S — excluded from the P/M table). */
  list: number | null;
  /** list × (1 − 9.4%) − ask. Ex-postage. */
  netPerUnit: number | null;
  marginPct: number | null;
  /** netPerUnit × qty — the RAW (uncapped) lot net. */
  lotNet: number | null;
  /** Market 6-mo sold qty (demand-cap input). */
  marketSoldQty6mo: number | null;
  /** min(qty, ceil(sold6mo × captureFraction(STR))) — units we can realistically clear. */
  cappedQty: number | null;
  /** netPerUnit × cappedQty — the honest lot net. Null when netPerUnit is null. */
  cappedLotNet: number | null;
  /** qty ÷ (sold6mo/6) — months of MARKET demand this lot represents (36+ shown as 36). */
  moCover: number | null;
  /** Share of 6-mo sold qty at/above our list (UK hist only). <0.2 ⇒ ceiling warning. */
  ceilingShare: number | null;
  overlap: OverlapTagValue | null;
  worldSupplyLots: number | null;
  magnet: boolean;
  highStr: boolean;
  withinMargin: boolean;
  damage: boolean;
}

/** One column of the gate ladder — all figures are STANDALONE-order (full postage). */
export interface GateCol {
  gate: number;
  lots: number;
  outlay: number;
  /** Σ raw lotNet − inbound postage. */
  rawNet: number;
  /** Σ cappedLotNet − inbound postage. */
  cappedNet: number;
  /** cappedNet excluding DUPLICATE lots — the liquid figure at this gate. */
  cappedNetNoDups: number;
  dupLots: number;
  marginPct: number | null; // rawNet ÷ list value
  roiPct: number | null; // cappedNet ÷ outlay
  medianStr: number | null;
  medianMoCover: number | null;
  /** NEW + RESTOCK_OUT lots (additional to our store) and their capped net. */
  addlLots: number;
  addlCappedNet: number;
}

export interface DecisionSummary {
  /** Rows in the buy view (withinMargin P/M lots). */
  lots: number;
  pieces: number;
  outlay: number;
  listValue: number;
  inboundPostage: number;
  /** The honesty ladder, each after full inbound postage: raw → capped → liquid. */
  rawNet: number;
  cappedNet: number;
  /** LIQUID headline: STR ≥ liquidGate, DUPs excluded, demand-capped, minus postage. */
  liquidNet: number;
  liquidGate: number;
  liquidLots: number;
  liquidOutlay: number;
  /** Median first (house rule), then mean and outlay-weighted. */
  strMedian: number | null;
  strMean: number | null;
  strOutlayWeighted: number | null;
  /** Benchmark provenance over ALL P/M lots scanned (not just buyable). */
  coverage: { totalLots: number; ukLots: number; worldLots: number; noneLots: number };
  magnetLots: number;
  highStrLots: number;
  dupLots: number;
  ceilingWarnLots: number;
  /** S-type lots seen but excluded from this table (separate decision — assessment SETS section). */
  setLotsExcluded: number;
  gates: GateCol[];
}

export interface DecisionReportMeta {
  lens: Lens;
  slug: string;
  storeName: string | null;
  country: string | null;
  scannedAt: string;
  generatedAt: string;
  engineVersion: number | null;
  scanTruncated: boolean;
  /** Echo of the economics so every report is self-describing. */
  inputs: { feePct: number; minMargin: number; minStr: number; inboundPostage: number };
  /** Estimate lens (world fills gaps) vs UK-grounded. */
  ukGroundedOnly: boolean | null;
  /** True when rows were reconstructed from a persisted assessment's section top-N
   * lists (full scored set unavailable) — the table understates the store. */
  partialRows?: boolean;
  /** Data-gap caveat carried from the producing lens (e.g. bl-basket's PARTIAL DATA
   * gap gate, PR #619: N tuples accepted unpriced) — rendered as a warning. */
  dataGapNote?: string;
}

export interface DecisionReport {
  meta: DecisionReportMeta;
  /** Buy view rows (withinMargin P/M), sorted capped-net desc. */
  rows: DecisionRow[];
  summary: DecisionSummary;
  /** Sets are a SEPARATE buying decision (Amazon-flip / BL-sell / part-out / skip),
   * never mixed into the P/M buy figure. Null when the lens has no sets data. */
  sets?: SetsSection | null;
}

export interface BuildOptions {
  /** Full inbound postage charged to the selection (default DEFAULT_INBOUND_POSTAGE_GBP). */
  inboundPostage?: number;
  /** Extra row filter applied to the buy view (e.g. magnets only, STR floor). */
  minStr?: number;
  magnetsOnly?: boolean;
  excludeDups?: boolean;
}

export interface RenderOptions {
  /** Cap the CLI lot table (md always renders every row). Default 40. */
  maxRows?: number;
  title?: string;
}
