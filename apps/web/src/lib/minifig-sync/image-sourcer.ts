/**
 * Image Sourcing Service (F26-F30, E5)
 *
 * Attempts to find up to 3 images per minifigure from multiple sources
 * in priority order:
 *   1. Non-stock sourced images via Google Images (Playwright)
 *   2. Rebrickable catalogue image
 *   3. BrickLink catalogue image
 *   4. Bricqer stored image
 *
 * Gracefully degrades — if Google Images fails (E5), continues to
 * catalogue fallbacks without erroring.
 */

import { RebrickableApiClient } from '@/lib/rebrickable';
import { validateImageDimensions } from './image-processor';
import type { SourcedImage } from './types';

const TARGET_IMAGE_COUNT = 3;

export class ImageSourcer {
  constructor(private rebrickableApiKey: string) {}

  /**
   * Source up to 3 images for a minifigure.
   * Returns images in priority order: sourced > catalogue > original.
   */
  async sourceImages(
    name: string,
    bricklinkId: string,
    bricqerImageUrl?: string | null,
  ): Promise<SourcedImage[]> {
    const images: SourcedImage[] = [];

    // 1. Non-stock via Google Images search (F28)
    if (images.length < TARGET_IMAGE_COUNT) {
      try {
        const sourced = await this.searchGoogleImages(name, bricklinkId);
        for (const img of sourced) {
          if (images.length >= TARGET_IMAGE_COUNT) break;
          images.push(img);
        }
      } catch (err) {
        // E5: Continue to fallback sources on failure
        console.warn(
          `[ImageSourcer] Google Images search failed for ${bricklinkId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // 2. Rebrickable catalogue image (F29)
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

    // 3. BrickLink catalogue image (F30)
    if (images.length < TARGET_IMAGE_COUNT) {
      images.push({
        url: `https://img.bricklink.com/ItemImage/MN/0/${bricklinkId}.png`,
        source: 'bricklink',
        type: 'stock',
      });
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
   * Search Google Images for non-stock minifigure photos (F28).
   * Requires Playwright — only works in runtimes with Chromium.
   * Validates images meet minimum 800x800px (F31).
   */
  private async searchGoogleImages(
    name: string,
    bricklinkId: string,
  ): Promise<SourcedImage[]> {
    const { chromium } = await import('playwright');

    const query = `LEGO ${name} ${bricklinkId} minifigure -stock -render -official`;
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch&tbs=isz:l`;

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(searchUrl, { waitUntil: 'networkidle' });

      // Extract image URLs from search results
      const imageUrls = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('img[data-src]'));
        return imgs
          .map((img) => img.getAttribute('data-src'))
          .filter((src): src is string => !!src && src.startsWith('http'))
          .slice(0, 10);
      });

      // Validate dimensions (F31: minimum 800x800)
      const validImages: SourcedImage[] = [];
      for (const url of imageUrls) {
        if (validImages.length >= TARGET_IMAGE_COUNT) break;
        try {
          const validation = await validateImageDimensions(url);
          if (validation.valid) {
            validImages.push({
              url,
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
      await browser.close();
    }
  }

  /**
   * Get catalogue image from Rebrickable API (F29).
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
