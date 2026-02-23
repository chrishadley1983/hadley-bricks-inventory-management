import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import type { ImageResolutionResult } from './types';

/**
 * Resolve images for an inventory item, in priority order:
 * 1. eBay listing photos (own photos)
 * 2. Brickset box art
 * 3. Brave Image Search fallback
 *
 * Returns up to 8 image URLs that Shopify will download and re-host.
 */
export async function resolveImages(
  supabase: SupabaseClient<Database>,
  item: {
    id: string;
    set_number: string | null;
    item_name: string | null;
    ebay_listing_id: string | null;
    listing_platform: string | null;
  }
): Promise<ImageResolutionResult> {
  const images: string[] = [];
  let source: ImageResolutionResult['source'] = 'none';

  // Priority 1: eBay listing photos
  if (item.ebay_listing_id && item.listing_platform === 'ebay') {
    try {
      const ebayImages = await fetchEbayListingImages(supabase, item.ebay_listing_id);
      if (ebayImages.length > 0) {
        images.push(...ebayImages);
        source = 'ebay';
      }
    } catch (err) {
      console.warn(`[Images] Failed to fetch eBay images for ${item.id}:`, err);
    }
  }

  // Priority 2: Brickset box art
  if (item.set_number && item.set_number !== 'NA') {
    try {
      const bricksetUrl = await getBricksetImage(supabase, item.set_number);
      if (bricksetUrl && !images.includes(bricksetUrl)) {
        images.push(bricksetUrl);
        if (source === 'none') source = 'brickset';
      }
    } catch (err) {
      console.warn(`[Images] Failed to fetch Brickset image for ${item.set_number}:`, err);
    }
  }

  // Priority 3: Brave Image Search (if we still have < 2 images)
  if (images.length < 2 && item.set_number && item.set_number !== 'NA') {
    try {
      const braveImages = await searchBraveImages(item, 3 - images.length);
      for (const url of braveImages) {
        if (!images.includes(url)) {
          images.push(url);
        }
      }
      if (source === 'none' && braveImages.length > 0) source = 'brave';
    } catch (err) {
      console.warn(`[Images] Brave search failed for ${item.set_number}:`, err);
    }
  }

  return {
    urls: images.slice(0, 8),
    source,
  };
}

/**
 * Fetch eBay listing images via the eBay Browse API.
 * Uses the existing eBay auth infrastructure.
 */
async function fetchEbayListingImages(
  supabase: SupabaseClient<Database>,
  ebayListingId: string
): Promise<string[]> {
  // Look up cached images from platform_listings first
  const { data: listing } = await supabase
    .from('platform_listings')
    .select('raw_data')
    .eq('platform', 'ebay')
    .eq('platform_item_id', ebayListingId)
    .single();

  if (listing?.raw_data) {
    const raw = listing.raw_data as Record<string, unknown>;
    // eBay API stores images in different formats depending on the API used
    const imageUrls = extractEbayImageUrls(raw);
    if (imageUrls.length > 0) return imageUrls;
  }

  return [];
}

/**
 * Extract image URLs from eBay raw listing data.
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

  return [...new Set(urls)];
}

/**
 * Get box art image URL from brickset_sets table.
 */
async function getBricksetImage(
  supabase: SupabaseClient<Database>,
  setNumber: string
): Promise<string | null> {
  // Try with -1 suffix first (Brickset convention), then without
  const variants = [`${setNumber}-1`, setNumber];

  for (const variant of variants) {
    const { data } = await supabase
      .from('brickset_sets')
      .select('image_url')
      .eq('set_number', variant)
      .limit(1)
      .single();

    if (data?.image_url) return data.image_url;
  }

  return null;
}

/**
 * Search for product images using Brave Search Images API.
 * Falls back gracefully if API key is not configured.
 */
async function searchBraveImages(
  item: { set_number: string | null; item_name: string | null },
  count: number
): Promise<string[]> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) return [];

  const query = `LEGO ${item.set_number || ''} ${item.item_name || ''} box`.trim();
  const url = `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=${count + 2}`;

  const res = await fetch(url, {
    headers: { 'X-Subscription-Token': apiKey },
  });

  if (!res.ok) return [];

  const data = await res.json();
  const results: string[] = [];

  if (Array.isArray(data.results)) {
    for (const result of data.results) {
      if (!result.properties?.url) continue;

      const imgUrl = result.properties.url as string;
      const width = result.properties.width as number;
      const height = result.properties.height as number;

      // Filter: minimum 400x400, prefer known LEGO image domains
      if (width >= 400 && height >= 400) {
        results.push(imgUrl);
      }

      if (results.length >= count) break;
    }
  }

  return results;
}

/**
 * Backfill ebay_listing_id from platform_listings for items missing it.
 * Run once before initial sync.
 */
export async function backfillEbayListingIds(
  supabase: SupabaseClient<Database>
): Promise<number> {
  const { data, error } = await supabase.rpc('backfill_ebay_listing_ids' as never);

  if (error) {
    // Fall back to manual query approach
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
