/**
 * eBay False-Positive Detector Service
 *
 * Detects and excludes false-positive eBay listings from arbitrage calculations.
 * Uses 28 weighted scoring signals. Listings scoring >= 50 are excluded.
 *
 * Signals:
 * 1. Very Low COG (<5%) - 35 pts
 * 2. Low COG (<10%) - 25 pts
 * 3. Suspicious COG (<15%) - 15 pts
 * 3b. Elevated COG (<20%) - 10 pts
 * 4. Part Number Pattern (e.g., "24183pb01") - 30 pts
 * 5. Minifigure Keywords - 25 pts
 * 6. Instructions Only - 30 pts
 * 7. Missing Set Number - 15 pts
 * 8. Parts/Pieces Keywords - 20 pts
 * 9. Incomplete Indicators - 25 pts
 * 10. Item Only Pattern ("X only") - 30 pts
 * 11. Keyring Detection - 30 pts
 * 12. Name Mismatch - 25 pts
 * 13. Wrong Set Number - 40 pts
 * 14. Price Anomaly (<£10 when Amazon >£50) - 20 pts
 * 15. LED Light Kit - 30 pts
 * 16. Display Accessory - 25 pts
 * 17. Third-Party Product - 30 pts
 * 18. Bundle/Lot - 25 pts
 * 19. Custom/MOC - 30 pts
 * 20. Multi-Quantity - 20 pts
 * 21. Book/Magazine - 25 pts
 * 22. Sticker/Poster/Decal - 25 pts
 * 23. Polybag/Paper Bag - 30 pts
 * 24. Advent Day Sale - 35 pts
 * 25. Split From Set - 30 pts
 * 26. No Minifigures - 30 pts
 * 27. Promotional Item - 25 pts
 * 28. Min-to-Avg Price Ratio (<10%) - 25 pts
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EbayListing } from './types';
import type {
  ArbitrageViewItem,
  DetectionSignal,
  ExclusionRecord,
  FpCleanupResult,
  FpDetectorConfig,
} from './ebay-fp-detector.types';
import { DEFAULT_THRESHOLD, DEFAULT_USER_ID, SIGNAL_WEIGHTS } from './ebay-fp-detector.types';

// Regex patterns for detection
const PART_NUMBER_PATTERN = /\b\d{4,6}(pb|pat|pr|c)\d{1,3}\b/i;
const SET_NUMBER_PATTERN = /\b(\d{4,5})\b/g;
const MINIFIG_KEYWORDS = /\b(minifig|minifigure|figure|fig|figurine|mini fig)\b/i;
const INSTRUCTIONS_KEYWORDS = /\b(instruction|manual|booklet|directions)\b/i;
const PARTS_KEYWORDS = /\b(part|piece|brick|plate|tile|slope|wedge|axle|technic)\b/i;
const INCOMPLETE_KEYWORDS =
  /\b(spares?|missing|incomplete|partial|damaged|opened|no box|ex[\s-]?display|shop\s+display|unsealed|open\s+box|box\s+only)\b/i;
const KEYRING_KEYWORDS = /\b(keyring|key ring|keychain|key chain|key light|torch)\b/i;
const ITEM_ONLY_PATTERN =
  /\b(sticker|part|parts|piece|pieces|build|builds|minifig|minifigure|figure|manual|instruction|booklet|box|packaging|light kit|led)\s*(sheet|s)?\s+only\b/i;

// New detection patterns (signals 15-21)
const LED_LIGHT_KIT_KEYWORDS =
  /\b(led\s+light|light\s*kit|lighting\s+kit|lighting\s+set|led\s+kit)\b/i;
const DISPLAY_ACCESSORY_KEYWORDS =
  /\b(display\s+stand|display\s+case|display\s+frame|display\s+plaque|name\s*plate|wall\s+mount|acrylic\s+case|acrylic\s+display|dust\s+cover)\b/i;
const THIRD_PARTY_KEYWORDS =
  /\b(for\s+lego|compatible\s+with|compatible\s+for|fits\s+lego|to\s+fit\s+lego|replacement\s+sticker)\b/i;
const BUNDLE_LOT_KEYWORDS = /\b(job\s*lot|bulk\s+lot|bundle\s+lot|joblot|mixed\s+lot)\b/i;
const CUSTOM_MOC_KEYWORDS = /\b(moc|custom\s+build|custom\s+moc|my\s+own\s+creation)\b/i;
const MULTI_QUANTITY_PATTERN = /\bx\s*[2-9]\b|\b[2-9]\s*x\s+(?!.*\bin[- ]1\b)/i;
const BOOK_MAGAZINE_KEYWORDS =
  /\b(annual|activity\s+book|magazine|encyclop\w*|handbook|ultimate\s+guide)\b/i;
const STICKER_POSTER_KEYWORDS =
  /\b(sticker\s+sheet|decal\s+sheet|sticker\s+set|decal\s+set|poster|art\s+print|wall\s+sticker|vinyl\s+sticker|sheet\s+of\s+sticker|stickers?\s+(?:for|from)\s+(?:set|\d))\b/i;

// New detection patterns (signals 23-27)
const POLYBAG_KEYWORDS = /\b(poly\s*bag|paper\s*bag|foil\s*(bag|pack)|promo\s*bag)\b/i;
const ADVENT_DAY_KEYWORDS = /\b(choose\s+your\s+day|pick\s+your\s+day)\b/i;
const SPLIT_FROM_KEYWORDS = /\b(from\s+set\b|split\s+from|from\s+\d{4,5}\b)/i;
const NO_MINIFIGS_KEYWORDS = /\bno\s+(minifig(ure)?s?|mini\s*figs?|figs?|figures?)\b/i;
const PROMOTIONAL_KEYWORDS = /\b(metal\s*box|shaped\s*box|promotional\s+tin)\b/i;

// Stop words for name matching
const STOP_WORDS = new Set([
  'lego',
  'the',
  'and',
  'with',
  'for',
  'set',
  'new',
  'sealed',
  'box',
  'bnib',
  'bnisb',
]);

export class EbayFpDetectorService {
  private supabase: SupabaseClient;
  private validSetNumbers: Set<string> | null = null;
  private excludedBySet: Map<string, Set<string>> | null = null;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Load all valid set numbers from brickset_sets table (paginated)
   */
  async loadValidSetNumbers(): Promise<Set<string>> {
    if (this.validSetNumbers) return this.validSetNumbers;

    const validNumbers = new Set<string>();
    const pageSize = 1000;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('brickset_sets')
        .select('set_number')
        .range(offset, offset + pageSize - 1);

      if (error) {
        console.error('[EbayFpDetector] Failed to load set numbers:', error);
        break;
      }

      if (!data || data.length === 0) {
        hasMore = false;
        break;
      }

      for (const row of data) {
        const setNum = this.extractSetNumber(row.set_number);
        if (setNum) {
          validNumbers.add(setNum);
        }
      }

      hasMore = data.length === pageSize;
      offset += pageSize;
    }

    console.log(`[EbayFpDetector] Loaded ${validNumbers.size} valid set numbers`);
    this.validSetNumbers = validNumbers;
    return validNumbers;
  }

  /**
   * Load already excluded listing IDs grouped by set number (paginated)
   */
  async loadExcludedListings(userId: string): Promise<Map<string, Set<string>>> {
    if (this.excludedBySet) return this.excludedBySet;

    const excludedBySet = new Map<string, Set<string>>();
    const pageSize = 1000;
    let offset = 0;
    let hasMore = true;
    let totalCount = 0;

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('excluded_ebay_listings')
        .select('ebay_item_id, set_number')
        .eq('user_id', userId)
        .range(offset, offset + pageSize - 1);

      if (error) {
        console.error('[EbayFpDetector] Failed to load excluded listings:', error);
        break;
      }

      if (!data || data.length === 0) {
        hasMore = false;
        break;
      }

      for (const row of data) {
        const setKey = row.set_number;
        if (!excludedBySet.has(setKey)) {
          excludedBySet.set(setKey, new Set<string>());
        }
        excludedBySet.get(setKey)!.add(row.ebay_item_id);
        totalCount++;
      }

      hasMore = data.length === pageSize;
      offset += pageSize;
    }

    console.log(
      `[EbayFpDetector] Loaded ${totalCount} existing exclusions across ${excludedBySet.size} sets`
    );
    this.excludedBySet = excludedBySet;
    return excludedBySet;
  }

  /**
   * Extract numeric set number from BrickLink format (e.g., '60185-1' -> '60185')
   */
  private extractSetNumber(blSetNumber: string | null): string | null {
    if (!blSetNumber) return null;
    const match = blSetNumber.match(/^(\d+)/);
    return match ? match[1] : null;
  }

  /**
   * Score a single eBay listing for false-positive likelihood
   * Returns score 0-100 (capped) and list of triggered signals
   */
  scoreListing(
    listing: EbayListing,
    setNumber: string | null,
    setName: string | null,
    amazonPrice: number | null,
    validSetNumbers: Set<string>,
    avgPrice: number | null = null
  ): { score: number; signals: DetectionSignal[] } {
    let score = 0;
    const signals: DetectionSignal[] = [];
    const title = (listing.title || '').toLowerCase();
    const totalPrice = listing.totalPrice ?? listing.price ?? 0;

    // 1-3. COG% checks
    if (amazonPrice && amazonPrice > 0 && totalPrice > 0) {
      const cogPercent = (totalPrice / amazonPrice) * 100;
      if (cogPercent < 5) {
        score += SIGNAL_WEIGHTS.VERY_LOW_COG;
        signals.push({
          signal: 'VERY_LOW_COG',
          points: SIGNAL_WEIGHTS.VERY_LOW_COG,
          description: `Very low COG: ${cogPercent.toFixed(1)}%`,
        });
      } else if (cogPercent < 10) {
        score += SIGNAL_WEIGHTS.LOW_COG;
        signals.push({
          signal: 'LOW_COG',
          points: SIGNAL_WEIGHTS.LOW_COG,
          description: `Low COG: ${cogPercent.toFixed(1)}%`,
        });
      } else if (cogPercent < 15) {
        score += SIGNAL_WEIGHTS.SUSPICIOUS_COG;
        signals.push({
          signal: 'SUSPICIOUS_COG',
          points: SIGNAL_WEIGHTS.SUSPICIOUS_COG,
          description: `Suspicious COG: ${cogPercent.toFixed(1)}%`,
        });
      } else if (cogPercent < 20) {
        score += SIGNAL_WEIGHTS.ELEVATED_COG;
        signals.push({
          signal: 'ELEVATED_COG',
          points: SIGNAL_WEIGHTS.ELEVATED_COG,
          description: `Elevated COG: ${cogPercent.toFixed(1)}%`,
        });
      }
    }

    // 4. Part number pattern in title (e.g., "24183pb01")
    if (PART_NUMBER_PATTERN.test(title)) {
      score += SIGNAL_WEIGHTS.PART_NUMBER_PATTERN;
      signals.push({
        signal: 'PART_NUMBER_PATTERN',
        points: SIGNAL_WEIGHTS.PART_NUMBER_PATTERN,
        description: 'Part number pattern detected (e.g., 24183pb01)',
      });
    }

    // 5. Minifigure keywords (skip if "buildable figure" — that's a real LEGO product line)
    if (MINIFIG_KEYWORDS.test(title) && !/\bbuildable\s+figure/i.test(title)) {
      score += SIGNAL_WEIGHTS.MINIFIGURE_KEYWORDS;
      signals.push({
        signal: 'MINIFIGURE_KEYWORDS',
        points: SIGNAL_WEIGHTS.MINIFIGURE_KEYWORDS,
        description: 'Minifigure keyword in title',
      });
    }

    // 6. Instructions/manual only
    if (INSTRUCTIONS_KEYWORDS.test(title)) {
      if (
        /\b(only|just|booklet|vgc|good\s+condition)\b/i.test(title) ||
        /\b(?:for|from)\s+\d{4,5}\b/i.test(title)
      ) {
        score += SIGNAL_WEIGHTS.INSTRUCTIONS_ONLY;
        signals.push({
          signal: 'INSTRUCTIONS_ONLY',
          points: SIGNAL_WEIGHTS.INSTRUCTIONS_ONLY,
          description: 'Instructions/manual only listing',
        });
      }
    }

    // 7 & 13. Set number check - missing or WRONG SET
    if (setNumber) {
      if (!title.includes(setNumber)) {
        // Extract all numbers from title that could be set numbers
        const titleNumbers: string[] = [];
        let match;
        const regex = new RegExp(SET_NUMBER_PATTERN.source, 'g');
        while ((match = regex.exec(title)) !== null) {
          titleNumbers.push(match[1]);
        }

        // Check if any are DIFFERENT valid LEGO set numbers
        const differentSets = titleNumbers.filter((n) => validSetNumbers.has(n) && n !== setNumber);

        if (differentSets.length > 0) {
          // CRITICAL: Title has DIFFERENT valid LEGO set number!
          score += SIGNAL_WEIGHTS.WRONG_SET_NUMBER;
          signals.push({
            signal: 'WRONG_SET_NUMBER',
            points: SIGNAL_WEIGHTS.WRONG_SET_NUMBER,
            description: `WRONG SET: Title has ${differentSets[0]}, expected ${setNumber}`,
          });
        } else {
          // Just missing set number
          score += SIGNAL_WEIGHTS.MISSING_SET_NUMBER;
          signals.push({
            signal: 'MISSING_SET_NUMBER',
            points: SIGNAL_WEIGHTS.MISSING_SET_NUMBER,
            description: `Set number '${setNumber}' not in title`,
          });
        }
      }
    }

    // 12. Name mismatch check
    if (setName && setNumber) {
      const setWords = new Set(
        (setName.match(/\b[a-zA-Z]{3,}\b/g) || [])
          .map((w) => w.toLowerCase())
          .filter((w) => !STOP_WORDS.has(w))
      );

      const titleWords = new Set(
        (title.match(/\b[a-zA-Z]{3,}\b/g) || [])
          .map((w) => w.toLowerCase())
          .filter((w) => !STOP_WORDS.has(w))
      );

      if (setWords.size >= 2) {
        const overlap = [...setWords].filter((w) => titleWords.has(w));
        const overlapRatio = overlap.length / setWords.size;

        if (overlapRatio < 0.2) {
          score += SIGNAL_WEIGHTS.NAME_MISMATCH;
          signals.push({
            signal: 'NAME_MISMATCH',
            points: SIGNAL_WEIGHTS.NAME_MISMATCH,
            description: `Name mismatch: '${setName}' not reflected in title`,
          });
        }
      }
    }

    // 8. Parts/pieces keywords without "set"
    if (PARTS_KEYWORDS.test(title) && !/\bset\b/i.test(title)) {
      score += SIGNAL_WEIGHTS.PARTS_PIECES_KEYWORDS;
      signals.push({
        signal: 'PARTS_PIECES_KEYWORDS',
        points: SIGNAL_WEIGHTS.PARTS_PIECES_KEYWORDS,
        description: "Parts/pieces keywords without 'set'",
      });
    }

    // 9. Incomplete indicators
    if (INCOMPLETE_KEYWORDS.test(title)) {
      score += SIGNAL_WEIGHTS.INCOMPLETE_INDICATORS;
      signals.push({
        signal: 'INCOMPLETE_INDICATORS',
        points: SIGNAL_WEIGHTS.INCOMPLETE_INDICATORS,
        description: 'Incomplete/damaged indicators',
      });
    }

    // 10. "X only" pattern
    const itemOnlyMatch = ITEM_ONLY_PATTERN.exec(title);
    if (itemOnlyMatch) {
      score += SIGNAL_WEIGHTS.ITEM_ONLY_PATTERN;
      signals.push({
        signal: 'ITEM_ONLY_PATTERN',
        points: SIGNAL_WEIGHTS.ITEM_ONLY_PATTERN,
        description: `'${itemOnlyMatch[0]}' - not complete set`,
      });
    }

    // 11. Keyring/keychain detection
    if (KEYRING_KEYWORDS.test(title)) {
      score += SIGNAL_WEIGHTS.KEYRING_DETECTION;
      signals.push({
        signal: 'KEYRING_DETECTION',
        points: SIGNAL_WEIGHTS.KEYRING_DETECTION,
        description: 'Keyring/keychain listing',
      });
    }

    // 14. Price anomaly check
    if (amazonPrice && amazonPrice > 50 && totalPrice < 10) {
      score += SIGNAL_WEIGHTS.PRICE_ANOMALY;
      signals.push({
        signal: 'PRICE_ANOMALY',
        points: SIGNAL_WEIGHTS.PRICE_ANOMALY,
        description: `Price anomaly: £${totalPrice.toFixed(2)} vs £${amazonPrice.toFixed(2)} Amazon`,
      });
    }

    // 15. LED light kit detection
    if (LED_LIGHT_KIT_KEYWORDS.test(title)) {
      score += SIGNAL_WEIGHTS.LED_LIGHT_KIT;
      signals.push({
        signal: 'LED_LIGHT_KIT',
        points: SIGNAL_WEIGHTS.LED_LIGHT_KIT,
        description: 'LED light kit / lighting set (not a LEGO set)',
      });
    }

    // 16. Display accessory detection
    if (DISPLAY_ACCESSORY_KEYWORDS.test(title)) {
      score += SIGNAL_WEIGHTS.DISPLAY_ACCESSORY;
      signals.push({
        signal: 'DISPLAY_ACCESSORY',
        points: SIGNAL_WEIGHTS.DISPLAY_ACCESSORY,
        description: 'Display stand/case/frame accessory',
      });
    }

    // 17. Third-party product detection
    if (THIRD_PARTY_KEYWORDS.test(title)) {
      score += SIGNAL_WEIGHTS.THIRD_PARTY_PRODUCT;
      signals.push({
        signal: 'THIRD_PARTY_PRODUCT',
        points: SIGNAL_WEIGHTS.THIRD_PARTY_PRODUCT,
        description: 'Third-party product ("for LEGO" / "compatible with")',
      });
    }

    // 18. Bundle/lot detection
    if (BUNDLE_LOT_KEYWORDS.test(title)) {
      score += SIGNAL_WEIGHTS.BUNDLE_LOT;
      signals.push({
        signal: 'BUNDLE_LOT',
        points: SIGNAL_WEIGHTS.BUNDLE_LOT,
        description: 'Bundle/job lot listing',
      });
    }

    // 19. Custom/MOC detection
    if (CUSTOM_MOC_KEYWORDS.test(title)) {
      score += SIGNAL_WEIGHTS.CUSTOM_MOC;
      signals.push({
        signal: 'CUSTOM_MOC',
        points: SIGNAL_WEIGHTS.CUSTOM_MOC,
        description: 'Custom MOC / non-official build',
      });
    }

    // 20. Multi-quantity detection
    if (MULTI_QUANTITY_PATTERN.test(title)) {
      score += SIGNAL_WEIGHTS.MULTI_QUANTITY;
      signals.push({
        signal: 'MULTI_QUANTITY',
        points: SIGNAL_WEIGHTS.MULTI_QUANTITY,
        description: 'Multi-quantity listing (x2, x3, etc.)',
      });
    }

    // 21. Book/magazine detection
    if (BOOK_MAGAZINE_KEYWORDS.test(title)) {
      score += SIGNAL_WEIGHTS.BOOK_MAGAZINE;
      signals.push({
        signal: 'BOOK_MAGAZINE',
        points: SIGNAL_WEIGHTS.BOOK_MAGAZINE,
        description: 'Book/magazine/annual (not a set)',
      });
    }

    // 22. Sticker sheet / poster / decal detection
    if (STICKER_POSTER_KEYWORDS.test(title)) {
      score += SIGNAL_WEIGHTS.STICKER_POSTER;
      signals.push({
        signal: 'STICKER_POSTER',
        points: SIGNAL_WEIGHTS.STICKER_POSTER,
        description: 'Sticker sheet/poster/decal (not a complete set)',
      });
    }

    // 23. Polybag / paper bag detection (skip if set number is in title — selling the actual polybag set)
    if (POLYBAG_KEYWORDS.test(title) && !(setNumber && title.includes(setNumber))) {
      score += SIGNAL_WEIGHTS.POLYBAG_PAPER_BAG;
      signals.push({
        signal: 'POLYBAG_PAPER_BAG',
        points: SIGNAL_WEIGHTS.POLYBAG_PAPER_BAG,
        description: 'Polybag/paper bag listing (not boxed set)',
      });
    }

    // 24. Advent calendar day sale
    if (ADVENT_DAY_KEYWORDS.test(title)) {
      score += SIGNAL_WEIGHTS.ADVENT_DAY_SALE;
      signals.push({
        signal: 'ADVENT_DAY_SALE',
        points: SIGNAL_WEIGHTS.ADVENT_DAY_SALE,
        description: 'Advent calendar individual day sale',
      });
    }

    // 25. Split from set
    if (SPLIT_FROM_KEYWORDS.test(title)) {
      score += SIGNAL_WEIGHTS.SPLIT_FROM_SET;
      signals.push({
        signal: 'SPLIT_FROM_SET',
        points: SIGNAL_WEIGHTS.SPLIT_FROM_SET,
        description: 'Item split/extracted from a set',
      });
    }

    // 26. No minifigures included
    if (NO_MINIFIGS_KEYWORDS.test(title)) {
      score += SIGNAL_WEIGHTS.NO_MINIFIGURES;
      signals.push({
        signal: 'NO_MINIFIGURES',
        points: SIGNAL_WEIGHTS.NO_MINIFIGURES,
        description: 'Listing explicitly states no minifigures',
      });
    }

    // 27. Promotional item (tin, metal box, shaped box)
    if (PROMOTIONAL_KEYWORDS.test(title)) {
      score += SIGNAL_WEIGHTS.PROMOTIONAL_ITEM;
      signals.push({
        signal: 'PROMOTIONAL_ITEM',
        points: SIGNAL_WEIGHTS.PROMOTIONAL_ITEM,
        description: 'Promotional item (metal box/tin/shaped box)',
      });
    }

    // 28. Min-to-avg price ratio check
    if (avgPrice && avgPrice > 0 && totalPrice > 0 && totalPrice / avgPrice < 0.1) {
      score += SIGNAL_WEIGHTS.MIN_TO_AVG_RATIO;
      signals.push({
        signal: 'MIN_TO_AVG_RATIO',
        points: SIGNAL_WEIGHTS.MIN_TO_AVG_RATIO,
        description: `Price is <10% of avg eBay price (£${totalPrice.toFixed(2)} vs £${avgPrice.toFixed(2)} avg)`,
      });
    }

    // Cap at 100
    return { score: Math.min(score, 100), signals };
  }

  /**
   * Fetch all arbitrage items with eBay data (paginated)
   */
  async fetchArbitrageItems(): Promise<ArbitrageViewItem[]> {
    const items: ArbitrageViewItem[] = [];
    const pageSize = 1000;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('arbitrage_current_view')
        .select('bricklink_set_number, name, effective_amazon_price, ebay_listings')
        .in('item_type', ['inventory', 'seeded'])
        .not('ebay_listings', 'is', null)
        .range(offset, offset + pageSize - 1);

      if (error) {
        console.error('[EbayFpDetector] Failed to fetch arbitrage items:', error);
        break;
      }

      if (!data || data.length === 0) {
        hasMore = false;
        break;
      }

      items.push(...data);
      hasMore = data.length === pageSize;
      offset += pageSize;
    }

    console.log(`[EbayFpDetector] Fetched ${items.length} arbitrage items with eBay data`);
    return items;
  }

  /**
   * Run the FP detection and exclusion job
   */
  async runCleanup(config?: Partial<FpDetectorConfig>): Promise<FpCleanupResult> {
    const startTime = Date.now();
    const threshold = config?.threshold ?? DEFAULT_THRESHOLD;
    const userId = config?.userId ?? DEFAULT_USER_ID;

    let itemsScanned = 0;
    let listingsScanned = 0;
    let itemsFlagged = 0;
    let itemsExcluded = 0;
    let errors = 0;
    const reasonCounts: Map<string, number> = new Map();
    const exclusionsToInsert: ExclusionRecord[] = [];

    try {
      // Load valid set numbers and existing exclusions in parallel
      const [validSetNumbers, excludedBySet] = await Promise.all([
        this.loadValidSetNumbers(),
        this.loadExcludedListings(userId),
      ]);

      // Fetch all arbitrage items with eBay data
      const items = await this.fetchArbitrageItems();
      itemsScanned = items.length;

      if (items.length === 0) {
        console.log('[EbayFpDetector] No items to process');
        return {
          success: true,
          itemsScanned: 0,
          listingsScanned: 0,
          itemsFlagged: 0,
          itemsExcluded: 0,
          errors: 0,
          duration: Date.now() - startTime,
          topReasons: [],
        };
      }

      // Process each item
      for (const item of items) {
        const setNumber = this.extractSetNumber(item.bricklink_set_number);
        const amazonPrice = item.effective_amazon_price;

        // Parse eBay listings
        let listings: EbayListing[] = [];
        try {
          if (typeof item.ebay_listings === 'string') {
            listings = JSON.parse(item.ebay_listings);
          } else if (Array.isArray(item.ebay_listings)) {
            listings = item.ebay_listings;
          }
        } catch (parseError) {
          console.warn(
            `[EbayFpDetector] Failed to parse listings for ${item.bricklink_set_number}:`,
            parseError
          );
          errors++;
          continue;
        }

        // Get per-set exclusion list
        const setExcludedIds =
          excludedBySet.get(item.bricklink_set_number ?? '') ?? new Set<string>();

        // Compute average price across listings for this item
        const prices = listings.map((l) => l.totalPrice ?? l.price ?? 0).filter((p) => p > 0);
        const avgPrice =
          prices.length > 0 ? prices.reduce((sum, p) => sum + p, 0) / prices.length : null;

        // Score each listing
        for (const listing of listings) {
          listingsScanned++;

          // Skip already excluded for THIS set
          if (setExcludedIds.has(listing.itemId)) {
            continue;
          }

          const { score, signals } = this.scoreListing(
            listing,
            setNumber,
            item.name,
            amazonPrice,
            validSetNumbers,
            avgPrice
          );

          if (score >= threshold) {
            itemsFlagged++;

            // Track reasons
            for (const signal of signals) {
              const count = reasonCounts.get(signal.signal) ?? 0;
              reasonCounts.set(signal.signal, count + 1);
            }

            // Prepare exclusion record
            const reason = signals.map((s) => s.description).join(', ');
            exclusionsToInsert.push({
              user_id: userId,
              ebay_item_id: listing.itemId,
              set_number: item.bricklink_set_number ?? 'UNKNOWN',
              title: (listing.title || '').slice(0, 200),
              reason: reason.slice(0, 500),
            });
          }
        }
      }

      // Batch insert exclusions (with ON CONFLICT DO NOTHING)
      if (exclusionsToInsert.length > 0) {
        const { error: insertError } = await this.supabase
          .from('excluded_ebay_listings')
          .upsert(exclusionsToInsert, {
            onConflict: 'user_id,ebay_item_id,set_number',
            ignoreDuplicates: true,
          });

        if (insertError) {
          console.error('[EbayFpDetector] Failed to insert exclusions:', insertError);
          errors++;
        } else {
          itemsExcluded = exclusionsToInsert.length;
          console.log(`[EbayFpDetector] Inserted ${itemsExcluded} exclusions`);
        }
      }

      // Get top 3 reasons
      const topReasons = [...reasonCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([reason, count]) => `${reason}: ${count}`);

      return {
        success: true,
        itemsScanned,
        listingsScanned,
        itemsFlagged,
        itemsExcluded,
        errors,
        duration: Date.now() - startTime,
        topReasons,
      };
    } catch (error) {
      console.error('[EbayFpDetector] Cleanup failed:', error);
      return {
        success: false,
        itemsScanned,
        listingsScanned,
        itemsFlagged,
        itemsExcluded,
        errors: errors + 1,
        duration: Date.now() - startTime,
        topReasons: [],
      };
    }
  }
}
