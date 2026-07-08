import { describe, it, expect } from 'vitest';
import {
  parsePgSummarySnippet,
  resolvePgItemId,
  buildPgSummaryUrl,
  toSummaryCacheRow,
  validateCurrencyBasis,
  ALIAS_MAP,
  type PgSummaryQuads,
} from '../pg-summary';

// ---------------------------------------------------------------------------
// parsePgSummarySnippet
// ---------------------------------------------------------------------------

describe('parsePgSummarySnippet', () => {
  it('parses a full 4-quadrant snippet (Past 6 Months Sales + Current Items, New/Used each)', () => {
    const html = `
      <table>
        <tr><td colspan="2">Past 6 Months Sales</td></tr>
        <tr><td>New:</td><td>12</td><td>34</td><td>0.05</td><td>0.08</td><td>0.09</td><td>0.15</td></tr>
        <tr><td>Used:</td><td>3</td><td>5</td><td>0.02</td><td>0.03</td><td>0.03</td><td>0.04</td></tr>
        <tr><td colspan="2">Current Items For Sale</td></tr>
        <tr><td>New:</td><td>20</td><td>50</td><td>0.06</td><td>0.10</td><td>0.11</td><td>0.20</td></tr>
        <tr><td>Used:</td><td>7</td><td>9</td><td>0.01</td><td>0.02</td><td>0.02</td><td>0.03</td></tr>
      </table>
    `;
    const quads = parsePgSummarySnippet(html);
    expect(quads).not.toBeNull();
    expect(quads!.soldN).toEqual({ lots: 12, qty: 34, min: 0.05, avg: 0.08, qavg: 0.09, max: 0.15 });
    expect(quads!.soldU).toEqual({ lots: 3, qty: 5, min: 0.02, avg: 0.03, qavg: 0.03, max: 0.04 });
    expect(quads!.stockN).toEqual({ lots: 20, qty: 50, min: 0.06, avg: 0.1, qavg: 0.11, max: 0.2 });
    expect(quads!.stockU).toEqual({ lots: 7, qty: 9, min: 0.01, avg: 0.02, qavg: 0.02, max: 0.03 });
  });

  it('handles "unavailable" quadrants (never sold / never stocked) as zeroed, not a parse failure', () => {
    const html = `
      <table>
        <tr><td>Past 6 Months Sales</td></tr>
        <tr><td>New:</td><td>Unavailable</td></tr>
        <tr><td>Used:</td><td>Unavailable</td></tr>
        <tr><td>Current Items For Sale</td></tr>
        <tr><td>New:</td><td>Unavailable</td></tr>
        <tr><td>Used:</td><td>Unavailable</td></tr>
      </table>
    `;
    const quads = parsePgSummarySnippet(html);
    expect(quads).not.toBeNull();
    expect(quads).toEqual({
      soldN: { lots: 0, qty: 0, min: null, avg: null, qavg: null, max: null },
      soldU: { lots: 0, qty: 0, min: null, avg: null, qavg: null, max: null },
      stockN: { lots: 0, qty: 0, min: null, avg: null, qavg: null, max: null },
      stockU: { lots: 0, qty: 0, min: null, avg: null, qavg: null, max: null },
    });
  });

  it('mixes available and unavailable quadrants on the same item', () => {
    const html = `
      <table>
        <tr><td>Past 6 Months Sales</td></tr>
        <tr><td>New:</td><td>4</td><td>8</td><td>0.10</td><td>0.12</td><td>0.12</td><td>0.15</td></tr>
        <tr><td>Used:</td><td>Unavailable</td></tr>
        <tr><td>Current Items For Sale</td></tr>
        <tr><td>New:</td><td>Unavailable</td></tr>
        <tr><td>Used:</td><td>2</td><td>2</td><td>0.05</td><td>0.05</td><td>0.05</td><td>0.05</td></tr>
      </table>
    `;
    const quads = parsePgSummarySnippet(html);
    expect(quads!.soldN.lots).toBe(4);
    expect(quads!.soldU.lots).toBe(0);
    expect(quads!.stockN.lots).toBe(0);
    expect(quads!.stockU.lots).toBe(2);
  });

  it('returns null for empty input and unrecognisable markup', () => {
    expect(parsePgSummarySnippet('')).toBeNull();
    expect(parsePgSummarySnippet('<html><body>not a price guide</body></html>')).toBeNull();
  });

  it('returns null when fewer than 4 quadrant rows are present (block/challenge page)', () => {
    const html = `
      <table>
        <tr><td>Past 6 Months Sales</td></tr>
        <tr><td>New:</td><td>1</td><td>1</td><td>0.10</td><td>0.10</td><td>0.10</td><td>0.10</td></tr>
      </table>
    `;
    expect(parsePgSummarySnippet(html)).toBeNull();
  });

  it('strips &nbsp; and thousands separators from numeric cells', () => {
    const html = `
      <table>
        <tr><td>Past&nbsp;6&nbsp;Months&nbsp;Sales</td></tr>
        <tr><td>New:</td><td>1,234</td><td>2,500</td><td>0.05</td><td>0.08</td><td>0.09</td><td>0.15</td></tr>
        <tr><td>Used:</td><td>Unavailable</td></tr>
        <tr><td>Current Items</td></tr>
        <tr><td>New:</td><td>Unavailable</td></tr>
        <tr><td>Used:</td><td>Unavailable</td></tr>
      </table>
    `;
    const quads = parsePgSummarySnippet(html);
    expect(quads!.soldN.lots).toBe(1234);
    expect(quads!.soldN.qty).toBe(2500);
  });
});

