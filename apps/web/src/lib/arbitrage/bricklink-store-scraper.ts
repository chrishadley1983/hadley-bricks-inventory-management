/**
 * BrickLink Store Listing Scraper
 *
 * Uses Playwright to scrape BrickLink's "For Sale" catalog pages for per-store
 * listing data (store name, price, quantity, country, min buy, feedback, ships-to-UK).
 *
 * Requires a local Chrome install and a persistent browser profile created by
 * `npm run bricklink:login` (which stores session state).
 *
 * The scraper navigates to the v2 catalog page with UK + New filters and extracts
 * the listing table rows.
 */

import { homedir } from 'os';
import { join } from 'path';
import { existsSync, chmodSync } from 'fs';

const PROFILE_DIR = join(homedir(), '.hadley-bricks', 'bricklink-profile');
const MIN_DELAY_MS = 5000; // 5s between requests (conservative for BrickLink)

export class BrickLinkSessionExpiredError extends Error {
  constructor() {
    super('BrickLink session expired — redirected to login page');
    this.name = 'BrickLinkSessionExpiredError';
  }
}

export interface StoreListingRow {
  storeName: string;
  storeCountry: string | null;
  storeFeedback: number | null;
  unitPrice: number;
  quantity: number;
  minBuy: number | null;
  shipsToUk: boolean | null;
  condition: string;
  currencyCode: string;
}

export class BrickLinkStoreScraper {
  private lastRequestTime = 0;

