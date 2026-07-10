/**
 * sweep-prices.js — CDP price sweep for the retiring-deal-hunt skill.
 *
 * Drives the dedicated CDP Chrome (port 9222) so retailer bot walls
 * (Smyths/Argos/Very/JL) see a real browser. NEVER launches or kills Chrome.
 *
 * Input: JSON file of targets:
 *   [{ "set": "76443-1", "name": "...", "maxBuy": 34.12,
 *      "urls": { "Amazon": "https://...", "Argos": "https://...",
 *                "eBay": "https://www.ebay.co.uk/sch/...",
 *                "BrickLink": "https://www.bricklink.com/catalogPG.asp?S=76443-1" } }]
 *
 * Usage: node sweep-prices.js <targets.json> <results.json>
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require(
  'C:/Users/Chris Hadley/claude-projects/hadley-bricks-inventory-management/node_modules/playwright'
);

const [, , inFile, outFile] = process.argv;
if (!inFile || !outFile) {
  console.error('usage: node sweep-prices.js <targets.json> <results.json>');
  process.exit(1);
}
const targets = JSON.parse(fs.readFileSync(inFile, 'utf8'));

const jitter = (min, max) => min + Math.random() * (max - min);

async function extract(page, site, text) {
  if (/ebay/i.test(site)) {
    return [...text.matchAll(/(LEGO[^£]{10,90}?)£\s?(\d{1,3}(?:\.\d{2})?)/gi)]
      .slice(0, 5)
      .map((m) => ({ price: parseFloat(m[2]), note: m[1].trim().slice(0, 70) }));
  }
  if (/bricklink/i.test(site)) {
    const cur = text.match(/Current Items For Sale[\s\S]{0,400}/i);
    return [{ price: null, note: cur ? cur[0].slice(0, 350) : 'price guide block not found' }];
  }
  const prices = [...text.matchAll(/£\s?(\d{1,3}(?:\.\d{2})?)/g)]
    .map((m) => parseFloat(m[1]))
    .filter((p) => p >= 5 && p <= 600);
  const oos = /out of stock|currently unavailable|sold out|no longer available/i.test(text);
  return [{ price: null, note: `prices seen: ${[...new Set(prices)].slice(0, 8).join(', ')}${oos ? ' [OOS hint]' : ''}` }];
}

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx = browser.contexts()[0];
  const results = [];

  for (const t of targets) {
    const entry = { set: t.set, name: t.name, maxBuy: t.maxBuy, sources: {} };
    for (const [site, url] of Object.entries(t.urls ?? {})) {
      const page = await ctx.newPage();
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
        await page.waitForTimeout(jitter(3000, 5000));
        const text = (await page.innerText('body')).replace(/\s+/g, ' ');
        entry.sources[site] = await extract(page, site, text);
        console.log(`${t.set} ${site}: ${JSON.stringify(entry.sources[site]).slice(0, 160)}`);
      } catch (e) {
        entry.sources[site] = [{ price: null, note: `FAILED: ${e.message.split('\n')[0]}` }];
        console.log(`${t.set} ${site}: FAILED`);
      } finally {
        await page.close();
      }
      await new Promise((r) => setTimeout(r, jitter(1500, 3500))); // gentle pacing
    }
    results.push(entry);
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(`\n[sweep] ${results.length} sets -> ${outFile}`);
  await browser.close();
})();
