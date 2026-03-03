/**
 * FP Detector Validation Script
 *
 * Runs the FP detector scoring against real production eBay listing data
 * to validate detection accuracy before deploying changes.
 *
 * Usage:
 *   npx tsx scripts/validate-fp-detector.ts
 *
 * Reports:
 *   1. Top 50 lowest COG% listings that survive FP filtering (should be genuine deals)
 *   2. Recently excluded listings that might be false exclusions (genuine sets wrongly caught)
 *   3. Summary statistics
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { EbayFpDetectorService } from '../src/lib/arbitrage/ebay-fp-detector.service';
import type { EbayListing } from '../src/lib/arbitrage/types';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface ScoredListing {
  setNumber: string;
  setName: string | null;
  amazonPrice: number;
  ebayPrice: number;
  cog: number;
  title: string;
  itemId: string;
  score: number;
  signals: string[];
  totalListings: number;
  validListings: number;
}

async function loadExcludedIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data } = await supabase
      .from('excluded_ebay_listings')
      .select('ebay_item_id')
      .range(offset, offset + pageSize - 1);
    if (!data || data.length === 0) break;
    data.forEach((d: { ebay_item_id: string }) => ids.add(d.ebay_item_id));
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return ids;
}

async function loadArbitrageItems(): Promise<
  Array<{
    bricklink_set_number: string;
    name: string | null;
    effective_amazon_price: number;
    ebay_listings: EbayListing[] | string;
  }>
> {
  const items: Array<{
    bricklink_set_number: string;
    name: string | null;
    effective_amazon_price: number;
    ebay_listings: EbayListing[] | string;
  }> = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data } = await supabase
      .from('arbitrage_current_view')
      .select('bricklink_set_number, name, effective_amazon_price, ebay_listings')
      .in('item_type', ['inventory', 'seeded'])
      .not('ebay_listings', 'is', null)
      .not('effective_amazon_price', 'is', null)
      .range(offset, offset + pageSize - 1);
    if (!data || data.length === 0) break;
    items.push(
      ...(data as Array<{
        bricklink_set_number: string;
        name: string | null;
        effective_amazon_price: number;
        ebay_listings: EbayListing[] | string;
      }>)
    );
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return items;
}

function extractSetNumber(blSetNumber: string): string {
  const match = blSetNumber.match(/^(\d+)/);
  return match ? match[1] : blSetNumber;
}

async function run() {
  console.log('=== FP Detector Validation ===\n');

  // Create the detector service
  const detector = new EbayFpDetectorService(supabase);

  // Load valid set numbers
  console.log('Loading valid set numbers...');
  const validSetNumbers = await detector.loadValidSetNumbers();
  console.log(`  ${validSetNumbers.size} valid set numbers loaded\n`);

  // Load existing exclusions
  console.log('Loading existing exclusions...');
  const excludedIds = await loadExcludedIds();
  console.log(`  ${excludedIds.size} excluded listing IDs loaded\n`);

  // Load arbitrage items
  console.log('Loading arbitrage items...');
  const items = await loadArbitrageItems();
  console.log(`  ${items.length} items with eBay data loaded\n`);

  // Score all listings
  console.log('Scoring all listings...\n');
  const survivingListings: ScoredListing[] = [];
  const newlyFlagged: ScoredListing[] = [];
  let totalListings = 0;
  let alreadyExcluded = 0;
  let nowFlagged = 0;
  let surviving = 0;

  for (const item of items) {
    let listings: EbayListing[];
    try {
      listings =
        typeof item.ebay_listings === 'string'
          ? JSON.parse(item.ebay_listings)
          : (item.ebay_listings as EbayListing[]);
    } catch {
      continue;
    }
    if (!Array.isArray(listings) || listings.length === 0) continue;

    const setNumber = extractSetNumber(item.bricklink_set_number);
    const amazonPrice = parseFloat(String(item.effective_amazon_price));
    if (!amazonPrice || amazonPrice <= 0) continue;

    // Calculate avg eBay price for this set (used by MIN_TO_AVG_RATIO signal)
    const prices = listings
      .map((l) => l.totalPrice ?? l.price ?? 0)
      .filter((p) => p > 0);
    const avgPrice =
      prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : null;

    for (const listing of listings) {
      totalListings++;
      const itemId = listing.itemId;

      // Skip already excluded
      if (excludedIds.has(itemId)) {
        alreadyExcluded++;
        continue;
      }

      // Score the listing
      const { score, signals } = detector.scoreListing(
        listing,
        setNumber,
        item.name,
        amazonPrice,
        validSetNumbers,
        avgPrice
      );

      const ebayPrice = listing.totalPrice ?? listing.price ?? 0;
      if (ebayPrice <= 0) continue;

      const cog = (ebayPrice / amazonPrice) * 100;
      const entry: ScoredListing = {
        setNumber,
        setName: item.name,
        amazonPrice,
        ebayPrice,
        cog,
        title: listing.title || '',
        itemId,
        score,
        signals: signals.map((s) => `${s.signal}(${s.points})`),
        totalListings: listings.length,
        validListings: listings.filter((l) => !excludedIds.has(l.itemId)).length,
      };

      if (score >= 50) {
        nowFlagged++;
        newlyFlagged.push(entry);
      } else {
        surviving++;
        survivingListings.push(entry);
      }
    }
  }

  // Sort surviving by COG ascending
  survivingListings.sort((a, b) => a.cog - b.cog);
  const top50 = survivingListings.slice(0, 50);

  // =============================================
  // REPORT 1: Top 50 lowest COG surviving listings
  // =============================================
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' REPORT 1: Top 50 Lowest COG% Surviving Listings');
  console.log(' (These should all be genuine deals, not FPs)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  for (let i = 0; i < top50.length; i++) {
    const r = top50[i];
    const flag =
      r.cog < 15 ? '⚠️ ' : r.cog < 25 ? '   ' : '✅ ';
    console.log(
      `${flag}${String(i + 1).padStart(2)}. [${r.setNumber}] COG: ${r.cog.toFixed(1)}% | Score: ${r.score}/50`
    );
    console.log(`      Amazon: £${r.amazonPrice.toFixed(2)} | eBay: £${r.ebayPrice.toFixed(2)}`);
    console.log(`      Title: ${r.title}`);
    if (r.signals.length > 0) {
      console.log(`      Signals: ${r.signals.join(', ')}`);
    }
    console.log('');
  }

  // =============================================
  // REPORT 2: Newly flagged — check for false exclusions
  // =============================================
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' REPORT 2: Newly Flagged Listings (Would Be Excluded)');
  console.log(' Check these for false exclusions — genuine sets wrongly caught');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Group newly flagged by primary signal for analysis
  const bySignal = new Map<string, ScoredListing[]>();
  for (const entry of newlyFlagged) {
    const primary = entry.signals[0] || 'UNKNOWN';
    const key = primary.replace(/\(\d+\)/, '');
    if (!bySignal.has(key)) bySignal.set(key, []);
    bySignal.get(key)!.push(entry);
  }

  // Show high-COG flagged listings (most likely to be false exclusions)
  // A genuine set at 40% COG being excluded is more concerning than one at 3% COG
  const highCogFlagged = newlyFlagged
    .filter((l) => l.cog > 25)
    .sort((a, b) => b.cog - a.cog);

  if (highCogFlagged.length > 0) {
    console.log(`Found ${highCogFlagged.length} newly flagged with COG > 25% (review these):\n`);
    for (const r of highCogFlagged.slice(0, 30)) {
      console.log(
        `  ⚠️  [${r.setNumber}] COG: ${r.cog.toFixed(1)}% | Score: ${r.score}/50`
      );
      console.log(`      Title: ${r.title}`);
      console.log(`      Signals: ${r.signals.join(', ')}`);
      console.log('');
    }
  } else {
    console.log('  No high-COG flagged listings (good — unlikely false exclusions)\n');
  }

  // Signal breakdown for newly flagged
  console.log('  Signal breakdown (newly flagged):');
  const sortedSignals = [...bySignal.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [signal, entries] of sortedSignals) {
    console.log(`    ${signal}: ${entries.length}`);
  }
  console.log('');

  // =============================================
  // REPORT 3: Summary
  // =============================================
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(`  Total listings scanned:     ${totalListings}`);
  console.log(`  Already excluded:           ${alreadyExcluded}`);
  console.log(`  Newly flagged (would excl): ${nowFlagged}`);
  console.log(`  Surviving (genuine deals):  ${surviving}`);
  console.log(`  Lowest surviving COG:       ${top50[0]?.cog.toFixed(1) ?? 'N/A'}%`);
  console.log(
    `  Top 50 avg COG:             ${(top50.reduce((s, l) => s + l.cog, 0) / top50.length).toFixed(1)}%`
  );
  console.log('');
}

run().catch(console.error);
