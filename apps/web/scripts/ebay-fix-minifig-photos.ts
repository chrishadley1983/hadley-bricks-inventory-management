/**
 * Fix minifig listings with low-res photos that block all eBay API edits.
 *
 * Pipeline:
 * 1. Fetch all active listings, find those failing with photo size error
 * 2. Extract BrickLink ID from title (e.g. bio018, sw0277)
 * 3. Download BrickLink MN image, upscale with sharp to 600px
 * 4. Upload to Supabase Storage → UploadSiteHostedPictures → eBay-hosted URL
 * 5. Update inventory item with new photos (en-US headers)
 * 6. Update offer with store category "Lego Minifigures"
 *
 * Usage: npx tsx apps/web/scripts/ebay-fix-minifig-photos.ts [--dry-run]
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { EbayAuthService } from '../src/lib/ebay/ebay-auth.service';
import { EbayTradingClient } from '../src/lib/platform-stock/ebay/ebay-trading.client';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';

const EBAY_TRADING_API_URL = 'https://api.ebay.com/ws/api.dll';
const EBAY_INVENTORY_API = 'https://api.ebay.com/sell/inventory/v1';
const MIN_SIZE = 600;

async function uploadSiteHostedPicture(
  accessToken: string, externalImageUrl: string
): Promise<{ success: boolean; ebayUrl?: string; error?: string }> {
  const xmlBuilder = new XMLBuilder({
    ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text',
    format: true, suppressEmptyNode: true,
  });
  const requestXml = '<?xml version="1.0" encoding="utf-8"?>\n' + xmlBuilder.build({
    UploadSiteHostedPicturesRequest: {
      '@_xmlns': 'urn:ebay:apis:eBLBaseComponents',
      ExternalPictureURL: externalImageUrl,
      PictureName: 'minifig-upscale',
    },
  });

  const response = await fetch(EBAY_TRADING_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml',
      'X-EBAY-API-CALL-NAME': 'UploadSiteHostedPictures',
      'X-EBAY-API-SITEID': '3',
      'X-EBAY-API-COMPATIBILITY-LEVEL': '1349',
      'X-EBAY-API-IAF-TOKEN': accessToken,
    },
    body: requestXml,
  });

  const text = await response.text();
  const parser = new XMLParser({
    ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text',
    parseAttributeValue: false, trimValues: true,
  });
  const parsed = parser.parse(text);
  const apiResponse = parsed.UploadSiteHostedPicturesResponse;

  if (!apiResponse || apiResponse.Ack === 'Failure') {
    const errors = apiResponse?.Errors;
    const errArr = Array.isArray(errors) ? errors : [errors].filter(Boolean);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = errArr.map((e: any) => e.LongMessage || e.ShortMessage).join('; ');
    return { success: false, error: msg || 'Unknown error' };
  }

  const info = apiResponse.SiteHostedPictureDetails;
  return { success: true, ebayUrl: info?.FullURL || info?.BaseURL };
}

async function upscaleAndUpload(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, imageUrl: string, filename: string
): Promise<{ publicUrl: string; originalSize: string; newSize: string }> {
  const resp = await fetch(imageUrl);
  if (!resp.ok) throw new Error(`Failed to fetch: ${resp.status}`);
  const buffer = Buffer.from(await resp.arrayBuffer());

  const metadata = await sharp(buffer).metadata();
  const origW = metadata.width || 0;
  const origH = metadata.height || 0;

  let processed: Buffer;
  if (origW >= MIN_SIZE && origH >= MIN_SIZE) {
    processed = buffer;
  } else {
    const scale = MIN_SIZE / Math.max(origW, origH);
    processed = await sharp(buffer)
      .resize(Math.round(origW * scale), Math.round(origH * scale), { kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer();
  }

  const newMeta = await sharp(processed).metadata();
  const storagePath = `ebay-photos/${filename}`;
  const { error: uploadError } = await supabase.storage
    .from('images')
    .upload(storagePath, processed, { contentType: 'image/png', upsert: true });

  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

  const { data: urlData } = supabase.storage.from('images').getPublicUrl(storagePath);
  return {
    publicUrl: urlData.publicUrl,
    originalSize: `${origW}x${origH}`,
    newSize: `${newMeta.width}x${newMeta.height}`,
  };
}

function extractBricklinkId(title: string): string | null {
  // Match patterns like bio018, sw0277, njo0675, ww022, hp190, col017, etc.
  const match = title.match(/\b([a-z]{2,4}\d{2,5}[a-z]?)\b/i);
  return match ? match[1] : null;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) console.log('*** DRY RUN ***\n');

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: creds } = await (supabase as any)
    .from('ebay_credentials').select('user_id').limit(1).single();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const authService = new EbayAuthService(undefined, supabase as any);
  let accessToken = await authService.getAccessToken(creds.user_id);
  if (!accessToken) { console.error('No access token'); process.exit(1); }

  const tradingClient = new EbayTradingClient({ accessToken, siteId: 3 });

  console.log('Fetching all active listings...');
  const listings = await tradingClient.getAllActiveListings((c, t) => process.stdout.write(`\r  ${c}/${t}`));
  console.log(`\n  Total: ${listings.length}\n`);

  // Find minifig listings in store category "Other Items" (1) that have low-res photos
  // These are the ones that fail with "upload high resolution photos" error
  const minifigListings = listings.filter((l) => {
    const storeCatId = String(l.ebayData?.storeCategoryId || '1');
    const title = l.title.toLowerCase();
    return (
      storeCatId === '1' &&
      (title.includes('minifigure') || title.includes('minifig')) &&
      l.platformSku
    );
  });

  console.log(`Found ${minifigListings.length} minifig listings in "Other Items" to fix\n`);

  if (minifigListings.length === 0) {
    console.log('Nothing to fix.');
    return;
  }

  if (dryRun) {
    for (const l of minifigListings) {
      const blId = extractBricklinkId(l.title);
      console.log(`  [${l.platformItemId}] ${l.title.substring(0, 60)} → BL:${blId || '?'}`);
    }
    console.log(`\n*** DRY RUN — ${minifigListings.length} items would be processed ***`);
    return;
  }

  let success = 0;
  let failed = 0;
  const failures: { itemId: string; title: string; error: string }[] = [];

  const REFRESH_INTERVAL = 15;

  for (let i = 0; i < minifigListings.length; i++) {
    const listing = minifigListings[i];
    const itemId = String(listing.platformItemId);
    const sku = listing.platformSku!;

    // Refresh token periodically
    if (i > 0 && i % REFRESH_INTERVAL === 0) {
      console.log(`\n  [Refreshing token at item ${i}...]`);
      accessToken = await authService.getAccessToken(creds.user_id);
      if (!accessToken) { console.error('Token refresh failed'); break; }
    }

    process.stdout.write(`  [${i + 1}/${minifigListings.length}] ${itemId} `);

    try {
      // 1. Get full item details
      const fullItem = await tradingClient.getItem(itemId);

      // 2. Find BrickLink ID
      const blId = extractBricklinkId(fullItem.title);
      if (!blId) {
        console.log(`→ No BrickLink ID found in title — skipped`);
        failures.push({ itemId, title: fullItem.title, error: 'No BrickLink ID in title' });
        failed++;
        continue;
      }

      // 3. Check BrickLink image exists
      const blUrl = `https://img.bricklink.com/ItemImage/MN/0/${blId}.png`;
      const headResp = await fetch(blUrl, { method: 'HEAD' });
      if (!headResp.ok) {
        console.log(`→ BrickLink image not found for ${blId} — skipped`);
        failures.push({ itemId, title: fullItem.title, error: `BrickLink image 404 for ${blId}` });
        failed++;
        continue;
      }

      // 4. Upscale and upload
      const { publicUrl, originalSize, newSize } = await upscaleAndUpload(
        supabase, blUrl, `minifig-${itemId}-bl.png`
      );

      // 5. Upload to eBay Picture Service
      const uploadResult = await uploadSiteHostedPicture(accessToken!, publicUrl);
      if (!uploadResult.success || !uploadResult.ebayUrl) {
        console.log(`→ eBay upload failed: ${uploadResult.error} — skipped`);
        failures.push({ itemId, title: fullItem.title, error: `eBay upload: ${uploadResult.error}` });
        failed++;
        continue;
      }

      const newEbayUrls = [uploadResult.ebayUrl];

      // 6. Update inventory item photos via direct API (en-US headers)
      const apiHeaders = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Language': 'en-US',
        'Accept-Language': 'en-US',
      };

      const invResp = await fetch(`${EBAY_INVENTORY_API}/inventory_item/${encodeURIComponent(sku)}`, {
        headers: apiHeaders,
      });
      if (!invResp.ok) throw new Error(`Get inventory item failed: ${invResp.status}`);
      const invItem = await invResp.json();

      const updateInvResp = await fetch(`${EBAY_INVENTORY_API}/inventory_item/${encodeURIComponent(sku)}`, {
        method: 'PUT',
        headers: apiHeaders,
        body: JSON.stringify({
          ...invItem,
          product: { ...invItem.product, imageUrls: newEbayUrls },
        }),
      });
      if (!updateInvResp.ok) {
        const errText = await updateInvResp.text();
        throw new Error(`Update inventory item failed: ${updateInvResp.status} ${errText.substring(0, 80)}`);
      }

      // 7. Update offer with store category
      const offersResp = await fetch(
        `${EBAY_INVENTORY_API}/offer?sku=${encodeURIComponent(sku)}`,
        { headers: apiHeaders }
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const offersData = await offersResp.json() as any;
      const offers = offersData.offers || [];

      if (offers.length > 0) {
        const offerResp = await fetch(`${EBAY_INVENTORY_API}/offer/${offers[0].offerId}`, {
          headers: apiHeaders,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const current = await offerResp.json() as any;

        let description = current.listingDescription;
        if (!description) {
          description = fullItem.description || undefined;
        }

        const updateOfferResp = await fetch(`${EBAY_INVENTORY_API}/offer/${offers[0].offerId}`, {
          method: 'PUT',
          headers: apiHeaders,
          body: JSON.stringify({
            sku: current.sku,
            marketplaceId: current.marketplaceId,
            format: current.format,
            categoryId: current.categoryId ?? '',
            ...(description ? { listingDescription: description } : {}),
            listingPolicies: current.listingPolicies,
            pricingSummary: current.pricingSummary,
            storeCategoryNames: ['Lego Minifigures'],
          }),
        });

        if (!updateOfferResp.ok) {
          const errText = await updateOfferResp.text();
          throw new Error(`Update offer failed: ${updateOfferResp.status} ${errText.substring(0, 80)}`);
        }
      }

      console.log(`→ OK (${originalSize} → ${newSize})`);
      success++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`→ FAILED: ${msg.substring(0, 70)}`);
      failures.push({ itemId, title: listing.title, error: msg });
      failed++;
    }

    await new Promise((r) => setTimeout(r, 300));
  }

  // Summary
  console.log(`\n${'='.repeat(70)}`);
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total: ${minifigListings.length}`);
  console.log(`Success: ${success}`);
  console.log(`Failed: ${failed}`);

  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  [${f.itemId}] ${f.title.substring(0, 50)}: ${f.error.substring(0, 60)}`);
    }
  }
}

main().catch(console.error);
