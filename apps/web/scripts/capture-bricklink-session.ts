/**
 * BrickLink Login Script
 *
 * Launches a visible Chrome browser so the user can log into BrickLink manually.
 * The browser profile is saved to a persistent directory so the scraper can
 * reuse the full session state (cookies, localStorage, fingerprint etc.)
 *
 * Usage:
 *   cd apps/web
 *   npm run bricklink:login
 *
 * Requirements:
 *   - Google Chrome installed
 */

import { chromium } from 'playwright';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync } from 'fs';

const BRICKLINK_URL = 'https://www.bricklink.com/v2/main.page';
const PROFILE_DIR = join(homedir(), '.hadley-bricks', 'bricklink-profile');
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
    await page.goto(BRICKLINK_URL, { waitUntil: 'domcontentloaded' });
    console.log('Please log in to BrickLink in the browser window. Waiting...');

    const startTime = Date.now();

    while (Date.now() - startTime < TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

      // Check if we're on a logged-in page (not login/register)
      const currentUrl = page.url();
      const isOnLogin =
        currentUrl.includes('/login') ||
        currentUrl.includes('/register') ||
        currentUrl.includes('LoginForm');

      if (isOnLogin) {
        continue;
      }

      // Check for a logged-in indicator in the DOM
      const isLoggedIn = await page.evaluate(() => {
        // BrickLink shows username in the header when logged in
        const userLink = document.querySelector('#id-user-name, .bl-myaccount-link, a[href*="myPage"]');
        return userLink !== null;
      });

      if (isLoggedIn) {
        console.log('Login detected. Session saved to browser profile.');
        console.log('You can now close this window or it will close in 3 seconds.');
        await new Promise((r) => setTimeout(r, 3000));
        await context.close();
        return;
      }
    }

    console.error('Timed out after 5 minutes waiting for BrickLink login. Please try again.');
    await context.close();
    process.exitCode = 1;
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    await context.close();
    process.exitCode = 1;
  }
}

main();
