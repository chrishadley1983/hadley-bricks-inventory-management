import * as path from 'path';
import { chromium } from 'playwright';

const PORT = process.argv[2] ?? '3005';
const OUT = process.argv[3] ?? path.resolve(__dirname, '../.playwright/dashboard');

(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      storageState: path.resolve(__dirname, '../.playwright/.auth/user.json'),
      viewport: { width: 1600, height: 2100 },
    });
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 200)); });
    await page.goto(`http://localhost:${PORT}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(35000);
    console.log('url:', page.url());
    await page.screenshot({ path: `${OUT}-desktop-top.png` });
    console.log('wrote desktop-top');
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUT}-desktop-bottom.png` });
    console.log('wrote desktop-bottom');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.mouse.wheel(0, -3000);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}-mobile-top.png` });
    console.log('wrote mobile-top');
  } finally {
    await browser.close();
  }
})();
