/**
 * eBay BIN Watcher — used PART-OUT scan + sealed RESALE scan
 *
 * Watches newly-listed FIXED-PRICE eBay listings in two condition passes:
 *
 *  USED — sets on the part-out hit list (ebay_bin_hitlist: BrickLink used
 *  part-out value capped at New, ALL 12k+ sets with used data). Alert when
 *  all-in price is under usedPOV/3 (good) or /4 (great). The edge is the
 *  21k-row POV cache — a private pricing layer nobody else runs against the
 *  whole UK used market.
 *
 *  NEW — sealed listings judged on TWO exits: Amazon resale margin (local
 *  seeded_asin_pricing Buy Box; no Keepa in the loop) OR New part-out value
 *  >= multiple x cost. Covers the primary buying channel that neither the
 *  auction sniper (auctions only) nor Vinted (Vinted only) sees.
 *
 * Discovery-driven guards (2026-07-02 Ninjago test + adversarial probes):
 * - Parts/fig listings masquerade as sets (a £2.76 sword blade at "70x", a
 *   £10.80 minifig with an eBay-AI catalog description and auto-filled
 *   aspects) — flags STACK and never suppress; the human sifts.
 * - eBay's own AI auto-fills aspects + descriptions from the catalog, so no
 *   single structured field is trustworthy.
 * - Zero BrickLink API calls at scan time; ~2 searches + a few getItem per
 *   cycle (~150-300 eBay calls/day vs the 5k cap).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getEbayBrowseClient, type EbayItemSummary } from '@/lib/ebay/ebay-browse.client';
import { extractSetNumbers } from './set-identifier';
import { liquidityAdjustedPov, type PovLot } from '@/lib/bricklink/liquidity-pov';

const DEFAULT_POSTAGE_GBP = 3.99;
const AMAZON_FEE_RATE = 0.1836; // matches the Vinted sniper's margin model
const MAX_SEARCH_PAGES = 3; // saturation guard: keep fetching while a full page is entirely new

export interface BinPartoutConfig {
  id: string;
  userId: string;
  enabled: boolean;
  minMultiple: number;
  greatMultiple: number;
  minRatio: number;
  minUsedPovGbp: number;
  priceFloorPct: number;
  maxPriceGbp: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  hitlistMaxAgeHours: number;
  lastScanCursor: string | null;
  newScanEnabled: boolean;
  amazonMinMarginPct: number;
  amazonGreatMarginPct: number;
  lastScanCursorNew: string | null;
}

export interface HitlistEntry {
  setNumber: string;
  setName: string | null;
  theme: string | null;
  yearFrom: number | null;
  pieces: number | null;
  rrpGbp: number | null;
  usedPovGbp: number;
  newPovGbp: number | null;
  ratio: number | null;
  figSharePct: number | null;
  ebayFloorGbp: number | null;
}

export interface AmazonSeedPrice {
  amazonPriceGbp: number;
  was90dGbp: number | null;
  asin: string | null;
  setName: string | null;
  salesRank: number | null;
}

export interface BinCandidate {
  itemId: string;
  title: string;
  conditionMode: 'used' | 'new';
  sets: HitlistEntry[];       // one entry normally; several for multi-set titles
  povTotal: number;           // summed POV for the pass condition (capped used / new)
  priceGbp: number;
  postageGbp: number;
  totalCostGbp: number;
  multiple: number | null;    // povTotal / totalCost (null when no POV data)
  /**
   * Liquidity-adjusted ("realisable") POV — spec §3 F4, feeds this watcher +
   * set-buy-check verdicts. This is a SET-LEVEL approximation: captureFraction(setStr)
   * from lib/bricklink/liquidity-pov applied to each matched hitlist set's POV
   * component, where setStr is BrickLink's own worldwide COMPLETE-SET sell-through
   * rate (bricklink_pg_summary_cache, item_type='S', colour 0) — NOT a per-lot part
   * STR, which would require a live per-set scrape the 15-min scan path must not do.
   * null when none of the candidate's sets have a cached S-tuple str_used yet
   * (coverage is thin today — ~1% of the hitlist as of 2026-07-08, growing as the PG
   * platform backfill widens S-tuple coverage). Deliberately NOT backfilled with
   * captureFraction(null)'s pessimistic default in that case — that would fabricate a
   * number this set has no real signal for; flag-don't-suppress means add an honest
   * figure when we have one, not manufacture one when we don't.
   */
  realisablePovGbp: number | null;
  povCaptureRate: number | null;    // 0..1, only set alongside realisablePovGbp
  amazon: AmazonSeedPrice | null;   // NEW pass only
  amazonProfitGbp: number | null;
  amazonMarginPct: number | null;
  signals: string[];          // which buy signals fired
  tier: 'great' | 'good';
  bestOfferEnabled: boolean;
  offerSuggestionGbp: number | null;
  flags: string[];
  sellerScore: number | null;
  sellerUsername: string | null;
  itemUrl: string | undefined;
  imageUrl: string | undefined;
  condition: string | undefined;
}

