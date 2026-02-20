/**
 * Terapeak Research Scraper
 *
 * Uses Playwright to scrape eBay's Terapeak research tool for sold market data.
 * Requires a Chromium runtime (cannot run on Vercel serverless).
 * Intended for GCP Cloud Function or similar runtime with Playwright support.
 *
 * The research.service.ts falls back to BrickLink when Terapeak is unavailable.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import type { TerapeakResult } from './types';
import { CredentialsRepository } from '@/lib/repositories/credentials.repository';

const TERAPEAK_URL = 'https://www.ebay.co.uk/sh/research';
const MIN_DELAY_MS = 3000;

interface EbaySessionCookies {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
  }>;
}

export class TerapeakSessionExpiredError extends Error {
  constructor() {
    super('eBay Terapeak session expired — redirected to login page');
    this.name = 'TerapeakSessionExpiredError';
  }
}

export class TerapeakScraper {
  private lastRequestTime = 0;

  constructor(
    private supabase: SupabaseClient<Database>,
    private userId: string,
  ) {}

  /**
   * Research a single minifigure on Terapeak.
   * Returns null if no results found.
   * Throws TerapeakSessionExpiredError if session is invalid.
   */
  async research(
    name: string,
    bricklinkId: string,
  ): Promise<TerapeakResult | null> {
    // Lazy import Playwright — only available in runtimes with Chromium
    const { chromium } = await import('playwright');

    // Rate limit: enforce minimum delay between requests (F15)
    await this.enforceRateLimit();

    // Load encrypted session cookies (I6)
    const credentialsRepo = new CredentialsRepository(this.supabase);
    const sessionData =
      await credentialsRepo.getCredentials<EbaySessionCookies>(
        this.userId,
        'ebay-terapeak' as Parameters<typeof credentialsRepo.getCredentials>[1],
      );

    if (!sessionData?.cookies?.length) {
      throw new Error('eBay Terapeak session cookies not configured');
    }

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();

      // Load session cookies (F13)
      await context.addCookies(sessionData.cookies);

      const page = await context.newPage();

      // Navigate to Terapeak (F13)
      const searchQuery = `LEGO ${name} ${bricklinkId}`;
      const url = new URL(TERAPEAK_URL);
      url.searchParams.set('query', searchQuery);
      url.searchParams.set('conditionId', '3000'); // Used condition
      url.searchParams.set('soldItemsFilter', 'true');
      url.searchParams.set('dayRange', '90'); // Last 90 days

      await page.goto(url.toString(), { waitUntil: 'networkidle' });

      // Detect session expiry (E3)
      const currentUrl = page.url();
      if (
        currentUrl.includes('signin.ebay') ||
        currentUrl.includes('login') ||
        !currentUrl.includes('sh/research')
      ) {
        throw new TerapeakSessionExpiredError();
      }

      // Extract sold data (F14)
      const result = await this.extractData(page);
      return result;
    } finally {
      await browser.close();
      this.lastRequestTime = Date.now();
    }
  }

  /**
   * Research a batch of minifigures sequentially.
   * Aborts remaining items on session expiry (E3).
   */
  async researchBatch(
    items: Array<{ name: string; bricklinkId: string }>,
  ): Promise<Map<string, TerapeakResult | null>> {
    const results = new Map<string, TerapeakResult | null>();

    for (const item of items) {
      try {
        const result = await this.research(item.name, item.bricklinkId);
        results.set(item.bricklinkId, result);
      } catch (err) {
        if (err instanceof TerapeakSessionExpiredError) {
          // Abort remaining — session is dead (E3)
          throw err;
        }
        // Non-session errors: mark as null and continue
        results.set(item.bricklinkId, null);
      }
    }

    return results;
  }

  /**
   * Extract market data from Terapeak results page (F14).
   * Filters for Used condition, last 90 days.
   */
  private async extractData(
    page: import('playwright').Page,
  ): Promise<TerapeakResult | null> {
    // Wait for research results to load
    try {
      await page.waitForSelector('[data-testid="research-results"]', {
        timeout: 10000,
      });
    } catch {
      // No results found for this search
      return null;
    }

    // Extract metrics from the Terapeak summary cards
    const data = await page.evaluate(() => {
      const getText = (selector: string): string =>
        document.querySelector(selector)?.textContent?.trim() ?? '';

      const parsePrice = (text: string): number => {
        const match = text.replace(/[£$,]/g, '').match(/[\d.]+/);
        return match ? parseFloat(match[0]) : 0;
      };

      const parseInt_ = (text: string): number => {
        const match = text.replace(/,/g, '').match(/\d+/);
        return match ? parseInt(match[0], 10) : 0;
      };

      const parsePercent = (text: string): number => {
        const match = text.match(/([\d.]+)%/);
        return match ? parseFloat(match[1]) : 0;
      };

      // Terapeak summary selectors (may need updating if eBay changes UI)
      const avgSoldPrice = parsePrice(
        getText('[data-testid="avg-sold-price"]'),
      );
      const minSoldPrice = parsePrice(
        getText('[data-testid="min-sold-price"]'),
      );
      const maxSoldPrice = parsePrice(
        getText('[data-testid="max-sold-price"]'),
      );
      const soldCount = parseInt_(getText('[data-testid="sold-count"]'));
      const activeCount = parseInt_(getText('[data-testid="active-count"]'));
      const sellThroughRate = parsePercent(
        getText('[data-testid="sell-through-rate"]'),
      );
      const avgShipping = parsePrice(
        getText('[data-testid="avg-shipping"]'),
      );

      return {
        avgSoldPrice,
        minSoldPrice,
        maxSoldPrice,
        soldCount,
        activeCount,
        sellThroughRate,
        avgShipping,
      };
    });

    if (data.soldCount === 0) {
      return null;
    }

    return {
      ...data,
      source: 'terapeak' as const,
    };
  }

  /**
   * Enforce minimum delay between Terapeak requests (F15).
   * Minimum 3 seconds between consecutive calls.
   */
  private async enforceRateLimit(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestTime;
    if (elapsed < MIN_DELAY_MS && this.lastRequestTime > 0) {
      await new Promise((r) => setTimeout(r, MIN_DELAY_MS - elapsed));
    }
  }
}
