/**
 * eBay Terapeak Login Script
 *
 * Launches a visible Chrome browser so the user can log into eBay manually.
 * The browser profile is saved to a persistent directory so the scraper can
 * reuse the full session state (cookies, localStorage, fingerprint etc.)
 * which prevents eBay's captcha/bot detection.
 *
 * Usage:
 *   cd apps/web
 *   npm run terapeak:login
 *
 * Requirements:
 *   - Google Chrome installed
 */

import { chromium } from 'playwright';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync } from 'fs';

const TERAPEAK_URL = 'https://www.ebay.co.uk/sh/research';
const PROFILE_DIR = join(homedir(), '.hadley-bricks', 'terapeak-profile');
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL_MS = 2000;

async function main() {
  // Ensure profile directory exists
  mkdirSync(PROFILE_DIR, { recursive: true });

  console.log(`Profile directory: ${PROFILE_DIR}`);
  console.log('Launching Chrome...');

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = context.pages()[0] || (await context.newPage());

  try {
    await page.goto(TERAPEAK_URL, { waitUntil: 'domcontentloaded' });
    console.log('Please log in to eBay in the browser window. Waiting...');

    const startTime = Date.now();

    while (Date.now() - startTime < TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

      const currentUrl = page.url();
      const isOnResearch =
        currentUrl.includes('/sh/research') &&
        !currentUrl.includes('signin') &&
        !currentUrl.includes('login') &&
        !currentUrl.includes('captcha');

      if (isOnResearch) {
        console.log('Login detected. Session saved to browser profile.');
        console.log('You can now close this window or it will close in 3 seconds.');
        await new Promise((r) => setTimeout(r, 3000));
        await context.close();
        process.exit(0);
      }
    }

    console.error('Timed out after 5 minutes waiting for eBay login. Please try again.');
    await context.close();
    process.exit(1);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    await context.close();
    process.exit(1);
  }
}

main();
