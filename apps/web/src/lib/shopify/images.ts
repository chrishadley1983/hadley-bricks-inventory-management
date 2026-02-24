import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import type { ImageResolutionResult, ResolvedImage, EbayListingData } from './types';

/**
 * Fetch full eBay listing data (images + description) via Browse API.
 * Uses client credentials (no user auth needed).
 * Returns null if the listing can't be fetched.
 */
export async function fetchEbayListing(
  ebayListingId: string
): Promise<EbayListingData | null> {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    // Get application token
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'https://api.ebay.com/oauth/api_scope',
      }),
    });

    if (!tokenRes.ok) return null;
    const tokenData = await tokenRes.json();

    // Browse API GetItem — item ID format: v1|{legacyId}|0
    const browseItemId = `v1|${ebayListingId}|0`;
    const itemRes = await fetch(
      `https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(browseItemId)}`,
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
        },
      }
    );

    if (!itemRes.ok) {
      console.warn(`[eBay] Browse API returned ${itemRes.status} for ${ebayListingId}`);
      return null;
    }

    const data = await itemRes.json();

    // Extract all images
    const images: string[] = [];
    if (data.image?.imageUrl) {
      images.push(data.image.imageUrl);
    }
    if (Array.isArray(data.additionalImages)) {
      for (const img of data.additionalImages) {
        if (img?.imageUrl && !images.includes(img.imageUrl)) {
          images.push(img.imageUrl);
        }
      }
    }

    // Extract description (HTML)
    const description = data.description || data.shortDescription || null;

    return {
      images,
      description,
      title: data.title || null,
    };
  } catch (err) {
    console.warn(`[eBay] Failed to fetch listing ${ebayListingId}:`, err);
    return null;
  }
}

// ── Minifigure detection ──────────────────────────────────

const MINIFIG_PREFIXES = [
  'sw', 'col', 'coltlbm', 'coltlnm', 'colhp', 'colmar', 'coldis',
  'colsh', 'coltgb', 'fig', 'gen', 'hp', 'iaj', 'jw', 'loc', 'lor',
  'njo', 'poc', 'pot', 'sh', 'scd', 'tnt', 'tlm', 'sim',
];

function isMinifigure(item: { set_number: string | null; item_name: string | null }): boolean {
  const name = (item.item_name ?? '').toLowerCase();
  if (name.includes('minifigure') || name.includes('minifig')) return true;

  const setNum = (item.set_number ?? '').toLowerCase();
  return MINIFIG_PREFIXES.some((p) => setNum.startsWith(p) && /^[a-z]+\d/.test(setNum));
}

// ── Image resolution ──────────────────────────────────────

/**
 * Resolve images for an inventory item.
 *
 * Simple rules:
 * 1. Amazon items          → Brickset images (gallery + main, deduplicated)
 * 2. eBay minifigures      → Brickset images (gallery + main, deduplicated)
 * 3. eBay sets (new/used)  → eBay listing photos only
 */
export async function resolveImages(
  supabase: SupabaseClient<Database>,
  item: {
    id: string;
    set_number: string | null;
    item_name: string | null;
    ebay_listing_id: string | null;
    listing_platform: string | null;
  },
  ebayListing?: EbayListingData | null
): Promise<ImageResolutionResult> {
  const urls: string[] = [];
  const resolved: ResolvedImage[] = [];
  let source: ImageResolutionResult['source'] = 'none';

  const isEbay = item.listing_platform === 'ebay';
  const isEbaySet = isEbay && !isMinifigure(item);

  if (isEbaySet) {
    // ── eBay sets: use eBay listing photos first ──────────
    if (ebayListing && ebayListing.images.length > 0) {
      for (const url of ebayListing.images) {
        urls.push(url);
        resolved.push({ src: url });
      }
      source = 'ebay';
    } else if (item.ebay_listing_id) {
      try {
        const cachedImages = await fetchCachedEbayImages(supabase, item.ebay_listing_id);
        for (const url of cachedImages) {
          urls.push(url);
          resolved.push({ src: url });
        }
        if (cachedImages.length > 0) source = 'ebay';
      } catch (err) {
        console.warn(`[Images] Failed to fetch cached eBay images for ${item.id}:`, err);
      }
    }

    // Fallback: if eBay branch yielded no images, use Brickset
    if (urls.length === 0 && item.set_number && item.set_number !== 'NA') {
      const brickset = await fetchBricksetImages(supabase, item.set_number);
      for (const img of brickset) {
        urls.push(img.url);
        resolved.push(img.resolved);
      }
      if (brickset.length > 0) source = 'brickset';
    }
  } else {
    // ── Amazon items + eBay minifigures: Brickset images ─
    if (item.set_number && item.set_number !== 'NA') {
      const minifig = isMinifigure(item);

      if (minifig) {
        // Minifigure image from BrickLink CDN (used by Brickset's minifig pages)
        // Shopify can't fetch from BrickLink directly, so we download and upload as base64
        // BrickLink expects zero-padded 4-digit numbers, e.g. njo0208 not njo208
        const lower = item.set_number.toLowerCase();
        const zeroPadded = lower.replace(/(\D+)(\d+)/, (_m, prefix, num) =>
          `${prefix}${(num as string).padStart(4, '0')}`
        );

        const minifigCandidates = [
          `https://img.bricklink.com/ItemImage/MN/0/${zeroPadded}.png`,
          `https://img.bricklink.com/ItemImage/MN/0/${lower}.png`,
          `https://img.bricklink.com/ItemImage/MN/0/${item.set_number}.png`,
        ];

        for (const candidateUrl of minifigCandidates) {
          const b64 = await downloadAsBase64(candidateUrl);
          if (b64) {
            urls.push(`bricklink:${item.set_number}`);
            resolved.push({ attachment: b64, filename: `${item.set_number}.png` });
            source = 'brickset';
            break;
          }
        }
      }

      const brickset = await fetchBricksetImages(supabase, item.set_number);
      for (const img of brickset) {
        if (!urls.includes(img.url)) {
          urls.push(img.url);
          resolved.push(img.resolved);
        }
      }
      if (resolved.length > 0 && source === 'none') source = 'brickset';
    }
  }

  return {
    urls,
    images: resolved,
    source,
  };
}

