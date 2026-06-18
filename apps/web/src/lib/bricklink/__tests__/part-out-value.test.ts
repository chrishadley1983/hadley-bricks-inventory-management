import { describe, it, expect } from 'vitest';
import {
  buildPovUrl,
  parsePovHtml,
  classifyPovPage,
  parseSetNumber,
  resolvePovOptions,
  isValidSetNumber,
  toGbp,
  type PovScrapeResult,
} from '../part-out-value';
import { buildPovCacheRow } from '../part-out-value-cache.service';

// Real rendered innerText captured from catalogPOV.asp for set 77075 (logged-in, GBP).
const GBP_FIXTURE =
  "Price Guide: Part Out Value 77075 Peely & Sparkplug's Camp * " +
  'Average of last 6 months Sales: GBP 25.65 Including 241 Items in 126 Lots. ' +
  'Current Items For Sale Average: GBP 30.77 Including 241 Items in 126 Lots. ' +
  'My Inventory Average: GBP 2.59 Including 59 Items in 30 Lots. Not Included 182 Items in 96 Lots. ' +
  'window.initBLPFooter();';

// Real rendered innerText captured logged-out (incognito, USD, no My Inventory column).
const USD_FIXTURE =
  "Price Guide: Part Out Value 77075 Peely & Sparkplug's Camp * " +
  'Average of last 6 months Sales: US $34.63 Including 241 Items in 126 Lots. ' +
  'Current Items For Sale Average: US $41.12 Including 241 Items in 126 Lots.';

const NON_POV_FIXTURE = 'BrickLink - Sign In. Please log in to continue. Email Address Password';

describe('parsePovHtml', () => {
  it('parses the logged-in GBP page exactly', () => {
    const r = parsePovHtml(GBP_FIXTURE);
    expect(r.isPovPage).toBe(true);
    expect(r.setName).toBe("77075 Peely & Sparkplug's Camp");
    expect(r.nativeCurrency).toBe('GBP');
    expect(r.sold6mo).toEqual({ amount: 25.65, items: 241, lots: 126 });
    expect(r.forSale).toEqual({ amount: 30.77, items: 241, lots: 126 });
    expect(r.myInv).toEqual({ amount: 2.59, items: 59, lots: 30 });
    expect(r.notIncluded).toEqual({ items: 182, lots: 96 });
  });

  it('parses the logged-out USD page (no My Inventory column)', () => {
    const r = parsePovHtml(USD_FIXTURE);
    expect(r.isPovPage).toBe(true);
    expect(r.nativeCurrency).toBe('USD');
    expect(r.sold6mo).toEqual({ amount: 34.63, items: 241, lots: 126 });
    expect(r.forSale).toEqual({ amount: 41.12, items: 241, lots: 126 });
    expect(r.myInv).toBeNull();
  });

  it('parses raw HTML (with tags + entities), not just innerText', () => {
    const html =
      '<b>Part Out Value 77075 Peely &amp; Sparkplug&#39;s Camp</b> * ' +
      '<td>Average of last 6 months Sales:</td><td>GBP&nbsp;25.65</td> Including 241 Items in 126 Lots.';
    const r = parsePovHtml(html);
    expect(r.isPovPage).toBe(true);
    expect(r.sold6mo?.amount).toBe(25.65);
  });

  it('returns a null-shaped result (no throw) on a non-POV / login page', () => {
    const r = parsePovHtml(NON_POV_FIXTURE);
    expect(r.isPovPage).toBe(false);
    expect(r.sold6mo).toBeNull();
    expect(r.forSale).toBeNull();
    expect(r.nativeCurrency).toBeNull();
  });

  it('does NOT bleed the for-sale figure into sold when a set has no 6-month sales', () => {
    // Regression for the section-bleed bug: sold6mo must be null, not the for-sale price.
    const noSales =
      "Price Guide: Part Out Value 12345 Brand New Set * " +
      'Average of last 6 months Sales: No sales in the past 6 months. ' +
      'Current Items For Sale Average: GBP 30.77 Including 5 Items in 3 Lots.';
    const r = parsePovHtml(noSales);
    expect(r.isPovPage).toBe(true);
    expect(r.sold6mo).toBeNull(); // must NOT be 30.77
    expect(r.forSale).toEqual({ amount: 30.77, items: 5, lots: 3 });
    expect(r.nativeCurrency).toBe('GBP');
  });

  it('parses a whole-number (no decimals) value', () => {
    const r = parsePovHtml(
      'Part Out Value 999 Tiny Set * Average of last 6 months Sales: GBP 35 Including 10 Items in 5 Lots. ' +
        'Current Items For Sale Average: GBP 40 Including 10 Items in 5 Lots.',
    );
    expect(r.sold6mo?.amount).toBe(35);
    expect(r.forSale?.amount).toBe(40);
  });
});