export interface BinScanResult {
  skippedReason?: string;
  itemsSeen: number;
  newItems: number;
  hitlistMatches: number;
  candidates: number;
  alertsSent: number;
  apiCallsMade: number;
  hitlistRefreshed: boolean;
  hitlistSize: number;
  saturatedPages: number;     // extra pages fetched because a full page was entirely new
  durationMs: number;
  opportunities: BinCandidate[];
  error?: string;
}

interface BinItemSummary extends EbayItemSummary {
  itemCreationDate?: string;
  buyingOptions?: string[];
}

// ── Pure helpers (unit-tested) ─────────────────────────────────────────

/**
 * Title patterns that indicate a partial/part/fig listing rather than a set.
 * The percentage branch ("99% complete") sits OUTSIDE the \b...\b group —
 * '%' is a non-word char so a trailing \b there can never match.
 */
const TITLE_CAVEAT_RE =
  /\b(incomplete|not complete|missing|no\s+mini\s*fig(ure)?s?|no minis|no\s+box|unboxed|build(s)? only|built only|spares?|parts? only|job ?lot|bundle|from set|instructions? only|manual only|box only|sticker(s)? only|empty box|open box|resealed|damaged box|box damage|read description)\b|\d+\s?%/i;

/** Hard part-language: quantities/part-numbers that scream "single piece". */
const PART_LANGUAGE_RE =
  /(\b\d+\s?x\b|\bx\s?\d+\b|\bpn\b|part no|piece(s)? (of|from)|minifig(ure)?|figure only|headgear|torso|weapon|accessory|spinner ring|sword|blade)/i;

/** Standalone set-number token check — "70728" must not be a substring of another number. */
export function titleHasSetToken(title: string, setNumber: string): boolean {
  return new RegExp(`(^|[^0-9])${setNumber}([^0-9]|$)`).test(title);
}

export function titleCaveat(title: string): string | null {
  const m = title.match(TITLE_CAVEAT_RE);
  return m ? m[0] : null;
}

export function looksLikePartListing(title: string): boolean {
  return PART_LANGUAGE_RE.test(title);
}

/** Amazon resale economics — same model as the Vinted sniper card. */
export function amazonResaleMargin(
  amazonPriceGbp: number,
  totalCostGbp: number
): { profitGbp: number; marginPct: number } {
  const fees = amazonPriceGbp * AMAZON_FEE_RATE;
  const shipping = amazonPriceGbp < 20 ? 3 : 4;
  const profitGbp = amazonPriceGbp - fees - shipping - totalCostGbp;
  return { profitGbp, marginPct: (profitGbp / amazonPriceGbp) * 100 };
}

/** Best-offer price that hits the target POV multiple: pov/multiple - postage. */
export function offerForMultiple(
  povTotal: number,
  targetMultiple: number,
  postageGbp: number,
  askPriceGbp: number
): number | null {
  const offer = povTotal / targetMultiple - postageGbp;
  if (!Number.isFinite(offer) || offer <= 0) return null;
  return offer < askPriceGbp ? Math.floor(offer * 100) / 100 : null;
}

/** Best-offer price that hits the target Amazon margin. */
export function offerForMargin(
  amazonPriceGbp: number,
  targetMarginPct: number,
  postageGbp: number,
  askPriceGbp: number
): number | null {
  const shipping = amazonPriceGbp < 20 ? 3 : 4;
  const offer =
    amazonPriceGbp * (1 - AMAZON_FEE_RATE - targetMarginPct / 100) - shipping - postageGbp;
  if (!Number.isFinite(offer) || offer <= 0) return null;
  return offer < askPriceGbp ? Math.floor(offer * 100) / 100 : null;
}

export interface FlagInput {
  conditionMode: 'used' | 'new';
  typeAspect: string | null;         // eBay "Type" item specific
  piecesAspect: number | null;       // eBay "Number of Pieces"
  characterAspect: string | null;    // eBay "LEGO Character"
  catalogPieces: number | null;      // brickset piece count
  title: string;
  totalCostGbp: number;
  povTotal: number;
  priceFloorPct: number;
  sellerScore: number | null;
  descriptionText: string | null;    // plain-text description (AI boilerplate possible)
  sets: Array<{ setNumber: string; yearFrom: number | null }>;
  currentYear: number;
}