/**
 * Download an image and return as base64 string.
 * Used for CDNs that block Shopify's image fetcher (e.g. BrickLink).
 */
async function downloadAsBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer.toString('base64');
  } catch {
    return null;
  }
}

// ── eBay image helpers ────────────────────────────────────

/**
 * Look up cached eBay images from platform_listings table.
 */
async function fetchCachedEbayImages(
  supabase: SupabaseClient<Database>,
  ebayListingId: string
): Promise<string[]> {
  const { data: listing } = await supabase
    .from('platform_listings')
    .select('raw_data')
    .eq('platform', 'ebay')
    .eq('platform_item_id', ebayListingId)
    .single();

  if (listing?.raw_data) {
    const raw = listing.raw_data as Record<string, unknown>;
    return extractEbayImageUrls(raw);
  }

  return [];
}

/**
 * Extract image URLs from eBay raw listing data (various API response formats).
 */
function extractEbayImageUrls(rawData: Record<string, unknown>): string[] {
  const urls: string[] = [];

  // From eBay Browse API response
  if (rawData.image && typeof rawData.image === 'object') {
    const img = rawData.image as Record<string, unknown>;
    if (typeof img.imageUrl === 'string') urls.push(img.imageUrl);
  }
  if (Array.isArray(rawData.additionalImages)) {
    for (const img of rawData.additionalImages) {
      if (typeof img === 'object' && img && typeof (img as Record<string, unknown>).imageUrl === 'string') {
        urls.push((img as Record<string, unknown>).imageUrl as string);
      }
    }
  }

  // From eBay Trading API GetItem response
  if (rawData.PictureDetails && typeof rawData.PictureDetails === 'object') {
    const pd = rawData.PictureDetails as Record<string, unknown>;
    if (Array.isArray(pd.PictureURL)) {
      urls.push(...pd.PictureURL.filter((u): u is string => typeof u === 'string'));
    } else if (typeof pd.PictureURL === 'string') {
      urls.push(pd.PictureURL);
    }
  }

  // From ebay_data JSON field
  if (rawData.pictureURLs && Array.isArray(rawData.pictureURLs)) {
    urls.push(...rawData.pictureURLs.filter((u): u is string => typeof u === 'string'));
  }

  return Array.from(new Set(urls));
}

// ── Brickset combined helper ──────────────────────────────

/**
 * Fetch all available Brickset images for a set (gallery + main DB image).
 * Returns a deduplicated list in display order.
 */