function fakeResult(over: Partial<PovScrapeResult> = {}): PovScrapeResult {
  return {
    options: resolvePovOptions({ setNumber: '77075' }),
    setName: '77075 Test Set',
    nativeCurrency: 'GBP',
    sold6mo: { amount: 25.65, items: 241, lots: 126 },
    forSale: { amount: 30.77, items: 241, lots: 126 },
    myInv: null,
    notIncluded: null,
    finalUrl: 'https://www.bricklink.com/catalogPOV.asp',
    ...over,
  };
}

describe('buildPovCacheRow', () => {
  it('passes GBP straight through and attaches retail', () => {
    const row = buildPovCacheRow(fakeResult(), { ukRetailGbp: 17.99, retailSource: 'brickset_sets' });
    expect(row.native_currency).toBe('GBP');
    expect(row.sold_6mo_native).toBe(25.65);
    expect(row.sold_6mo_avg_gbp).toBe(25.65);
    expect(row.usd_to_gbp_rate).toBeNull();
    expect(row.uk_retail_gbp).toBe(17.99);
    // partout_multiple is a generated DB column — must NOT be in the insert row.
    expect('partout_multiple' in row).toBe(false);
  });

  it('converts USD to GBP with a rate', () => {
    const row = buildPovCacheRow(fakeResult({ nativeCurrency: 'USD', sold6mo: { amount: 34.63, items: 1, lots: 1 } }), {
      usdToGbpRate: 0.74,
    });
    expect(row.native_currency).toBe('USD');
    expect(row.sold_6mo_native).toBe(34.63);
    expect(row.sold_6mo_avg_gbp).toBeCloseTo(25.63, 2);
    expect(row.usd_to_gbp_rate).toBe(0.74);
  });

  it('leaves GBP null for USD without a rate', () => {
    const row = buildPovCacheRow(fakeResult({ nativeCurrency: 'USD' }), {});
    expect(row.sold_6mo_avg_gbp).toBeNull();
    expect(row.for_sale_avg_gbp).toBeNull();
  });

  it('maps a no-sold result to null sold fields', () => {
    const row = buildPovCacheRow(fakeResult({ sold6mo: null }), { ukRetailGbp: 10 });
    expect(row.sold_6mo_native).toBeNull();
    expect(row.sold_6mo_avg_gbp).toBeNull();
    expect(row.for_sale_native).toBe(30.77);
  });
});

describe('isValidSetNumber', () => {
  it('accepts real set numbers', () => {
    expect(isValidSetNumber('77075')).toBe(true);
    expect(isValidSetNumber('77075-1')).toBe(true);
    expect(isValidSetNumber('10333-2')).toBe(true);
  });
  it('rejects LIKE metacharacters and junk', () => {
    expect(isValidSetNumber('12%')).toBe(false);
    expect(isValidSetNumber('a_b')).toBe(false);
    expect(isValidSetNumber('')).toBe(false);
    expect(isValidSetNumber('77075; drop')).toBe(false);
  });
});

