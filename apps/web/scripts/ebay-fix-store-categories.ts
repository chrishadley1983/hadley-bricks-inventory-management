/**
 * Bulk fix: Assign correct eBay store categories to miscategorised listings.
 *
 * Uses Inventory API (updateOffer) for inventory-managed listings,
 * falls back to Trading API (reviseFixedPriceItem) for legacy listings.
 *
 * Store category rules:
 *   Non-LEGO item          → Anything Else      (44622911018)
 *   Minifigure              → Lego Minifigures   (48000873018)
 *   New/Sealed condition    → Lego New Sets      (48000876018)
 *   Used complete set       → Lego Used Sets     (48000875018)
 *   Parts/track/pieces      → Lego               (44622906018)
 *   Instructions/books      → Lego Other         (48000877018)
 *
 * Usage: npx tsx apps/web/scripts/ebay-fix-store-categories.ts [--dry-run] [--include-item-category-fix]
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import { EbayAuthService } from '../src/lib/ebay/ebay-auth.service';
import { EbayApiAdapter } from '../src/lib/ebay/ebay-api.adapter';
import { EbayTradingClient } from '../src/lib/platform-stock/ebay/ebay-trading.client';
import type { ParsedEbayListing } from '../src/lib/platform-stock/ebay/types';
import {
  STORE_CATEGORY_BY_ID,
  getCorrectStoreCategory as getCorrectStoreCategoryShared,
  looksLikeCompleteSet,
} from '../src/lib/ebay/ebay-store-category-rules';

function getCorrectStoreCategory(listing: ParsedEbayListing) {
  return getCorrectStoreCategoryShared({
    title: listing.title,
    categoryId: listing.ebayData?.categoryId,
    categoryName: listing.ebayData?.categoryName,
    condition: listing.ebayData?.condition,
  });
}

const STORE_CAT_NAMES_BY_ID = STORE_CATEGORY_BY_ID;

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const includeItemCatFix = process.argv.includes('--include-item-category-fix');

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

  // Refresh token every N items to avoid expiry mid-run
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

  // Build revision plans
  interface RevisionPlan {
    listing: ParsedEbayListing;
    storeCatChange?: { fromId: string; fromName: string; toId: string; toName: string; reason: string };
    itemCatChange?: { from: string; to: string };
  }

  const plans: RevisionPlan[] = [];

  for (const listing of listings) {
    const currentStoreCatId = String(listing.ebayData?.storeCategoryId || '1');
    const correct = getCorrectStoreCategory(listing);
    const storeMismatch = correct.id !== currentStoreCatId;

    const currentItemCatId = String(listing.ebayData?.categoryId || '');
    const itemCatNeedsFix =
      includeItemCatFix && currentItemCatId === '183448' && !isPartsListing(listing.title);

    if (!storeMismatch && !itemCatNeedsFix) continue;

    const plan: RevisionPlan = { listing };

    if (storeMismatch) {
      plan.storeCatChange = {
        fromId: currentStoreCatId,
        fromName: STORE_CAT_NAMES_BY_ID[currentStoreCatId] || currentStoreCatId,
        toId: correct.id,
        toName: correct.name,
        reason: correct.reason,
      };
    }

    if (itemCatNeedsFix) {
      plan.itemCatChange = { from: '183448', to: '19006' };
    }

    plans.push(plan);
  }

  // Summary
  const storeChanges = plans.filter((p) => p.storeCatChange);
  const itemChanges = plans.filter((p) => p.itemCatChange);

  console.log(`Store category changes needed: ${storeChanges.length}`);
  console.log(`Item category changes needed: ${itemChanges.length}`);
  console.log(`Total revisions (combined): ${plans.length}\n`);

  // Group by change type
  const changeGroups = new Map<string, RevisionPlan[]>();
  for (const plan of plans) {
    const key = plan.storeCatChange
      ? `${plan.storeCatChange.fromName} → ${plan.storeCatChange.toName}`
      : 'Item category only';
    if (!changeGroups.has(key)) changeGroups.set(key, []);
    changeGroups.get(key)!.push(plan);
  }

  for (const [change, items] of [...changeGroups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`--- ${change} (${items.length}) ---`);
    for (const item of items.slice(0, 5)) {
      const extra = item.itemCatChange ? ' [+item cat fix]' : '';
      console.log(`  [${item.listing.platformItemId}] ${item.listing.title.substring(0, 60)}${extra}`);
    }
    if (items.length > 5) console.log(`  ... and ${items.length - 5} more`);
    console.log();
  }

  if (plans.length === 0) { console.log('No items to fix.'); return; }

  if (dryRun) {
    console.log(`*** DRY RUN complete — ${plans.length} items would be revised ***`);
    return;
  }

  // Execute revisions
  console.log(`Revising ${plans.length} listings...`);
  let success = 0;
  let failed = 0;

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const listing = plan.listing;
    const changes: string[] = [];
    if (plan.storeCatChange) changes.push(`store: → ${plan.storeCatChange.toName}`);
    if (plan.itemCatChange) changes.push(`item: → 19006`);

    await refreshTokenIfNeeded(i);

    process.stdout.write(`  [${i + 1}/${plans.length}] ${listing.platformItemId} (${changes.join(', ')})... `);

    let ok = false;

    // Try Inventory API first
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

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const update: Record<string, any> = {
            sku: current.sku,
            marketplaceId: current.marketplaceId,
            format: current.format,
            categoryId: plan.itemCatChange ? plan.itemCatChange.to : (current.categoryId ?? ''),
            ...(description ? { listingDescription: description } : {}),
            listingPolicies: current.listingPolicies,
            pricingSummary: current.pricingSummary,
          };

          if (plan.storeCatChange) {
            update.storeCategoryNames = [plan.storeCatChange.toName];
          } else if (current.storeCategoryNames) {
            update.storeCategoryNames = current.storeCategoryNames;
          }

          await adapter.updateOffer(offers[0].offerId, update);
          ok = true;
        }
      } catch {
        // Fall through to Trading API
      }
    }

    // Fall back to Trading API
    if (!ok) {
      const reviseRequest: Record<string, string> = {
        itemId: String(listing.platformItemId),
      };
      if (plan.itemCatChange) reviseRequest.categoryId = plan.itemCatChange.to;
      if (plan.storeCatChange) reviseRequest.storeCategoryId = plan.storeCatChange.toId;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await tradingClient.reviseFixedPriceItem(reviseRequest as any);
      ok = result.success;
      if (!ok) {
        console.log(`FAILED: ${result.errorMessage?.substring(0, 70)}`);
        failed++;
        if (i < plans.length - 1) await new Promise((r) => setTimeout(r, 200));
        continue;
      }
    }

    if (ok) {
      console.log('OK');
      success++;
    }

    if (i < plans.length - 1) await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\nDone. Success: ${success}, Failed: ${failed}`);
}

function isPartsListing(title: string): boolean {
  return !looksLikeCompleteSet(title);
}

main().catch(console.error);