// ---------------------------------------------------------------------------
// resolvePgItemId
// ---------------------------------------------------------------------------

describe('resolvePgItemId', () => {
  it('leaves part numbers untouched', () => {
    expect(resolvePgItemId('P', '3001')).toBe('3001');
  });

  it('appends -1 to bare set numbers', () => {
    expect(resolvePgItemId('S', '45501')).toBe('45501-1');
  });

  it('leaves set numbers with an existing -N suffix untouched', () => {
    expect(resolvePgItemId('S', '45501-2')).toBe('45501-2');
    expect(resolvePgItemId('S', '1160-2')).toBe('1160-2');
  });

  it('leaves minifig numbers untouched (no suffix rule applies)', () => {
    expect(resolvePgItemId('M', 'sw1479')).toBe('sw1479');
  });

  it('applies an alias before the suffix rule, when present', () => {
    const key = 'S:99999';
    ALIAS_MAP[key] = '88888';
    try {
      expect(resolvePgItemId('S', '99999')).toBe('88888-1');
    } finally {
      delete ALIAS_MAP[key];
    }
  });
});

// ---------------------------------------------------------------------------
// buildPgSummaryUrl
// ---------------------------------------------------------------------------

describe('buildPgSummaryUrl', () => {
  it('builds a part URL with colour and the given uncache token (pure — no Date.now inside)', () => {
    const url = buildPgSummaryUrl('P', '3001', 11, 12345);
    expect(url).toBe(
      'https://www.bricklink.com/priceGuideSummary.asp?a=P&vcID=27&vatInc=N&viewExclude=Y&ajView=Y&colorID=11&itemID=3001&uncache=12345',
    );
  });

  it('forces colour 0 for sets and appends -1', () => {
    const url = buildPgSummaryUrl('S', '45501', 7, 'x');
    expect(url).toContain('colorID=0');
    expect(url).toContain('itemID=45501-1');
  });

  it('forces colour 0 for minifigs', () => {
    const url = buildPgSummaryUrl('M', 'sw1479', 5, 1);
    expect(url).toContain('colorID=0');
    expect(url).toContain('itemID=sw1479');
  });
});

// ---------------------------------------------------------------------------
// toSummaryCacheRow
// ---------------------------------------------------------------------------

function makeQuads(overrides: Partial<PgSummaryQuads> = {}): PgSummaryQuads {
  return {
    soldN: { lots: 5, qty: 10, min: 0.05, avg: 0.08, qavg: 0.09, max: 0.15 },
    soldU: { lots: 0, qty: 0, min: null, avg: null, qavg: null, max: null },
    stockN: { lots: 3, qty: 6, min: 0.06, avg: 0.1, qavg: 0.1, max: 0.12 },
    stockU: { lots: 0, qty: 0, min: null, avg: null, qavg: null, max: null },
    ...overrides,
  };
}