describe('classifyPovPage', () => {
  const POV_URL = 'https://www.bricklink.com/catalogPOV.asp?itemType=S&itemNo=77075&itemSeq=1';

  it('marks a valid POV page with data as ok', () => {
    expect(classifyPovPage(POV_URL, GBP_FIXTURE).kind).toBe('ok');
    expect(classifyPovPage(POV_URL, USD_FIXTURE).kind).toBe('ok');
  });

  it('treats a price-guide bounce (catalogPG.asp) as notPartable — NOT a block', () => {
    // The exact false-negative bug: BL bounces non-partable items (e.g. individual CMF figs) here.
    expect(classifyPovPage('https://www.bricklink.com/catalogPG.asp?err=2', '<html>price guide error</html>').kind).toBe('notPartable');
    expect(classifyPovPage('https://www.bricklink.com/catalogPG.asp?err=3', 'whatever content').kind).toBe('notPartable');
  });

  it('treats a throttle (oops.asp / err=403 / empty) as a block — NOT no-data', () => {
    expect(classifyPovPage('https://www.bricklink.com/oops.asp?err=403', '').kind).toBe('block');
    expect(classifyPovPage('https://www.bricklink.com/catalogPOV.asp?itemNo=1&err=403', 'blocked').kind).toBe('block');
    expect(classifyPovPage(POV_URL, '').kind).toBe('block'); // empty body
  });

  it('detects captcha and login', () => {
    expect(classifyPovPage(POV_URL, 'Please verify you are a human to continue').kind).toBe('captcha');
    expect(classifyPovPage('https://www.bricklink.com/login.asp', 'Please log in — Email Address Password').kind).toBe('login');
  });

  it('returns noData for a valid POV shell with no sales (genuine no-data)', () => {
    const noSales =
      "Price Guide: Part Out Value 12345 Brand New Set * Average of last 6 months Sales: No sales in the past 6 months.";
    expect(classifyPovPage(POV_URL, noSales).kind).toBe('noData');
  });

  it('returns nonPov for an unexpected page (retried by the scraper, never marked no-data)', () => {
    expect(classifyPovPage(POV_URL, 'Some unrelated content with no part out header and no block markers').kind).toBe('nonPov');
  });
});

describe('buildPovUrl', () => {
  it('builds the known-good URL for default options', () => {
    const url = buildPovUrl(resolvePovOptions({ setNumber: '77075' }));
    expect(url).toBe(
      'https://www.bricklink.com/catalogPOV.asp?itemType=S&itemNo=77075&itemSeq=1&itemQty=1' +
        '&breakType=M&itemCondition=N&incInstr=Y&incBox=N&incExtra=N&incBreak=N',
    );
  });

  it('reflects condition + include overrides', () => {
    const url = buildPovUrl(
      resolvePovOptions({ setNumber: '10333', condition: 'U', incInstructions: false, incBox: true }),
    );
    expect(url).toContain('itemNo=10333');
    expect(url).toContain('itemCondition=U');
    expect(url).toContain('incInstr=N');
    expect(url).toContain('incBox=Y');
  });
});

describe('parseSetNumber', () => {
  it('splits a Brickset-style number', () => {
    expect(parseSetNumber('77075-1')).toEqual({ itemNo: '77075', itemSeq: 1 });
    expect(parseSetNumber('10333-2')).toEqual({ itemNo: '10333', itemSeq: 2 });
  });
  it('defaults seq to 1 when no suffix', () => {
    expect(parseSetNumber('77075')).toEqual({ itemNo: '77075', itemSeq: 1 });
  });
});

describe('toGbp', () => {
  it('passes GBP through', () => {
    expect(toGbp(25.65, 'GBP')).toBe(25.65);
  });
  it('converts USD with a rate', () => {
    expect(toGbp(34.63, 'USD', 0.74)).toBeCloseTo(25.63, 2);
  });
  it('returns null for USD without a rate', () => {
    expect(toGbp(34.63, 'USD')).toBeNull();
    expect(toGbp(34.63, 'USD', null)).toBeNull();
  });
  it('returns null for unknown currency or null amount', () => {
    expect(toGbp(10, 'EUR', 0.9)).toBeNull();
    expect(toGbp(null, 'GBP')).toBeNull();
  });
});
