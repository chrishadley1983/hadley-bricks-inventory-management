import { describe, it, expect } from 'vitest';
import {
  buildPgUrl,
  normaliseSetNo,
  computeQuadrantStats,
  computeSideStats,
  recentMonthsQty,
  classifyPgPage,
  parseItemNameFromTitle,
  PG_EXTRACT_JS,
  type PgRawRow,
  type PgPageProbe,
} from '../price-guide-page';

describe('parseItemNameFromTitle', () => {
  it('extracts the descriptor from live BL titles (hyphen and en-dash)', () => {
    expect(parseItemNameFromTitle('BrickLink Price Guide - Part 3001 in Black Color')).toBe(
      'Part 3001 in Black Color',
    );
    expect(parseItemNameFromTitle('BrickLink Price Guide – Set 71841-1')).toBe('Set 71841-1');
  });

  it('returns null for non-PG titles and empty input', () => {
    expect(parseItemNameFromTitle('BrickLink Page Not Found')).toBeNull();
    expect(parseItemNameFromTitle('')).toBeNull();
    expect(parseItemNameFromTitle(null)).toBeNull();
  });

  it('title parsing stays Node-side — not inside PG_EXTRACT_JS where escapes cook away', () => {
    // The PR #515 item_name regex lived in the template literal, where source "\s"
    // cooks to a literal "s" ("Price Guides*" — matched nothing). Guard the pattern.
    expect(PG_EXTRACT_JS).not.toContain('Price Guide');
    expect(PG_EXTRACT_JS).not.toContain('itemName');
  });
});

describe('normaliseSetNo / buildPgUrl', () => {
  it('appends -1 to bare set numbers (bare sets 404 on catalogPG)', () => {
    expect(normaliseSetNo('45501')).toBe('45501-1');
    expect(normaliseSetNo('45501-1')).toBe('45501-1');
    expect(normaliseSetNo('1160-2')).toBe('1160-2');
  });

  it('builds part URLs with colour, set URLs with suffix, minifig URLs without colour', () => {
    expect(buildPgUrl({ itemType: 'P', itemNo: '3001', colourId: 11 })).toBe(
      'https://www.bricklink.com/catalogPG.asp?P=3001&colorID=11',
    );
    expect(buildPgUrl({ itemType: 'S', itemNo: '71841', colourId: 0 })).toBe(
      'https://www.bricklink.com/catalogPG.asp?S=71841-1',
    );
    expect(buildPgUrl({ itemType: 'M', itemNo: 'sw1479', colourId: 0 })).toBe(
      'https://www.bricklink.com/catalogPG.asp?M=sw1479',
    );
  });
});

describe('computeQuadrantStats', () => {
  const rows: PgRawRow[] = [
    ['July 2026', 2, 0.1, false],
    ['July 2026', 1, 0.2, true], // converted (non-UK)
    ['June 2026', 3, 0.3, false],
    ['June 2026', 4, 0.5, false],
  ];

  it('filters converted rows in UK mode and reproduces API lot/qty semantics', () => {
    const uk = computeQuadrantStats(rows, true);
    expect(uk.lots).toBe(3); // = API unit_quantity
    expect(uk.qty).toBe(9); // = API total_quantity
    expect(uk.avg).toBeCloseTo((0.1 + 0.3 + 0.5) / 3, 4);
    expect(uk.qtyAvg).toBeCloseTo((0.1 * 2 + 0.3 * 3 + 0.5 * 4) / 9, 4);
    expect(uk.min).toBe(0.1);
    expect(uk.max).toBe(0.5);
  });

  it('includes converted rows in world mode', () => {
    const world = computeQuadrantStats(rows, false);
    expect(world.lots).toBe(4);
    expect(world.qty).toBe(10);
  });

  it('computes median from sorted prices', () => {
    const uk = computeQuadrantStats(rows, true);
    expect(uk.median).toBe(0.3); // sorted [0.1, 0.3, 0.5] → middle
  });

  it('averages the two middles on even counts (upper-middle biased 2-lot quadrants to max)', () => {
    const two: PgRawRow[] = [
      ['July 2026', 1, 1.0, false],
      ['July 2026', 1, 100.0, false],
    ];
    expect(computeQuadrantStats(two, true).median).toBeCloseTo(50.5, 4);
    const four: PgRawRow[] = [
      [null, 1, 0.1, false],
      [null, 1, 0.2, false],
      [null, 1, 0.3, false],
      [null, 1, 0.4, false],
    ];
    expect(computeQuadrantStats(four, true).median).toBeCloseTo(0.25, 4);
  });

  it('buckets by month with per-month lots/qty/avg', () => {
    const uk = computeQuadrantStats(rows, true);
    expect(uk.byMonth['July 2026']).toEqual({ lots: 1, qty: 2, avg: 0.1 });
    expect(uk.byMonth['June 2026']).toEqual({ lots: 2, qty: 7, avg: 0.4 });
  });

  it('returns null-shaped stats for empty input', () => {
    const empty = computeQuadrantStats([], true);
    expect(empty.lots).toBe(0);
    expect(empty.avg).toBeNull();
    expect(empty.median).toBeNull();
  });

  it('returns null-shaped stats when all rows are converted (no UK sales)', () => {
    const allForeign: PgRawRow[] = [['May 2026', 5, 1.0, true]];
    const uk = computeQuadrantStats(allForeign, true);
    expect(uk.lots).toBe(0);
    expect(uk.avg).toBeNull();
  });
});