/**
 * Assemble the caution flags for a candidate. Flag-don't-suppress: every
 * flag is a reason for the human to look harder, never an automatic reject.
 */
export function assembleFlags(input: FlagInput): string[] {
  const flags: string[] = [];

  if (!input.typeAspect) {
    flags.push('no completeness declared');
  } else if (!/^complete/i.test(input.typeAspect)) {
    flags.push(`Type: ${input.typeAspect}`);
  }

  if (
    input.piecesAspect != null &&
    input.catalogPieces != null &&
    input.catalogPieces > 0 &&
    Math.abs(input.piecesAspect - input.catalogPieces) / input.catalogPieces > 0.02
  ) {
    flags.push(`declares ${input.piecesAspect}/${input.catalogPieces} pieces`);
  }

  const belowFloor = input.povTotal > 0 && input.totalCostGbp < (input.priceFloorPct / 100) * input.povTotal;
  if (belowFloor && input.characterAspect) {
    flags.push(`probable fig/part listing (character: ${input.characterAspect.slice(0, 40)})`);
  } else if (belowFloor) {
    flags.push(`price ≪ POV (${((input.totalCostGbp / input.povTotal) * 100).toFixed(0)}%) — likely partial/part`);
  }

  const caveat = titleCaveat(input.title);
  if (caveat) flags.push(`title: "${caveat}"`);
  else if (looksLikePartListing(input.title)) flags.push('part-language in title');

  const descCaveat = input.descriptionText ? titleCaveat(input.descriptionText) : null;
  if (descCaveat && descCaveat.toLowerCase() !== caveat?.toLowerCase()) {
    flags.push(`description: "${descCaveat}"`);
  }

  if (input.sellerScore != null && input.sellerScore < 10) {
    flags.push(`new seller (${input.sellerScore})`);
  }

  // Young sets carry the thin-used-history caution — their USED averages can
  // rest on 0-1 sales. New-condition data is deep even for young sets.
  if (input.conditionMode === 'used') {
    for (const s of input.sets) {
      if (s.yearFrom != null && s.yearFrom >= input.currentYear - 2) {
        flags.push(`⚠️ ${s.setNumber} is a ${s.yearFrom} set — thin used-parts history`);
      }
    }
  }

  return flags;
}

// ── Scanner ────────────────────────────────────────────────────────────

export class EbayBinPartoutScannerService {
  private supabase: SupabaseClient;
  private apiCallsMade = 0;
  private saturatedPages = 0;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  async loadConfig(userId: string): Promise<BinPartoutConfig | null> {
    const { data, error } = await this.supabase
      .from('ebay_bin_config')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return null;
    return {
      id: data.id,
      userId: data.user_id,
      enabled: data.enabled,
      minMultiple: Number(data.min_multiple ?? 3),
      greatMultiple: Number(data.great_multiple ?? 4),
      minRatio: Number(data.min_ratio ?? 0),
      minUsedPovGbp: Number(data.min_used_pov_gbp ?? 0),
      priceFloorPct: Number(data.price_floor_pct ?? 15),
      maxPriceGbp: Number(data.max_price_gbp ?? 250),
      quietHoursStart: data.quiet_hours_start ?? 23,
      quietHoursEnd: data.quiet_hours_end ?? 7,
      hitlistMaxAgeHours: data.hitlist_max_age_hours ?? 24,
      lastScanCursor: data.last_scan_cursor,
      newScanEnabled: data.new_scan_enabled ?? true,
      amazonMinMarginPct: Number(data.amazon_min_margin_pct ?? 20),
      amazonGreatMarginPct: Number(data.amazon_great_margin_pct ?? 25),
      lastScanCursorNew: data.last_scan_cursor_new,
    };
  }

  private isInQuietHours(config: BinPartoutConfig): boolean {
    const hour = new Date().getHours();
    const { quietHoursStart: s, quietHoursEnd: e } = config;
    if (s === e) return false;
    return s < e ? hour >= s && hour < e : hour >= s || hour < e;
  }