  /**
   * Scrape store listings for a single set from BrickLink's "For Sale" tab.
   * Returns an array of per-store listings sorted by price ascending.
   * Throws BrickLinkSessionExpiredError if session is invalid.
   */
  async scrapeListings(setNumber: string): Promise<StoreListingRow[]> {
    if (!existsSync(PROFILE_DIR)) {
      throw new Error(
        'BrickLink browser profile not found. Run `npm run bricklink:login` first.'
      );
    }

    // Restrict profile directory permissions (owner-only) to protect session cookies
    try { chmodSync(PROFILE_DIR, 0o700); } catch { /* Windows ignores chmod */ }

    const { chromium } = await import('playwright');

    await this.enforceRateLimit();

    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: true,
      channel: 'chrome',
      args: ['--disable-blink-features=AutomationControlled'],
    });

    try {
      const page = await context.newPage();
      const listings = await this.scrapeSetPage(page, setNumber);
      return listings;
    } finally {
      await context.close();
      this.lastRequestTime = Date.now();
    }
  }

  /**
   * Scrape listings for a batch of sets sequentially, reusing a single
   * browser context across all sets to avoid launch/close overhead.
   * Aborts remaining items on session expiry.
   */
  async scrapeBatch(
    setNumbers: string[],
    onProgress?: (processed: number, total: number) => void
  ): Promise<Map<string, StoreListingRow[]>> {
    if (!existsSync(PROFILE_DIR)) {
      throw new Error(
        'BrickLink browser profile not found. Run `npm run bricklink:login` first.'
      );
    }

    try { chmodSync(PROFILE_DIR, 0o700); } catch { /* Windows ignores chmod */ }

    const { chromium } = await import('playwright');
    const results = new Map<string, StoreListingRow[]>();

    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: true,
      channel: 'chrome',
      args: ['--disable-blink-features=AutomationControlled'],
    });

    try {
      const page = await context.newPage();

      for (let i = 0; i < setNumbers.length; i++) {
        const setNumber = setNumbers[i];
        try {
          await this.enforceRateLimit();
          const listings = await this.scrapeSetPage(page, setNumber);
          results.set(setNumber, listings);
          this.lastRequestTime = Date.now();
        } catch (err) {
          if (err instanceof BrickLinkSessionExpiredError) {
            throw err;
          }
          // Non-session errors: mark as empty and continue
          console.error(
            `[BrickLinkStoreScraper.scrapeBatch] Error scraping ${setNumber}:`,
            err instanceof Error ? err.message : err
          );
          results.set(setNumber, []);
        }

        onProgress?.(i + 1, setNumbers.length);
      }
    } finally {
      await context.close();
    }

    return results;
  }

  /**
   * Scrape a single set page using an already-open browser page.
   * Navigates, waits for content, and extracts listings.
   */
  private async scrapeSetPage(
    page: import('playwright').Page,
    setNumber: string
  ): Promise<StoreListingRow[]> {
    // Build the catalog URL with New condition + UK seller filters
    const filters = JSON.stringify({ cond: 'N', loc: 'UK' });
    const url = `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${encodeURIComponent(setNumber)}#T=S&O=${encodeURIComponent(filters)}`;

    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // Wait for page to settle (SPA routing)
    await new Promise((r) => setTimeout(r, 3000));

    // Detect session expiry
    const currentUrl = page.url();
    if (
      currentUrl.includes('/login') ||
      currentUrl.includes('LoginForm') ||
      currentUrl.includes('/register')
    ) {
      throw new BrickLinkSessionExpiredError();
    }

    // Wait for the "For Sale" listing table to render
    try {
      await page.waitForSelector('#_idTabContentsS', { timeout: 15000 });
    } catch {
      // Tab content may not exist if no items for sale
      return [];
    }

    // Give extra time for the listing data to load within the tab
    await new Promise((r) => setTimeout(r, 2000));

    return this.extractListings(page);
  }

  /**
   * Extract store listing rows from the BrickLink catalog "For Sale" tab.
   *
   * The v2 catalog page renders listings in a table within #_idTabContentsS.
   * Each row contains: store name, price, quantity, country, min buy, feedback.
   */
  private async extractListings(
    page: import('playwright').Page
  ): Promise<StoreListingRow[]> {
    const data = await page.evaluate(() => {
      const rows: Array<{
        storeName: string;
        storeCountry: string | null;
        storeFeedback: number | null;
        unitPrice: number;
        quantity: number;
        minBuy: number | null;
        shipsToUk: boolean | null;
        currencyCode: string;
      }> = [];

      // BrickLink v2 catalog page renders "For Sale" listings in a table
      // within the #_idTabContentsS container. The structure varies but
      // typically has rows with store info, price, and quantity cells.

      // Strategy: find the listing table rows within the For Sale tab
      const tabContent = document.querySelector('#_idTabContentsS');
      if (!tabContent) return rows;

      // Look for the item table - BrickLink uses various table structures
      // The main listing table contains rows with class patterns
      const tableRows = tabContent.querySelectorAll('table.fv tr');

      // If no structured table found, try the alternative layout
      const allRows =
        tableRows.length > 0
          ? tableRows
          : tabContent.querySelectorAll('[id^="itemTableRow"]');

      for (const row of allRows) {
        try {
          // Extract store name - typically in a link
          const storeLink = row.querySelector('a[href*="store.asp"], a[href*="v2/splash"]');
          if (!storeLink) continue; // Skip header/separator rows

          const storeName = storeLink.textContent?.trim() ?? '';
          if (!storeName) continue;

          // Extract country from flag image or text
          const flagImg = row.querySelector('img[src*="flag"], img[title*="country"]');
          const storeCountry = flagImg?.getAttribute('title')?.trim() ?? null;

          // Extract feedback - look for percentage pattern
          const feedbackEl = row.querySelector('.fv-feedback, [title*="feedback"]');
          let storeFeedback: number | null = null;
          if (feedbackEl) {
            const fbMatch = feedbackEl.textContent?.match(/([\d.]+)%/);
            if (fbMatch) storeFeedback = parseFloat(fbMatch[1]);
          }

          // Extract price - target the "Each" price column specifically.
          // BrickLink tables typically have columns: Store | Qty | Each | ...
          // We look for cells containing a currency symbol and pick the first
          // one that looks like a unit price (has currency + number format).
          const cells = row.querySelectorAll('td');
          let unitPrice = 0;
          let currencyCode = 'GBP';
          let priceColumnIndex = -1;

          for (let ci = 0; ci < cells.length; ci++) {
            const text = cells[ci].textContent?.trim() ?? '';
            // Match price patterns like "£142.50", "GBP 142.50", "$150.00"
            const priceMatch = text.match(/[£$€]\s*([\d,]+\.?\d*)/);
            if (priceMatch) {
              unitPrice = parseFloat(priceMatch[1].replace(/,/g, ''));
              if (text.includes('$')) currencyCode = 'USD';
              else if (text.includes('€')) currencyCode = 'EUR';
              else currencyCode = 'GBP';
              priceColumnIndex = ci;
              break;
            }
            // Also match "GBP 142.50", "USD 150.00", "EUR 120.00"
            const codedPriceMatch = text.match(/(GBP|USD|EUR)\s*([\d,]+\.?\d*)/);
            if (codedPriceMatch) {
              currencyCode = codedPriceMatch[1];
              unitPrice = parseFloat(codedPriceMatch[2].replace(/,/g, ''));
              priceColumnIndex = ci;
              break;
            }
          }

          if (unitPrice === 0) continue; // Skip rows without a valid price

          // Extract quantity - look for a numeric-only cell BEFORE the price column
          // (BrickLink typically has Qty before Each price)
          let quantity = 1;
          for (let ci = 0; ci < cells.length; ci++) {
            if (ci === priceColumnIndex) continue; // Skip the price cell
            const text = cells[ci].textContent?.trim() ?? '';
            const qtyMatch = text.match(/^(\d+)$/);
            if (qtyMatch) {
              const val = parseInt(qtyMatch[1]);
              if (val > 0 && val < 10000) {
                quantity = val;
                break; // Take the first numeric-only cell (usually Qty)
              }
            }
          }

          // Extract minimum buy
          let minBuy: number | null = null;
          const minBuyEl = row.querySelector('[title*="minimum"], .min-buy');
          if (minBuyEl) {
            const minMatch = minBuyEl.textContent?.match(/([\d.]+)/);
            if (minMatch) minBuy = parseFloat(minMatch[1]);
          }
          // Also check for "Min Buy:" text pattern
          const rowText = row.textContent ?? '';
          const minBuyMatch = rowText.match(/Min\s*Buy[:\s]*[£$€]?\s*([\d,.]+)/i);
          if (minBuyMatch && !minBuy) {
            minBuy = parseFloat(minBuyMatch[1].replace(/,/g, ''));
          }

          // Ships to UK indicator - check class names and data attributes
          // rather than computed styles (which return rgb() values)
          let shipsToUk: boolean | null = null;
          const shipIndicator = row.querySelector(
            '.ship-indicator, [title*="ship"], [data-ship]'
          );
          if (shipIndicator) {
            // Check for explicit class-based indicators
            if (
              shipIndicator.classList.contains('ship-yes') ||
              shipIndicator.classList.contains('ship-ok') ||
              shipIndicator.getAttribute('title')?.toLowerCase().includes('ships to')
            ) {
              shipsToUk = true;
            } else if (
              shipIndicator.classList.contains('ship-no') ||
              shipIndicator.getAttribute('title')?.toLowerCase().includes('does not ship')
            ) {
              shipsToUk = false;
            }
          }
          // Fallback: look for green/red color in inline styles or class names
          if (shipsToUk === null) {
            const greenIndicator = row.querySelector(
              '[style*="green"], .text-green, .bg-green, [style*="#00"], [style*="rgb(0"]'
            );
            const redIndicator = row.querySelector(
              '[style*="red"], .text-red, .bg-red'
            );
            if (greenIndicator) shipsToUk = true;
            else if (redIndicator) shipsToUk = false;
          }

          rows.push({
            storeName,
            storeCountry,
            storeFeedback,
            unitPrice,
            quantity,
            minBuy,
            shipsToUk,
            currencyCode,
          });
        } catch {
          // Skip malformed rows
          continue;
        }
      }

      return rows;
    });

    // Sort by price ascending
    return data
      .map((d) => ({
        ...d,
        condition: 'N' as const,
      }))
      .sort((a, b) => a.unitPrice - b.unitPrice);
  }

  /**
   * Enforce minimum delay between BrickLink requests.
   * 5 seconds between consecutive calls.
   */
  private async enforceRateLimit(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestTime;
    if (elapsed < MIN_DELAY_MS && this.lastRequestTime > 0) {
      await new Promise((r) => setTimeout(r, MIN_DELAY_MS - elapsed));
    }
  }
}
