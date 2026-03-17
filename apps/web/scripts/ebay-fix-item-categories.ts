/**
 * Bulk fix: Move complete LEGO sets from category 183448 (Bricks & Parts) to 19006 (Complete Sets & Packs)
 *
 * Uses Inventory API (updateOffer) for inventory-managed listings,
 * falls back to Trading API (reviseFixedPriceItem) for legacy listings.
 *
 * Usage: npx tsx apps/web/scripts/ebay-fix-item-categories.ts [--dry-run]
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import { EbayAuthService } from '../src/lib/ebay/ebay-auth.service';
import { EbayApiAdapter } from '../src/lib/ebay/ebay-api.adapter';
import { EbayTradingClient } from '../src/lib/platform-stock/ebay/ebay-trading.client';
import { looksLikeCompleteSet } from '../src/lib/ebay/ebay-store-category-rules';

const WRONG_CATEGORY = '183448';
const CORRECT_CATEGORY = '19006';

const shouldFix = looksLikeCompleteSet;

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) console.log('*** DRY RUN — no changes will be made ***\n');

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: creds } = await (supabase as any)
    .from('ebay_credentials')
    .select('user_id')
    .limit(1)
    .single();

  if (!creds) { console.error('No eBay credentials found'); process.exit(1); }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const authService = new EbayAuthService(undefined, supabase as any);
  let accessToken = await authService.getAccessToken(creds.user_id);
  if (!accessToken) { console.error('Could not get eBay access token'); process.exit(1); }

  let adapter = new EbayApiAdapter({ accessToken, marketplaceId: 'EBAY_GB', userId: creds.user_id });
  let tradingClient = new EbayTradingClient({ accessToken, siteId: 3 });

  const REFRESH_INTERVAL = 50;
  async function refreshTokenIfNeeded(i: number) {
    if (i > 0 && i % REFRESH_INTERVAL === 0) {
      console.log(`\n  [Refreshing eBay token at item ${i}...]`);
      accessToken = await authService.getAccessToken(creds.user_id);
      if (!accessToken) throw new Error('Token refresh failed');
      adapter = new EbayApiAdapter({ accessToken, marketplaceId: 'EBAY_GB', userId: creds.user_id });
      tradingClient = new EbayTradingClient({ accessToken, siteId: 3 });
    }
  }

  console.log('Fetching all active listings...');
  const listings = await tradingClient.getAllActiveListings((c, t) => process.stdout.write(`\r  ${c}/${t}`));
  console.log(`\n  Total: ${listings.length}\n`);

  // Find listings in wrong category
  const toFix = listings.filter((l) => {
    const catId = String(l.ebayData?.categoryId || '');
    return catId === WRONG_CATEGORY && shouldFix(l.title);
  });

  const excluded = listings.filter((l) => {
    const catId = String(l.ebayData?.categoryId || '');
    return catId === WRONG_CATEGORY && !shouldFix(l.title);
  });

  console.log(`Listings in category ${WRONG_CATEGORY}: ${toFix.length + excluded.length}`);
  console.log(`  To fix (→ ${CORRECT_CATEGORY}): ${toFix.length}`);
  console.log(`  Excluded (correct in ${WRONG_CATEGORY}): ${excluded.length}`);

  if (excluded.length > 0) {
    console.log('\n  Excluded items:');
    for (const l of excluded) {
      console.log(`    [${l.platformItemId}] ${l.title}`);
    }
  }

  if (toFix.length === 0) { console.log('\nNo items to fix.'); return; }

  if (dryRun) {
    console.log('\nItems to fix:');
    for (const l of toFix) console.log(`  [${l.platformItemId}] ${l.title}`);
    console.log(`\n*** DRY RUN complete — ${toFix.length} items would be revised ***`);
    return;
  }

  // Revise each listing
  console.log(`\nRevising ${toFix.length} listings...`);
  let success = 0;
  let failed = 0;

  for (let i = 0; i < toFix.length; i++) {
    const listing = toFix[i];
    await refreshTokenIfNeeded(i);
    process.stdout.write(`  [${i + 1}/${toFix.length}] ${listing.platformItemId}... `);

    let ok = false;

    // Try Inventory API first (for listings created via HB tool)
    if (listing.platformSku) {
      try {
        const offers = await adapter.getOffersBySku(listing.platformSku);
        if (offers.length > 0) {
          const current = await adapter.getOffer(offers[0].offerId);

          // If offer has no description, fetch from Trading API (older listings)
          let description = current.listingDescription;
          if (!description && listing.platformItemId) {
            try {
              const fullItem = await tradingClient.getItem(String(listing.platformItemId));
              description = fullItem.description || undefined;
            } catch { /* ignore */ }
          }

          await adapter.updateOffer(offers[0].offerId, {
            sku: current.sku,
            marketplaceId: current.marketplaceId,
            format: current.format as 'FIXED_PRICE' | 'AUCTION',
            categoryId: CORRECT_CATEGORY,
            ...(description ? { listingDescription: description } : {}),
            listingPolicies: current.listingPolicies!,
            pricingSummary: current.pricingSummary!,
            ...(current.storeCategoryNames && { storeCategoryNames: current.storeCategoryNames }),
          });
          ok = true;
        }
      } catch {
        // Fall through to Trading API
      }
    }

    // Fall back to Trading API
    if (!ok) {
      const result = await tradingClient.reviseFixedPriceItem({
        itemId: String(listing.platformItemId),
        categoryId: CORRECT_CATEGORY,
      });
      ok = result.success;
      if (!ok) {
        console.log(`FAILED: ${result.errorMessage}`);
        failed++;
        continue;
      }
    }

    if (ok) {
      console.log('OK');
      success++;
    }

    // Rate limiting
    if (i < toFix.length - 1) await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\nDone. Success: ${success}, Failed: ${failed}`);
}

main().catch(console.error);
