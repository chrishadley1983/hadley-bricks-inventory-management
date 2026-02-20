/**
 * Image Sourcing Service
 *
 * Attempts to find up to 4 images per minifigure from multiple sources
 * in priority order:
 *   1. Google Images (up to 2, excluding eBay results)
 *   2. BrickLink catalogue image
 *   3. Rebrickable catalogue image
 *   4. Bricqer stored image
 *
 * Uses persistent Chrome profile + channel:'chrome' for Google Images
 * to avoid bot detection. Gracefully degrades on failure.
 */

import { homedir } from 'os';
import { join } from 'path';
import { RebrickableApiClient } from '@/lib/rebrickable';
import { validateImageDimensions } from './image-processor';
import type { SourcedImage } from './types';

const TARGET_IMAGE_COUNT = 4;
const MAX_GOOGLE_IMAGES = 2;
const PROFILE_DIR = join(homedir(), '.hadley-bricks', 'chrome-profile');

/**
 * Check if a URL contains 'ebay' anywhere (catches all eBay domains).
 */
function isEbayUrl(url: string): boolean {
  return /ebay/i.test(url);
}

export class ImageSourcer {
  constructor(private rebrickableApiKey: string) {}

  /**
   * Source up to 4 images for a minifigure.
   * Returns images in priority order: Google sourced > BrickLink > Rebrickable > Bricqer.
   */
  async sourceImages(
    name: string,
    bricklinkId: string,
    bricqerImageUrl?: string | null,
  ): Promise<SourcedImage[]> {
    const images: SourcedImage[] = [];

    // 1. Google Images (up to 2, excluding eBay)
    if (images.length < TARGET_IMAGE_COUNT) {
      try {
        const sourced = await this.searchGoogleImages(name, bricklinkId);
        for (const img of sourced) {
          if (images.length >= MAX_GOOGLE_IMAGES) break;
          images.push(img);
        }
      } catch (err) {
        console.warn(
          `[ImageSourcer] Google Images search failed for ${bricklinkId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // 2. BrickLink catalogue image (always add)
    if (images.length < TARGET_IMAGE_COUNT) {
      images.push({
        url: `https://img.bricklink.com/ItemImage/MN/0/${bricklinkId}.png`,
        source: 'bricklink',
        type: 'stock',
      });
    }

    // 3. Rebrickable catalogue image
    if (images.length < TARGET_IMAGE_COUNT) {
      try {
        const rebrickableImg = await this.getRebrickableImage(bricklinkId);
        if (rebrickableImg) {
          images.push(rebrickableImg);
        }
      } catch (err) {
        console.warn(
          `[ImageSourcer] Rebrickable lookup failed for ${bricklinkId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // 4. Bricqer stored image
    if (images.length < TARGET_IMAGE_COUNT && bricqerImageUrl) {
      images.push({
        url: bricqerImageUrl,
        source: 'bricqer',
        type: 'original',
      });
    }

    return images.slice(0, TARGET_IMAGE_COUNT);
  }

  /**
   * Search Google Images for non-stock minifigure photos.
   * Uses persistent Chrome profile + channel:'chrome' to avoid bot detection.
   * Excludes eBay results via search query AND URL filtering.
   * Validates images meet minimum 800x800px.
   */
  private async searchGoogleImages(
    name: string,
    bricklinkId: string,
  ): Promise<SourcedImage[]> {
    const { chromium } = await import('playwright');

    const query = `LEGO ${name} ${bricklinkId} minifigure -stock -render -official -site:ebay.com -site:ebay.co.uk`;
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch&tbs=isz:l`;

    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: true,
      channel: 'chrome',
    });
    try {
      const page = await context.newPage();
      await page.goto(searchUrl, { waitUntil: 'networkidle' });

      // Extract image URLs and their source page URLs from search results
      const imageResults = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        const results: Array<{ imgUrl: string; pageUrl: string }> = [];

        for (const anchor of anchors) {
          const img = anchor.querySelector('img[data-src]');
          if (!img) continue;
          const imgUrl = img.getAttribute('data-src');
          const pageUrl = anchor.getAttribute('href') || '';
          if (imgUrl && imgUrl.startsWith('http')) {
            results.push({ imgUrl, pageUrl });
          }
        }

        // Also grab standalone data-src images
        const standaloneImgs = Array.from(document.querySelectorAll('img[data-src]'));
        for (const img of standaloneImgs) {
          const imgUrl = img.getAttribute('data-src');
          if (imgUrl && imgUrl.startsWith('http') && !results.some(r => r.imgUrl === imgUrl)) {
            results.push({ imgUrl, pageUrl: '' });
          }
        }

        return results.slice(0, 15);
      });

      // Filter out eBay URLs (safety net for all eBay domains)
      const nonEbayResults = imageResults.filter(
        (r) => !isEbayUrl(r.imgUrl) && !isEbayUrl(r.pageUrl),
      );

      // Validate dimensions (minimum 800x800)
      const validImages: SourcedImage[] = [];
      for (const { imgUrl } of nonEbayResults) {
        if (validImages.length >= MAX_GOOGLE_IMAGES) break;
        try {
          const validation = await validateImageDimensions(imgUrl);
          if (validation.valid) {
            validImages.push({
              url: imgUrl,
              source: 'google',
              type: 'sourced',
            });
          }
        } catch {
          // Skip invalid images
        }
      }

      return validImages;
    } finally {
      await context.close();
    }
  }

  /**
   * Get catalogue image from Rebrickable API.
   * Queries GET /api/v3/lego/minifigs/{fig_num}/ and uses set_img_url.
   */
  private async getRebrickableImage(
    bricklinkId: string,
  ): Promise<SourcedImage | null> {
    const client = new RebrickableApiClient(this.rebrickableApiKey);

    // Rebrickable uses "fig-XXXXXX" format for minifig numbers
    // BrickLink IDs may be in different format — try as-is first
    const minifig = await client.getMinifig(bricklinkId);

    if (minifig.set_img_url) {
      return {
        url: minifig.set_img_url,
        source: 'rebrickable',
        type: 'stock',
      };
    }

    return null;
  }
}
