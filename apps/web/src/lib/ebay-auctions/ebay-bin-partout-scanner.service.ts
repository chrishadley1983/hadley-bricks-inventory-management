/**
 * eBay BIN Part-Out Scanner
 *
 * Watches newly-listed USED fixed-price eBay listings for sets on the
 * part-out hit list (ebay_bin_hitlist: used part-out value, capped at New,
 * a high multiple of RRP). The edge is the 21k-row BrickLink POV cache —
 * a private pricing layer nobody else runs against the whole UK used market.
 *
 * Discovery-driven design (2026-07-02 Ninjago test):
 * - One broad Browse search per cycle (`lego`, USED, FIXED_PRICE, UK,
 *   newlyListed) with a creation-time cursor — the hit list filters locally,
 *   so API spend stays ~150-250 calls/day regardless of universe size.
 * - Parts/fig listings masquerade as sets (sword blade @ "70x multiple") —
 *   rejected-by-flag, never suppressed: price-floor vs POV, title patterns,
 *   Type aspect, piece-count lie detector, LEGO Character aspect, new-seller.
 * - eBay's OWN AI auto-fills aspects + descriptions from the catalog, so
 *   structured data alone can lie (the 70736 minifig-in-disguise) — flags
 *   stack, human sifts, nothing auto-buys.
 * - Zero BrickLink API calls at scan time.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getEbayBrowseClient, type EbayItemSummary } from '@/lib/ebay/ebay-browse.client';
import { extractSetNumbers } from './set-identifier';

const DEFAULT_POSTAGE_GBP = 3.99;

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
  ratio: number;
  figSharePct: number | null;
  ebayFloorGbp: number | null;
}

export interface BinCandidate {
  itemId: string;
  title: string;
  sets: HitlistEntry[];       // one entry normally; several for multi-set titles
  povTotal: number;           // summed capped used POV
  priceGbp: number;
  postageGbp: number;
  totalCostGbp: number;
  multiple: number;
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
  durationMs: number;
  opportunities: BinCandidate[];
  error?: string;
}

interface BinItemSummary extends EbayItemSummary {
  itemCreationDate?: string;
  buyingOptions?: string[];
}

// ── Pure helpers (unit-tested) ─────────────────────────────────────────

/** Title patterns that indicate a partial/part/fig listing rather than a set. */
const TITLE_CAVEAT_RE =
  /\b(incomplete|not complete|missing|no (mini)?fig(ure)?s?|no minis|build(s)? only|built only|spares?|parts? only|job ?lot|bundle|from set|instructions? only|manual only|box only|sticker(s)? only|empty box|\d+\s?%)\b/i;

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

export interface FlagInput {
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

  return flags;
}

/** Best-offer price that hits the target multiple: pov/multiple - postage. */
export function offerForMultiple(
  povTotal: number,
  targetMultiple: number,
  postageGbp: number,
  askPriceGbp: number
): number | null {
  const offer = povTotal / targetMultiple - postageGbp;
  if (!Number.isFinite(offer) || offer <= 0) return null;
  // Only meaningful if it undercuts the ask.
  return offer < askPriceGbp ? Math.floor(offer * 100) / 100 : null;
}

// ── Scanner ────────────────────────────────────────────────────────────

