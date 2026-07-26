import * as path from 'path';
import { chromium } from 'playwright';

const PORT = process.argv[2] ?? '3011';
const SET = process.argv[3] ?? '71741';
const OUT = path.resolve(__dirname, `../.playwright/setlookup-${SET}`);

(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      storageState: path.resolve(__dirname, '../.playwright/.auth/user.json'),
      viewport: { width: 1500, height: 1600 },
    });
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 200)); });
    await page.goto(`http://localhost:${PORT}/set-lookup`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForTimeout(20000);
    console.log('url:', page.url(), '| title:', await page.title());
    await page.screenshot({ path: `${OUT}-preload.png` });
    const input = page.locator('input[type="text"], input:not([type])').first();
    await input.fill(SET);
    await input.press('Enter');
    await page.waitForTimeout(30000);
    await page.screenshot({ path: `${OUT}-gate.png`, fullPage: true });
    console.log('wrote gate screenshot');
    const runBtn = page.getByRole('button', { name: /run part-out/i });
    if (await runBtn.count()) {
      console.log('GATE SHOWN — button present');
    } else {
      console.log('no gate button (auto-ran or already loaded)');
    }
  } finally {
    await browser.close();
  }
})();