describe('recentMonthsQty', () => {
  it('sums the most recent N months by parsed date, not insertion order', () => {
    const rows: PgRawRow[] = [
      ['January 2026', 10, 0.1, false],
      ['June 2026', 3, 0.1, false],
      ['July 2026', 2, 0.1, false],
    ];
    const stats = computeQuadrantStats(rows, true);
    expect(recentMonthsQty(stats, 2)).toBe(5); // July (2) + June (3), NOT January
    expect(recentMonthsQty(stats, 1)).toBe(2);
    expect(recentMonthsQty(stats, 12)).toBe(15);
  });
});

describe('computeSideStats', () => {
  it('maps all four quadrants', () => {
    const side = computeSideStats(
      {
        soldNew: [['July 2026', 1, 1.0, false]],
        soldUsed: [['July 2026', 2, 0.5, false]],
        stockNew: [[null, 3, 2.0, false]],
        stockUsed: [[null, 4, 1.5, true]],
      },
      true,
    );
    expect(side.soldNew.qty).toBe(1);
    expect(side.soldUsed.qty).toBe(2);
    expect(side.stockNew.qty).toBe(3);
    expect(side.stockUsed.qty).toBe(0); // converted row filtered in UK mode
  });
});

describe('classifyPgPage', () => {
  const base: PgPageProbe = {
    url: 'https://www.bricklink.com/catalogPG.asp?P=3001&colorID=11',
    title: 'BrickLink Price Guide - Part 3001 in Black Color',
    textLen: 300000,
    hasQuadrants: true,
    foreignNativeSeen: false,
    textSample: 'Catalog: Parts: Brick: 3001: Price Guide',
  };

  it('ok for a rendered PG page with quadrants', () => {
    expect(classifyPgPage(base)).toBe('ok');
  });

  it('notFound for notFound.asp redirect (bare set number case)', () => {
    expect(classifyPgPage({ ...base, url: 'https://www.bricklink.com/notFound.asp?nf=search' })).toBe('notFound');
  });

  it('noData for a rendered PG shell with no transaction tables (old set, never sold)', () => {
    expect(classifyPgPage({ ...base, hasQuadrants: false, textLen: 1970 })).toBe('noData');
  });

  it('transient (not noData) for an undersized quadrantless page — slow load must retry, never sentinel', () => {
    expect(classifyPgPage({ ...base, hasQuadrants: false, textLen: 500 })).toBe('transient');
  });

  it('captcha outranks the small-body block heuristic', () => {
    expect(
      classifyPgPage({
        ...base,
        url: 'https://www.bricklink.com/somepage',
        title: 'Access Denied',
        textLen: 120,
        hasQuadrants: false,
        textSample: 'Please verify you are a human.',
      }),
    ).toBe('captcha');
  });

  it('block for oops.asp / err=403 / near-empty non-PG body', () => {
    expect(classifyPgPage({ ...base, url: 'https://www.bricklink.com/oops.asp?err=403' })).toBe('block');
    expect(classifyPgPage({ ...base, title: '', textLen: 30, hasQuadrants: false })).toBe('block');
  });

  it('captcha on challenge text', () => {
    expect(classifyPgPage({ ...base, textSample: 'We detected unusual traffic from your network' })).toBe('captcha');
  });

  it('wrongCurrency when a non-GBP native price is seen (display currency ≠ GBP)', () => {
    expect(classifyPgPage({ ...base, foreignNativeSeen: true })).toBe('wrongCurrency');
  });

  it('transient for a non-PG page that is not an obvious block (retry once, then block)', () => {
    expect(classifyPgPage({ ...base, title: 'BrickLink', textLen: 5000, hasQuadrants: false })).toBe('transient');
  });
});