export class EbayBinPartoutScannerService {
  private supabase: SupabaseClient;
  private apiCallsMade = 0;

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
      minRatio: Number(data.min_ratio ?? 2),
      minUsedPovGbp: Number(data.min_used_pov_gbp ?? 40),
      priceFloorPct: Number(data.price_floor_pct ?? 15),
      maxPriceGbp: Number(data.max_price_gbp ?? 250),
      quietHoursStart: data.quiet_hours_start ?? 23,
      quietHoursEnd: data.quiet_hours_end ?? 7,
      hitlistMaxAgeHours: data.hitlist_max_age_hours ?? 24,
      lastScanCursor: data.last_scan_cursor,
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
    // Hit list is ~200 rows — well under the PostgREST 1000 cap, but paginate anyway.
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
          ratio: Number(r.ratio),
          figSharePct: r.fig_share_pct != null ? Number(r.fig_share_pct) : null,
          ebayFloorGbp: r.ebay_floor_gbp != null ? Number(r.ebay_floor_gbp) : null,
        });
      }
      if (data.length < PAGE) break;
      offset += PAGE;
    }
    return map;
  }

  async scan(config: BinPartoutConfig): Promise<BinScanResult> {
    const startTime = Date.now();
    this.apiCallsMade = 0;
    const base: Omit<BinScanResult, 'durationMs'> = {
      itemsSeen: 0,
      newItems: 0,
      hitlistMatches: 0,
      candidates: 0,
      alertsSent: 0,
      apiCallsMade: 0,
      hitlistRefreshed: false,
      hitlistSize: 0,
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

      // One broad search: every new used FIXED_PRICE LEGO listing in the UK.
      const client = getEbayBrowseClient();
      this.apiCallsMade++;
      const res = await client.searchItems('lego', {
        categoryId: '19006',
        filter: `conditions:{USED},buyingOptions:{FIXED_PRICE},itemLocationCountry:GB,price:[..${config.maxPriceGbp}],priceCurrency:GBP`,
        sort: 'newlyListed',
        limit: 200,
      });
      const items = (res.itemSummaries ?? []) as BinItemSummary[];
      base.itemsSeen = items.length;

      const cursor = config.lastScanCursor ? new Date(config.lastScanCursor).getTime() : 0;
      let newestCreation = cursor;

      const rawCandidates: Array<{ item: BinItemSummary; sets: HitlistEntry[] }> = [];
      for (const item of items) {
        const created = item.itemCreationDate ? new Date(item.itemCreationDate).getTime() : null;
        // Items without a creation date are processed only on bootstrap (no cursor).
        if (created != null && created > newestCreation) newestCreation = created;
        if (cursor > 0 && created != null && created <= cursor) continue;
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

      // Evaluate the raw candidates against the buy bar.
      const overBar: Array<{ item: BinItemSummary; sets: HitlistEntry[]; povTotal: number; totalCost: number; price: number; postage: number }> = [];
      for (const rc of rawCandidates) {
        const price = parseFloat(rc.item.price?.value ?? '');
        if (!Number.isFinite(price) || price <= 0) continue;
        const postageRaw = parseFloat(rc.item.shippingOptions?.[0]?.shippingCost?.value ?? '');
        const postage = Number.isFinite(postageRaw) ? postageRaw : DEFAULT_POSTAGE_GBP;
        const totalCost = price + postage;
        const povTotal = rc.sets.reduce((a, s) => a + s.usedPovGbp, 0);

        // eBay-floor learning: plausible complete single-set listings teach us
        // the going used market ask (no extra API calls).
        if (
          rc.sets.length === 1 &&
          !titleCaveat(rc.item.title || '') &&
          !looksLikePartListing(rc.item.title || '') &&
          totalCost >= 0.25 * povTotal
        ) {
          await this.updateEbayFloor(rc.sets[0].setNumber, totalCost);
        }

        if (povTotal / totalCost >= config.minMultiple) {
          overBar.push({ item: rc.item, sets: rc.sets, povTotal, totalCost, price, postage });
        }
      }

      // Dedupe / price-drop re-alert check.
      const itemIds = overBar.map((c) => c.item.itemId);
      const prior = await this.getPriorAlerts(config.userId, itemIds);

      for (const c of overBar) {
        const priorCost = prior.get(c.item.itemId);
        if (priorCost != null && c.totalCost > priorCost * 0.85) continue; // already alerted, no meaningful drop

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
        });
        if (c.sets.length > 1) flags.unshift(`multi-set title (${c.sets.map((s) => s.setNumber).join('+')})`);
        if (priorCost != null) flags.push(`price drop: was £${priorCost.toFixed(2)}`);

        const multiple = c.povTotal / c.totalCost;
        const bestOfferEnabled = (c.item.buyingOptions ?? []).includes('BEST_OFFER');
        const offer = bestOfferEnabled
          ? offerForMultiple(c.povTotal, config.minMultiple, c.postage, c.price)
          : null;

        base.opportunities.push({
          itemId: c.item.itemId,
          title: c.item.title || '',
          sets: c.sets,
          povTotal: c.povTotal,
          priceGbp: c.price,
          postageGbp: c.postage,
          totalCostGbp: c.totalCost,
          multiple,
          tier: multiple >= config.greatMultiple ? 'great' : 'good',
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
      base.candidates = base.opportunities.length;

      // Advance the cursor.
      if (newestCreation > cursor) {
        await this.supabase
          .from('ebay_bin_config')
          .update({ last_scan_cursor: new Date(newestCreation).toISOString(), updated_at: new Date().toISOString() })
          .eq('id', config.id);
      }

      base.apiCallsMade = this.apiCallsMade;
      return { ...base, durationMs: Date.now() - startTime };
    } catch (error) {
      base.apiCallsMade = this.apiCallsMade;
      return {
        ...base,
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
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

  /** Map of itemId -> total_cost_gbp for previously alerted BIN items. */
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
        set_name: primary.setName,
        current_bid_gbp: opp.priceGbp,
        postage_gbp: opp.postageGbp,
        total_cost_gbp: opp.totalCostGbp,
        bid_count: 0,
        alert_tier: opp.tier,
        is_joblot: opp.sets.length > 1,
        listing_type: 'bin',
        flags: opp.flags.join(' | ') || null,
        offer_suggestion_gbp: opp.offerSuggestionGbp,
        ratio_to_rrp: primary.rrpGbp ? Math.round((primary.usedPovGbp / primary.rrpGbp) * 100) / 100 : null,
        pov_condition: 'used',
        pov_sold_gbp: opp.povTotal,
        pov_multiple: Math.round(opp.multiple * 100) / 100,
        buy_signal: `Used part-out ${opp.multiple.toFixed(1)}× (BIN)`,
        auction_end_time: null,
        discord_sent: discordSent,
        discord_sent_at: discordSent ? new Date().toISOString() : null,
      },
      { onConflict: 'user_id,ebay_item_id' }
    );
  }
}