async function fetchBricksetImages(
  supabase: SupabaseClient<Database>,
  setNumber: string
): Promise<Array<{ url: string; resolved: ResolvedImage }>> {
  const results: Array<{ url: string; resolved: ResolvedImage }> = [];
  const seen = new Set<string>();

  // Gallery images (multiple angles — main, alt1-7)
  try {
    const gallery = await getBricksetGalleryImages(setNumber);
    for (const url of gallery) {
      if (!seen.has(url)) {
        seen.add(url);
        results.push({ url, resolved: { src: url } });
      }
    }
  } catch (err) {
    console.warn(`[Images] Brickset gallery probe failed for ${setNumber}:`, err);
  }

  // Main image from DB (if not already included)
  try {
    const mainUrl = await getBricksetImage(supabase, setNumber);
    if (mainUrl && !seen.has(mainUrl)) {
      seen.add(mainUrl);
      results.push({ url: mainUrl, resolved: { src: mainUrl } });
    }
  } catch (err) {
    console.warn(`[Images] Failed to fetch Brickset image for ${setNumber}:`, err);
  }

  // BrickLink set image as final fallback (handles magazine freebies etc.)
  if (results.length === 0) {
    const bricklinkUrl = `https://img.bricklink.com/ItemImage/SN/0/${setNumber}-1.png`;
    if (await isUrlAccessible(bricklinkUrl)) {
      results.push({ url: bricklinkUrl, resolved: { src: bricklinkUrl } });
    }
  }

  return results;
}

// ── Brickset image helpers ────────────────────────────────

/**
 * Probe Brickset's additional images CDN for gallery photos (multiple angles).
 * URL pattern: https://images.brickset.com/sets/AdditionalImages/{set}-1/{set}_main.jpg
 *              https://images.brickset.com/sets/AdditionalImages/{set}-1/{set}_alt1.jpg
 *              ... up to alt7
 *
 * Returns all accessible URLs (no max limit — take everything available).
 */
async function getBricksetGalleryImages(setNumber: string): Promise<string[]> {
  const baseSet = setNumber.includes('-') ? setNumber : `${setNumber}-1`;
  const numOnly = setNumber.replace(/-\d+$/, '');

  const candidates = [
    `https://images.brickset.com/sets/AdditionalImages/${baseSet}/${numOnly}_main.jpg`,
    ...Array.from({ length: 7 }, (_, i) =>
      `https://images.brickset.com/sets/AdditionalImages/${baseSet}/${numOnly}_alt${i + 1}.jpg`
    ),
  ];

  // Probe all in parallel
  const checks = await Promise.all(
    candidates.map(async (url) => {
      try {
        const res = await fetch(url, { method: 'HEAD' });
        const ct = res.headers.get('content-type') || '';
        return { url, ok: res.ok && ct.startsWith('image/') };
      } catch {
        return { url, ok: false };
      }
    })
  );

  return checks.filter((c) => c.ok).map((c) => c.url);
}

/**
 * Get box art image URL from brickset_sets table, falling back to direct URL.
 */
async function getBricksetImage(
  supabase: SupabaseClient<Database>,
  setNumber: string
): Promise<string | null> {
  const variants = [`${setNumber}-1`, setNumber];

  for (const variant of variants) {
    const { data } = await supabase
      .from('brickset_sets')
      .select('image_url')
      .eq('set_number', variant)
      .limit(1)
      .single();

    if (data?.image_url && data.image_url.startsWith('http')) return data.image_url;
  }

  // DB had no valid URL — try the direct Brickset image URL pattern
  try {
    const directUrl = `https://images.brickset.com/sets/images/${setNumber}-1.jpg`;
    if (await isUrlAccessible(directUrl)) return directUrl;
  } catch {
    // Non-fatal
  }

  return null;
}

/**
 * Check if a URL returns a valid image (HEAD request, 200 OK).
 */
async function isUrlAccessible(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return false;
    const contentType = res.headers.get('content-type') || '';
    return contentType.startsWith('image/');
  } catch {
    clearTimeout(timeout);
    return false;
  }
}

// ── Backfill helper ───────────────────────────────────────

/**
 * Backfill ebay_listing_id from platform_listings for items missing it.
 * Run once before initial sync.
 */
export async function backfillEbayListingIds(
  supabase: SupabaseClient<Database>
): Promise<number> {
  const { data, error } = await supabase.rpc('backfill_ebay_listing_ids' as never);

  if (error) {
    console.warn('[Images] RPC not available, using manual backfill');

    const { data: items } = await supabase
      .from('inventory_items')
      .select('id, sku')
      .eq('status', 'LISTED')
      .eq('listing_platform', 'ebay')
      .is('ebay_listing_id', null);

    if (!items || items.length === 0) return 0;

    let updated = 0;
    for (const item of items) {
      if (!item.sku) continue;

      const { data: listing } = await supabase
        .from('platform_listings')
        .select('platform_item_id')
        .eq('platform', 'ebay')
        .eq('listing_status', 'Active')
        .ilike('platform_sku', `${item.sku}%`)
        .limit(1)
        .single();

      if (listing?.platform_item_id) {
        await supabase
          .from('inventory_items')
          .update({ ebay_listing_id: listing.platform_item_id })
          .eq('id', item.id);
        updated++;
      }
    }

    return updated;
  }

  return typeof data === 'number' ? data : 0;
}