  /** Refresh the hit list from the POV cache when stale; returns whether it ran. */
  private async ensureHitlistFresh(config: BinPartoutConfig): Promise<boolean> {
    const { data } = await this.supabase
      .from('ebay_bin_hitlist')
      .select('refreshed_at')
      .order('refreshed_at', { ascending: false })
      .limit(1);
    const newest = data?.[0]?.refreshed_at ? new Date(data[0].refreshed_at).getTime() : 0;
    const ageHours = (Date.now() - newest) / 3_600_000;
    if (ageHours < config.hitlistMaxAgeHours) return false;
    const { error } = await this.supabase.rpc('refresh_ebay_bin_hitlist', {
      p_min_ratio: config.minRatio,
      p_min_pov: config.minUsedPovGbp,
    });
    if (error) console.error('[BinPartout] hitlist refresh failed:', error.message);
    return !error;
  }

  private async loadHitlist(): Promise<Map<string, HitlistEntry>> {
    const map = new Map<string, HitlistEntry>();
    let offset = 0;
    const PAGE = 1000;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await this.supabase
        .from('ebay_bin_hitlist')
        .select('*')
        .order('set_number')
        .range(offset, offset + PAGE - 1);
      if (error || !data) break;
      for (const r of data) {
        map.set(r.set_number, {
          setNumber: r.set_number,
          setName: r.set_name,
          theme: r.theme,
          yearFrom: r.year_from,
          pieces: r.pieces,
          rrpGbp: r.rrp_gbp != null ? Number(r.rrp_gbp) : null,
          usedPovGbp: Number(r.used_pov_gbp),
          newPovGbp: r.new_pov_gbp != null ? Number(r.new_pov_gbp) : null,
          ratio: r.ratio != null ? Number(r.ratio) : null,
          figSharePct: r.fig_share_pct != null ? Number(r.fig_share_pct) : null,
          ebayFloorGbp: r.ebay_floor_gbp != null ? Number(r.ebay_floor_gbp) : null,
        });
      }
      if (data.length < PAGE) break;
      offset += PAGE;
    }
    return map;
  }

  /**
   * Batch-load per-set STR (BrickLink worldwide price-guide summary,
   * bricklink_pg_summary_cache item_type='S', colour_id=0) for the liquidity-adjusted
   * POV estimate (spec §3 F4). This table is small (low hundreds of rows as of
   * 2026-07-08) so one unfiltered read per scan is cheap — no per-alert scrape. Rows
   * absent from the map mean "no signal", not "illiquid"; callers must not fabricate a
   * capture fraction for sets missing here.
   */
  private async loadSetStrMap(): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    // Paginated (Supabase 1,000-row cap): safe today at ~313 str_used rows, but the
    // hitlist set-layer fill is actively growing S-tuple L1 coverage toward ~12.6k —
    // an unpaginated read would silently truncate once it crosses 1,000 (2026-07-08
    // E2E finding).
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.supabase
        .from('bricklink_pg_summary_cache')
        .select('item_no, str_used')
        .eq('item_type', 'S')
        .eq('colour_id', 0)
        .not('str_used', 'is', null)
        .range(from, from + PAGE - 1);
      if (error || !data) break;
      for (const r of data) {
        const str = Number(r.str_used);
        if (Number.isFinite(str)) map.set(String(r.item_no), str);
      }
      if (data.length < PAGE) break;
    }
    return map;
  }

  /**
   * Fetch newly-listed items for one condition, saturation-aware: when a full
   * page is entirely newer than the cursor, keep paging (bounded) so a burst
   * of listings between cycles is not silently truncated.
   */
  private async searchNewlyListed(
    condition: 'USED' | 'NEW',
    maxPriceGbp: number,
    cursorMs: number
  ): Promise<BinItemSummary[]> {
    const client = getEbayBrowseClient();
    const all: BinItemSummary[] = [];
    for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
      this.apiCallsMade++;
      const res = await client.searchItems('lego', {
        categoryId: '19006',
        filter: `conditions:{${condition}},buyingOptions:{FIXED_PRICE},itemLocationCountry:GB,price:[..${maxPriceGbp}],priceCurrency:GBP`,
        sort: 'newlyListed',
        limit: 200,
        offset: page * 200,
      });
      const items = (res.itemSummaries ?? []) as BinItemSummary[];
      all.push(...items);
      const fullPage = items.length === 200;
      const allNew =
        cursorMs > 0 &&
        items.length > 0 &&
        items.every((i) => {
          const t = i.itemCreationDate ? new Date(i.itemCreationDate).getTime() : 0;
          return t > cursorMs;
        });
      if (!(fullPage && allNew)) break;
      this.saturatedPages++;
      console.warn(`[BinPartout] ${condition} page ${page} saturated — fetching next page`);
    }
    return all;
  }

  /** Batch Amazon Buy Box lookup from the local seeded table ("NNNNN-1" keys). */
  private async lookupAmazonPrices(setNumbers: string[]): Promise<Map<string, AmazonSeedPrice>> {
    const map = new Map<string, AmazonSeedPrice>();
    const bare = [...new Set(setNumbers.map((s) => s.split('-')[0]).filter(Boolean))];
    if (bare.length === 0) return map;
    const variants = bare.flatMap((s) => [s, `${s}-1`]);
    const { data } = await this.supabase
      .from('seeded_asin_pricing')
      .select('set_number, set_name, amazon_price, was_price_90d, asin')
      .in('set_number', variants)
      .gt('amazon_price', 0);
    for (const r of data ?? []) {
      const key = String(r.set_number).split('-')[0];
      if (!map.has(key)) {
        map.set(key, {
          amazonPriceGbp: Number(r.amazon_price),
          was90dGbp: r.was_price_90d != null ? Number(r.was_price_90d) : null,
          asin: r.asin ?? null,
          setName: r.set_name ?? null,
          salesRank: null,
        });
      }
    }

    // BSR (sales rank) lives in amazon_arbitrage_pricing, keyed by ASIN.
    const asins = [...new Set([...map.values()].map((v) => v.asin).filter(Boolean))] as string[];
    if (asins.length > 0) {
      const { data: ranks } = await this.supabase
        .from('amazon_arbitrage_pricing')
        .select('asin, sales_rank')
        .in('asin', asins)
        .not('sales_rank', 'is', null)
        .order('snapshot_date', { ascending: false });
      // Newest-first; keep the first (latest) rank per ASIN.
      const rankByAsin = new Map<string, number>();
      for (const r of ranks ?? []) {
        if (!rankByAsin.has(r.asin as string)) rankByAsin.set(r.asin as string, Number(r.sales_rank));
      }
      for (const v of map.values()) {
        if (v.asin && rankByAsin.has(v.asin)) v.salesRank = rankByAsin.get(v.asin)!;
      }
    }
    return map;
  }

  async scan(config: BinPartoutConfig): Promise<BinScanResult> {
    const startTime = Date.now();
    this.apiCallsMade = 0;
    this.saturatedPages = 0;
    const base: Omit<BinScanResult, 'durationMs'> = {
      itemsSeen: 0,
      newItems: 0,
      hitlistMatches: 0,
      candidates: 0,
      alertsSent: 0,
      apiCallsMade: 0,
      hitlistRefreshed: false,
      hitlistSize: 0,
      saturatedPages: 0,
      opportunities: [],
    };

    try {
      if (!config.enabled) {
        return { ...base, skippedReason: 'disabled', durationMs: Date.now() - startTime };
      }
      if (this.isInQuietHours(config)) {
        return { ...base, skippedReason: 'quiet_hours', durationMs: Date.now() - startTime };
      }

      base.hitlistRefreshed = await this.ensureHitlistFresh(config);
      const hitlist = await this.loadHitlist();
      base.hitlistSize = hitlist.size;
      const setStrMap = await this.loadSetStrMap();

      const cursorUpdates: Record<string, string> = {};

      // Pass 1: USED part-out.
      await this.scanPass('USED', config, hitlist, setStrMap, base, cursorUpdates);
      // Pass 2: NEW sealed (Amazon resale OR New POV).
      if (config.newScanEnabled) {
        await this.scanPass('NEW', config, hitlist, setStrMap, base, cursorUpdates);
      }

      if (Object.keys(cursorUpdates).length > 0) {
        await this.supabase
          .from('ebay_bin_config')
          .update({ ...cursorUpdates, updated_at: new Date().toISOString() })
          .eq('id', config.id);
      }

      base.candidates = base.opportunities.length;
      base.apiCallsMade = this.apiCallsMade;
      base.saturatedPages = this.saturatedPages;
      return { ...base, durationMs: Date.now() - startTime };
    } catch (error) {
      base.apiCallsMade = this.apiCallsMade;
      base.saturatedPages = this.saturatedPages;
      return {
        ...base,
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async scanPass(
    condition: 'USED' | 'NEW',
    config: BinPartoutConfig,
    hitlist: Map<string, HitlistEntry>,
    setStrMap: Map<string, number>,
    base: Omit<BinScanResult, 'durationMs'>,
    cursorUpdates: Record<string, string>
  ): Promise<void> {
    const mode: 'used' | 'new' = condition === 'USED' ? 'used' : 'new';
    const cursorIso = condition === 'USED' ? config.lastScanCursor : config.lastScanCursorNew;
    const cursorCol = condition === 'USED' ? 'last_scan_cursor' : 'last_scan_cursor_new';
    const cursor = cursorIso ? new Date(cursorIso).getTime() : 0;
    let newestCreation = cursor;

    const items = await this.searchNewlyListed(condition, config.maxPriceGbp, cursor);
    base.itemsSeen += items.length;

    const rawCandidates: Array<{ item: BinItemSummary; sets: HitlistEntry[] }> = [];
    for (const item of items) {
      const created = item.itemCreationDate ? new Date(item.itemCreationDate).getTime() : null;
      if (created != null && created > newestCreation) newestCreation = created;
      // Undated items are processed only on bootstrap (no cursor) — with a
      // cursor there is no way to tell them apart from already-seen stock.
      if (cursor > 0 && (created == null || created <= cursor)) continue;
      base.newItems++;

      const identified = extractSetNumbers(item.title || '');
      const matched: HitlistEntry[] = [];
      const seen = new Set<string>();
      for (const id of identified) {
        const bare = id.setNumber.split('-')[0];
        const entry = hitlist.get(bare);
        if (entry && !seen.has(bare) && titleHasSetToken(item.title || '', bare)) {
          matched.push(entry);
          seen.add(bare);
        }
      }
      if (matched.length === 0) continue;
      base.hitlistMatches++;
      rawCandidates.push({ item, sets: matched });
    }

    // Amazon prices for the NEW pass (one batch query, local table).
    const amazonPrices =
      mode === 'new'
        ? await this.lookupAmazonPrices(rawCandidates.flatMap((rc) => rc.sets.map((s) => s.setNumber)))
        : new Map<string, AmazonSeedPrice>();

    type OverBar = {
      item: BinItemSummary;
      sets: HitlistEntry[];
      povTotal: number;
      totalCost: number;
      price: number;
      postage: number;
      amazon: AmazonSeedPrice | null;
      amazonProfit: number | null;
      amazonMargin: number | null;
      signals: string[];
      tier: 'great' | 'good';
      realisablePovGbp: number | null;
      povCaptureRate: number | null;
    };
    const overBar: OverBar[] = [];

    for (const rc of rawCandidates) {
      const price = parseFloat(rc.item.price?.value ?? '');
      if (!Number.isFinite(price) || price <= 0) continue;
      const postageRaw = parseFloat(rc.item.shippingOptions?.[0]?.shippingCost?.value ?? '');
      const postage = Number.isFinite(postageRaw) ? postageRaw : DEFAULT_POSTAGE_GBP;
      const totalCost = price + postage;

      const povTotal =
        mode === 'used'
          ? rc.sets.reduce((a, s) => a + s.usedPovGbp, 0)
          : rc.sets.reduce((a, s) => a + (s.newPovGbp ?? 0), 0);
      const povMultiple = povTotal > 0 ? povTotal / totalCost : null;

      // Liquidity-adjusted ("realisable") POV — spec §3 F4. Set-level approximation
      // via captureFraction(setStr); see the BinCandidate.realisablePovGbp doc comment
      // for why a missing setStr is left null rather than backfilled with the
      // pessimistic default.
      const hasStrSignal = rc.sets.some((s) => setStrMap.has(s.setNumber));
      let realisablePovGbp: number | null = null;
      let povCaptureRate: number | null = null;
      if (hasStrSignal && povTotal > 0) {
        const lots: PovLot[] = rc.sets.map((s) => ({
          qty: 1,
          price: mode === 'used' ? s.usedPovGbp : s.newPovGbp,
          str: setStrMap.get(s.setNumber) ?? null,
        }));
        const liq = liquidityAdjustedPov(lots);
        realisablePovGbp = liq.realisable;
        povCaptureRate = liq.captureRate;
      }

      // eBay-floor learning (USED pass only): plausible complete single-set
      // listings teach us the going used market ask, no extra API calls.
      if (
        mode === 'used' &&
        rc.sets.length === 1 &&
        !titleCaveat(rc.item.title || '') &&
        !looksLikePartListing(rc.item.title || '') &&
        povTotal > 0 &&
        totalCost >= 0.25 * povTotal
      ) {
        await this.updateEbayFloor(rc.sets[0].setNumber, totalCost);
      }

      const signals: string[] = [];
      let tier: 'great' | 'good' | null = null;

      const povFired = povMultiple != null && povMultiple >= config.minMultiple;
      if (povFired) {
        signals.push(
          `${mode === 'used' ? 'Used' : 'New'} part-out ${povMultiple!.toFixed(1)}× cost`
        );
        tier = povMultiple! >= config.greatMultiple ? 'great' : 'good';
      }

      let amazon: AmazonSeedPrice | null = null;
      let amazonProfit: number | null = null;
      let amazonMargin: number | null = null;
      if (mode === 'new' && rc.sets.length === 1) {
        amazon = amazonPrices.get(rc.sets[0].setNumber) ?? null;
        if (amazon) {
          const { profitGbp, marginPct } = amazonResaleMargin(amazon.amazonPriceGbp, totalCost);
          amazonProfit = profitGbp;
          amazonMargin = marginPct;
          if (marginPct >= config.amazonMinMarginPct && profitGbp > 0) {
            signals.push(`Amazon ${marginPct.toFixed(1)}% margin`);
            const amazonTier: 'great' | 'good' =
              marginPct >= config.amazonGreatMarginPct ? 'great' : 'good';
            tier = tier === 'great' || amazonTier === 'great' ? 'great' : 'good';
          }
        }
      }

      if (!tier) continue;
      overBar.push({
        item: rc.item,
        sets: rc.sets,
        povTotal,
        totalCost,
        price,
        postage,
        amazon,
        amazonProfit,
        amazonMargin,
        signals,
        tier,
        realisablePovGbp,
        povCaptureRate,
      });
    }

    // Dedupe / price-drop re-alert check.
    const itemIds = overBar.map((c) => c.item.itemId);
    const prior = await this.getPriorAlerts(config.userId, itemIds);
    const client = getEbayBrowseClient();

    for (const c of overBar) {
      const priorCost = prior.get(c.item.itemId);
      if (priorCost != null && c.totalCost > priorCost * 0.85) continue;

      // Confidence pull: one getItem for aspects + description.
      let typeAspect: string | null = null;
      let piecesAspect: number | null = null;
      let characterAspect: string | null = null;
      let descriptionText: string | null = null;
      try {
        this.apiCallsMade++;
        const detail = (await client.getItem(
          c.item.itemId.startsWith('v1|') ? c.item.itemId : `v1|${c.item.itemId}|0`
        )) as {
          localizedAspects?: Array<{ name: string; value: string }>;
          description?: string;
          shortDescription?: string;
        };
        const aspects = new Map((detail.localizedAspects ?? []).map((a) => [a.name.toLowerCase(), a.value]));
        typeAspect = aspects.get('type') ?? null;
        const piecesRaw = aspects.get('number of pieces');
        piecesAspect = piecesRaw != null ? parseInt(piecesRaw, 10) || null : null;
        characterAspect = aspects.get('lego character') ?? null;
        descriptionText = String(detail.description ?? detail.shortDescription ?? '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .slice(0, 2000) || null;
      } catch (e) {
        console.error(`[BinPartout] getItem failed for ${c.item.itemId}:`, (e as Error).message);
      }

      const catalogPieces = c.sets.length === 1 ? c.sets[0].pieces : null;
      const flags = assembleFlags({
        conditionMode: mode,
        typeAspect,
        piecesAspect,
        characterAspect,
        catalogPieces,
        title: c.item.title || '',
        totalCostGbp: c.totalCost,
        povTotal: c.povTotal,
        priceFloorPct: config.priceFloorPct,
        sellerScore: c.item.seller?.feedbackScore ?? null,
        descriptionText,
        sets: c.sets.map((s) => ({ setNumber: s.setNumber, yearFrom: s.yearFrom })),
        currentYear: new Date().getFullYear(),
      });
      if (c.sets.length > 1) flags.unshift(`multi-set title (${c.sets.map((s) => s.setNumber).join('+')})`);
      if (priorCost != null) flags.push(`price drop: was £${priorCost.toFixed(2)}`);

      const bestOfferEnabled = (c.item.buyingOptions ?? []).includes('BEST_OFFER');
      let offer: number | null = null;
      if (bestOfferEnabled) {
        offer =
          c.povTotal > 0 ? offerForMultiple(c.povTotal, config.minMultiple, c.postage, c.price) : null;
        if (offer == null && c.amazon) {
          offer = offerForMargin(c.amazon.amazonPriceGbp, config.amazonMinMarginPct, c.postage, c.price);
        }
      }

      base.opportunities.push({
        itemId: c.item.itemId,
        title: c.item.title || '',
        conditionMode: mode,
        sets: c.sets,
        povTotal: c.povTotal,
        priceGbp: c.price,
        postageGbp: c.postage,
        totalCostGbp: c.totalCost,
        multiple: c.povTotal > 0 ? c.povTotal / c.totalCost : null,
        realisablePovGbp: c.realisablePovGbp,
        povCaptureRate: c.povCaptureRate,
        amazon: c.amazon,
        amazonProfitGbp: c.amazonProfit,
        amazonMarginPct: c.amazonMargin,
        signals: c.signals,
        tier: c.tier,
        bestOfferEnabled,
        offerSuggestionGbp: offer,
        flags,
        sellerScore: c.item.seller?.feedbackScore ?? null,
        sellerUsername: c.item.seller?.username ?? null,
        itemUrl: c.item.itemWebUrl,
        imageUrl: c.item.image?.imageUrl,
        condition: c.item.condition,
      });
    }

    if (newestCreation > cursor) {
      cursorUpdates[cursorCol] = new Date(newestCreation).toISOString();
    }
  }

  /** Lower-or-stale-replace floor update; silent on error (learning is best-effort). */
  private async updateEbayFloor(setNumber: string, totalCost: number): Promise<void> {
    try {
      const { data } = await this.supabase
        .from('ebay_bin_hitlist')
        .select('ebay_floor_gbp, ebay_floor_seen_at')
        .eq('set_number', setNumber)
        .maybeSingle();
      if (!data) return;
      const current = data.ebay_floor_gbp != null ? Number(data.ebay_floor_gbp) : null;
      const seenAt = data.ebay_floor_seen_at ? new Date(data.ebay_floor_seen_at).getTime() : 0;
      const stale = Date.now() - seenAt > 30 * 24 * 3_600_000;
      if (current == null || totalCost < current || stale) {
        await this.supabase
          .from('ebay_bin_hitlist')
          .update({ ebay_floor_gbp: totalCost, ebay_floor_seen_at: new Date().toISOString() })
          .eq('set_number', setNumber);
      }
    } catch {
      /* best-effort */
    }
  }

  /** Map of itemId -> total_cost_gbp for previously alerted items. */
  private async getPriorAlerts(userId: string, itemIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (itemIds.length === 0) return map;
    const { data } = await this.supabase
      .from('ebay_auction_alerts')
      .select('ebay_item_id, total_cost_gbp')
      .eq('user_id', userId)
      .in('ebay_item_id', itemIds);
    for (const r of data ?? []) {
      map.set(r.ebay_item_id, Number(r.total_cost_gbp));
    }
    return map;
  }

  async saveAlert(userId: string, opp: BinCandidate, discordSent: boolean): Promise<void> {
    const primary = opp.sets[0];
    await this.supabase.from('ebay_auction_alerts').upsert(
      {
        user_id: userId,
        ebay_item_id: opp.itemId,
        ebay_title: opp.title,
        ebay_url: opp.itemUrl,
        ebay_image_url: opp.imageUrl,
        set_number: opp.sets.map((s) => s.setNumber).join('+'),
        set_name: primary.setName ?? opp.amazon?.setName ?? null,
        current_bid_gbp: opp.priceGbp,
        postage_gbp: opp.postageGbp,
        total_cost_gbp: opp.totalCostGbp,
        bid_count: 0,
        amazon_price_gbp: opp.amazon?.amazonPriceGbp ?? null,
        amazon_90d_avg_gbp: opp.amazon?.was90dGbp ?? null,
        amazon_asin: opp.amazon?.asin ?? null,
        profit_gbp: opp.amazonProfitGbp,
        margin_percent: opp.amazonMarginPct != null ? Math.round(opp.amazonMarginPct * 100) / 100 : null,
        alert_tier: opp.tier,
        is_joblot: opp.sets.length > 1,
        listing_type: 'bin',
        flags: opp.flags.join(' | ') || null,
        offer_suggestion_gbp: opp.offerSuggestionGbp,
        ratio_to_rrp:
          primary.rrpGbp && opp.conditionMode === 'used'
            ? Math.round((primary.usedPovGbp / primary.rrpGbp) * 100) / 100
            : null,
        pov_condition: opp.conditionMode,
        pov_sold_gbp: opp.povTotal > 0 ? opp.povTotal : null,
        pov_multiple: opp.multiple != null ? Math.round(opp.multiple * 100) / 100 : null,
        buy_signal: opp.signals.join(' + ') || null,
        auction_end_time: null,
        discord_sent: discordSent,
        discord_sent_at: discordSent ? new Date().toISOString() : null,
      },
      { onConflict: 'user_id,ebay_item_id' }
    );
  }
}
