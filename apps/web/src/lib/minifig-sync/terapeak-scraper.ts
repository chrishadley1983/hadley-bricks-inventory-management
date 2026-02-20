/**
 * Terapeak Research Scraper
 *
 * Uses Playwright to scrape eBay's Terapeak research tool for sold market data.
 * Requires a local Chrome install and a persistent browser profile created by
 * `npm run terapeak:login` (which stores session state that survives eBay's
 * bot detection / captcha checks).
 *
 * The research.service.ts falls back to BrickLink when Terapeak is unavailable.
 */

import { homedir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import type { TerapeakResult } from './types';

const TERAPEAK_URL = 'https://www.ebay.co.uk/sh/research';
const PROFILE_DIR = join(homedir(), '.hadley-bricks', 'terapeak-profile');
const MIN_DELAY_MS = 3000;

export class TerapeakSessionExpiredError extends Error {
  constructor() {
    super('eBay Terapeak session expired — redirected to login page');
    this.name = 'TerapeakSessionExpiredError';
  }
}

export class TerapeakScraper {
  private lastRequestTime = 0;

  /**
   * Research a single minifigure on Terapeak.
   * Returns null if no results found.
   * Throws TerapeakSessionExpiredError if session is invalid.
   */
  async research(
    name: string,
    bricklinkId: string,
  ): Promise<TerapeakResult | null> {
    // Check profile directory exists (created by `npm run terapeak:login`)
    if (!existsSync(PROFILE_DIR)) {
      throw new Error(
        'eBay Terapeak browser profile not found. Run `npm run terapeak:login` first.',
      );
    }

    // Lazy import Playwright — only available in runtimes with Chromium
    const { chromium } = await import('playwright');

    // Rate limit: enforce minimum delay between requests (F15)
    await this.enforceRateLimit();

    // Use the persistent profile that was set up via terapeak:login.
    // This preserves the full browser state (cookies, localStorage, fingerprint)
    // which prevents eBay's captcha/bot detection.
    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: true,
      channel: 'chrome',
      args: ['--disable-blink-features=AutomationControlled'],
    });

    try {
      const page = await context.newPage();

      // Navigate to Terapeak search
      const searchQuery = `LEGO ${name} ${bricklinkId}`;
      const url = new URL(TERAPEAK_URL);
      url.searchParams.set('query', searchQuery);
      url.searchParams.set('conditionId', '3000'); // Used condition
      url.searchParams.set('soldItemsFilter', 'true');
      url.searchParams.set('dayRange', '90'); // Last 90 days

      await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });

      // Wait for any redirects to settle
      await new Promise((r) => setTimeout(r, 2000));

      // Detect session expiry or captcha (E3)
      const currentUrl = page.url();
      if (
        currentUrl.includes('signin.ebay') ||
        currentUrl.includes('login') ||
        currentUrl.includes('captcha') ||
        !currentUrl.includes('sh/research')
      ) {
        throw new TerapeakSessionExpiredError();
      }

      // Extract sold data (F14)
      const result = await this.extractData(page);
      return result;
    } finally {
      await context.close();
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