describe('toSummaryCacheRow', () => {
  it('maps identity, quadrant fields and defaults (GBP, no fx_rate)', () => {
    const row = toSummaryCacheRow({ itemType: 'P', itemNo: '3001', colourId: 11 }, makeQuads(), 'pg_summary', 'anon_curl');
    expect(row.item_type).toBe('P');
    expect(row.item_no).toBe('3001');
    expect(row.colour_id).toBe(11);
    expect(row.currency).toBe('GBP');
    expect(row.fx_rate).toBeNull();
    expect(row.source).toBe('pg_summary');
    expect(row.fetch_identity).toBe('anon_curl');
    expect(row.sold6m_new_lots).toBe(5);
    expect(row.sold6m_new_avg).toBeCloseTo(0.08, 4);
    expect(row.no_data).toBe(false);
  });

  it('zeroes colour_id for non-part items', () => {
    const row = toSummaryCacheRow({ itemType: 'M', itemNo: 'sw1479', colourId: 99 }, makeQuads(), 'pg_summary', 'anon_curl');
    expect(row.colour_id).toBe(0);
  });

  it('sets no_data when all four quadrants are empty', () => {
    const row = toSummaryCacheRow(
      { itemType: 'P', itemNo: '999999', colourId: 0 },
      { soldN: { lots: 0, qty: 0, min: null, avg: null, qavg: null, max: null }, soldU: { lots: 0, qty: 0, min: null, avg: null, qavg: null, max: null }, stockN: { lots: 0, qty: 0, min: null, avg: null, qavg: null, max: null }, stockU: { lots: 0, qty: 0, min: null, avg: null, qavg: null, max: null } },
      'pg_summary',
      'anon_curl',
    );
    expect(row.no_data).toBe(true);
  });

  it('guards prices: null value or zero lots never produces a stored price', () => {
    const quads = makeQuads({
      soldN: { lots: 0, qty: 0, min: 0.5, avg: 0.5, qavg: 0.5, max: 0.5 }, // lots=0 despite non-null values
      stockN: { lots: 2, qty: 4, min: 0, avg: 0, qavg: 0, max: 0 }, // lots>0 but zero values
    });
    const row = toSummaryCacheRow({ itemType: 'P', itemNo: '1', colourId: 0 }, quads, 'pg_summary', 'anon_curl');
    expect(row.sold6m_new_min).toBeNull();
    expect(row.sold6m_new_avg).toBeNull();
    expect(row.stock_new_min).toBeNull();
    expect(row.stock_new_avg).toBeNull();
  });

  it('rounds prices to 4dp', () => {
    const quads = makeQuads({ soldN: { lots: 1, qty: 1, min: 0.123456, avg: 0.123456, qavg: 0.123456, max: 0.123456 } });
    const row = toSummaryCacheRow({ itemType: 'P', itemNo: '1', colourId: 0 }, quads, 'pg_summary', 'anon_curl');
    expect(row.sold6m_new_avg).toBe(0.1235);
  });

  it('accepts currency/fxRate/fetchedAt overrides (harvest-import usage)', () => {
    const row = toSummaryCacheRow(
      { itemType: 'P', itemNo: '3001', colourId: 11 },
      makeQuads(),
      'brickstore_batch',
      'brickstore_batch',
      { currency: 'GBP', fxRate: 0.7407, fetchedAt: '2026-06-01T00:00:00.000Z' },
    );
    expect(row.fx_rate).toBeCloseTo(0.7407, 4);
    expect(row.fetched_at).toBe('2026-06-01T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// validateCurrencyBasis
// ---------------------------------------------------------------------------

describe('validateCurrencyBasis', () => {
  it('accepts GBP rows regardless of fx_rate', () => {
    expect(validateCurrencyBasis({ currency: 'GBP', fx_rate: null }).ok).toBe(true);
    expect(validateCurrencyBasis({ currency: 'GBP' }).ok).toBe(true);
  });

  it('rejects non-GBP rows with no fx_rate — the USD-blobs defence', () => {
    const result = validateCurrencyBasis({ currency: 'USD', fx_rate: null });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/fx_rate/);
  });

  it('rejects non-GBP rows with a zero/negative fx_rate', () => {
    expect(validateCurrencyBasis({ currency: 'USD', fx_rate: 0 }).ok).toBe(false);
    expect(validateCurrencyBasis({ currency: 'USD', fx_rate: -1 }).ok).toBe(false);
  });

  it('accepts non-GBP rows with a positive fx_rate stamped', () => {
    expect(validateCurrencyBasis({ currency: 'USD', fx_rate: 0.7407 }).ok).toBe(true);
  });
});
