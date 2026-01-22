# Vinted Broad Sweep Scan

You are automating a Vinted LEGO search to find arbitrage opportunities. Follow these steps exactly.

## Pre-flight

1. Wait 3-10 seconds (random) before starting - this mimics human behaviour
2. Verify the browser is ready

## Navigation

1. Navigate to: `https://www.vinted.co.uk/catalog?search_text=lego&status_ids[]=6&order=newest_first`
   - This searches for "lego" with "New with tags" filter, sorted by newest
2. Wait for the page to fully load (DOM ready)
3. Wait 3-10 seconds (random dwell time) to mimic reading

## CAPTCHA Detection (CRITICAL)

Check for CAPTCHA immediately after navigation. If ANY of these are true, STOP and report captcha:

1. **URL Check**: Current URL contains "captcha" or "captcha-delivery"
2. **DOM Check**: Page contains:
   - `iframe[src*="captcha"]`
   - Elements with class containing "datadome"
   - `#px-captcha` or `#challenge-running`
3. **Title Check**: Page title contains "blocked", "captcha", "security", or "challenge"

If CAPTCHA detected, immediately return:
```json
{
  "captchaDetected": true,
  "pagesScanned": 0,
  "listings": []
}
```

## Page Interaction (Appear Human)

1. Scroll down slowly 2-4 times:
   - Scroll 500-800px each time
   - Wait 500-1500ms between scrolls
2. With 10% probability (random), toggle a filter:
   - Click on size/condition filter
   - Wait 1-2 seconds
   - Click again to reset

## Data Extraction

Extract all visible listing cards from the page. For each listing:

```javascript
// Example extraction (adapt selectors as needed)
const listings = [];
const cards = document.querySelectorAll('.feed-grid__item');

for (const card of cards) {
  // Find the link element
  const linkEl = card.querySelector('a[href^="/items/"]');
  if (!linkEl) continue;

  // Extract title from image alt or text content
  const imgEl = card.querySelector('img');
  const titleText = imgEl?.alt || card.textContent || '';

  // IMPORTANT: Extract the INCLUSIVE price (includes Buyer Protection fee)
  // Vinted shows two prices on cards:
  //   1. Base price (muted/greyed) - has class "web_ui__Text__muted" or data-testid ending in "--price-text"
  //   2. Inclusive price (bold) - has class "web_ui__Text__subtitle", this is what buyers actually pay
  // We need the INCLUSIVE price for accurate COG% calculations

  // Method 1: Find the subtitle price element (inclusive price)
  const inclusivePriceEl = card.querySelector('.web_ui__Text__subtitle');
  let price = null;

  if (inclusivePriceEl) {
    const priceMatch = inclusivePriceEl.textContent?.match(/£(\d+(?:\.\d{2})?)/);
    if (priceMatch) {
      price = parseFloat(priceMatch[1]);
    }
  }

  // Method 2: Fallback - get all prices and take the LAST one (usually the inclusive price)
  if (!price) {
    const allPrices = card.textContent?.match(/£(\d+(?:\.\d{2})?)/g) || [];
    if (allPrices.length > 0) {
      // Take the last price found - typically the inclusive price
      const lastPriceMatch = allPrices[allPrices.length - 1].match(/£(\d+(?:\.\d{2})?)/);
      if (lastPriceMatch) {
        price = parseFloat(lastPriceMatch[1]);
      }
    }
  }

  if (!price) continue;

  listings.push({
    title: titleText.trim(),
    price: price,
    url: 'https://www.vinted.co.uk' + linkEl.getAttribute('href')
  });
}
```

Key extraction patterns to find:
- Title: From `img[alt*="brand: LEGO"]` or item card text
- **Price**: Extract the INCLUSIVE price (with Buyer Protection), NOT the base price
  - Look for `.web_ui__Text__subtitle` element (inclusive price)
  - Avoid `.web_ui__Text__muted` element (base price - greyed out)
  - If multiple prices found, the inclusive price is typically the second/last one
- URL: From `a[href^="/items/"]` element

## Pagination (1-3 pages, random)

1. Randomly decide: scan 1, 2, or 3 pages
2. If scanning more pages:
   - Look for pagination/load more button
   - Click next page
   - Wait 3-8 seconds (random)
   - Re-check for CAPTCHA
   - Repeat extraction

## Final Dwell

Wait 2-5 seconds before completing (random).

## Output Format

Return valid JSON to stdout:

```json
{
  "captchaDetected": false,
  "pagesScanned": 2,
  "listings": [
    {
      "title": "LEGO Star Wars 75192 Millennium Falcon NEW SEALED",
      "price": 450.00,
      "url": "https://www.vinted.co.uk/items/123456-lego-star-wars"
    },
    {
      "title": "LEGO Technic 42156 Peugeot New",
      "price": 120.00,
      "url": "https://www.vinted.co.uk/items/789012-lego-technic"
    }
  ]
}
```

## CRITICAL Safety Rules

1. **Never rush** - always include random delays between actions
2. **Stop immediately** if anything looks suspicious (unusual popups, redirects)
3. **Maximum 3 pages** per scan - don't be greedy
4. **Only extract visible data** - don't try to expand or load more aggressively
5. **Respect the site** - this is for personal arbitrage hunting, not scraping
