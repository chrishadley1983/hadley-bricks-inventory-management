import { describe, it, expect } from 'vitest';
import {
  assembleFlags,
  titleHasSetToken,
  titleCaveat,
  looksLikePartListing,
  offerForMultiple,
  offerForMargin,
  amazonResaleMargin,
} from '../ebay-bin-partout-scanner.service';

const baseInput = {
  conditionMode: 'used' as const,
  typeAspect: 'Complete Set',
  piecesAspect: null as number | null,
  characterAspect: null as string | null,
  catalogPieces: null as number | null,
  title: 'LEGO Ninjago 70728 Battle for Ninjago City',
  totalCostGbp: 100,
  povTotal: 200,
  priceFloorPct: 15,
  sellerScore: 500 as number | null,
  descriptionText: null as string | null,
  sets: [{ setNumber: '70728', yearFrom: 2014 }],
  currentYear: 2026,
};

describe('titleHasSetToken', () => {
  it('matches standalone set numbers only', () => {
    expect(titleHasSetToken('LEGO 70728 set', '70728')).toBe(true);
    expect(titleHasSetToken('LEGO 170728x', '70728')).toBe(false);
    expect(titleHasSetToken('LEGO 707281', '70728')).toBe(false);
    expect(titleHasSetToken('(70728)', '70728')).toBe(true);
  });
});

describe('titleCaveat / looksLikePartListing (discovery false-positive class)', () => {
  it('catches the honest-incomplete titles from discovery', () => {
    expect(titleCaveat('Lego 70728 - incomplete/ spares - no minis')).toBeTruthy();
    expect(titleCaveat('Skeleton Bowling (2519) with Instructions SPARES INCOMPLETE')).toBeTruthy();
    expect(titleCaveat('LEGO Ninjago 70736 Attack of the Morro Parts Only & Manual')).toBeTruthy();
    expect(titleCaveat('Lego Ninjago Airjitzu Battle Grounds 70590 BUILDS ONLY')).toBeTruthy();
    expect(titleCaveat('LEGO Possession MINI TEMPLE (from set 70736)')).toBeTruthy(); // "from set"
  });
  it('catches percentage-complete admissions (E2E fix: dead regex branch)', () => {
    expect(titleCaveat('LEGO 10188 Death Star 99% complete')).toBeTruthy();
    expect(titleCaveat('LEGO 75192 approx 95 % complete with instructions')).toBeTruthy();
  });
  it('catches the E2E-confirmed live misses (exact shipped titles)', () => {
    // Live alert 76314 shipped flags=null: spaced "NO MINI FIGURES"
    expect(titleCaveat('LEGO Avengers Tower 76314 NO MINI FIGURES included')).toBeTruthy();
    // Live alert 31128: boxless kills the Amazon-New exit
    expect(titleCaveat('LEGO Creator 31128 Dolphin and Turtle no box')).toBeTruthy();
    expect(titleCaveat('LEGO 10307 unboxed complete')).toBeTruthy();
    // Live alert 7066: classic undisclosed-defect signal
    expect(titleCaveat('LEGO 7066 Earth Defence HQ - Read Description')).toBeTruthy();
  });

  it('catches sealed-condition caveats for the NEW scan', () => {
    expect(titleCaveat('LEGO 75192 Millennium Falcon open box never built')).toBeTruthy();
    expect(titleCaveat('LEGO 10307 Eiffel Tower resealed')).toBeTruthy();
    expect(titleCaveat('LEGO 42083 new but damaged box')).toBeTruthy();
  });
  it('flags part-language listings (sword blade, headgear, spinner ring)', () => {
    expect(looksLikePartListing('LEGO Propeller Sword Blade 10L Bar in Gold x 2 / PN 98137 Set 70721')).toBe(true);
    expect(looksLikePartListing('Lego Ninjago Minifigures - Headgear For Zane - Set 70728')).toBe(true);
    expect(looksLikePartListing('1x Lego ninjago Spinner Ring 4x4 Bright Green Set 9445')).toBe(true);
  });
  it('leaves clean complete-set titles alone', () => {
    expect(titleCaveat('LEGO Ninjago 70728 Battle for Ninjago City boxed')).toBeNull();
    expect(looksLikePartListing('LEGO Ninjago 70728 Battle for Ninjago City boxed')).toBe(false);
  });
});

describe('assembleFlags', () => {
  it('produces NO flags for a clean, plausible complete listing', () => {
    expect(assembleFlags({ ...baseInput })).toEqual([]);
  });

  it('flags a non-complete Type aspect (honest incomplete sellers)', () => {
    const flags = assembleFlags({ ...baseInput, typeAspect: 'Incomplete Set' });
    expect(flags).toContain('Type: Incomplete Set');
  });

  it('flags a missing completeness declaration (the 70590 case)', () => {
    const flags = assembleFlags({ ...baseInput, typeAspect: null });
    expect(flags).toContain('no completeness declared');
  });

  it('fires the piece-count lie detector (the 70626 340/704 case)', () => {
    const flags = assembleFlags({ ...baseInput, piecesAspect: 340, catalogPieces: 704 });
    expect(flags.some((f) => f.includes('340/704'))).toBe(true);
  });

  it('tolerates rounding piece mismatches within 2% (1223 vs 1224)', () => {
    const flags = assembleFlags({ ...baseInput, piecesAspect: 1223, catalogPieces: 1224 });
    expect(flags.some((f) => f.includes('pieces'))).toBe(false);
  });

  it('catches the minifig-in-disguise combo (character + price far below POV)', () => {
    const flags = assembleFlags({
      ...baseInput,
      typeAspect: 'Incomplete Set',
      characterAspect: 'ghost warrior cowler',
      totalCostGbp: 13.74,
      povTotal: 146.96,
    });
    expect(flags.some((f) => f.includes('probable fig/part listing'))).toBe(true);
  });

  it('flags new sellers', () => {
    const flags = assembleFlags({ ...baseInput, sellerScore: 2 });
    expect(flags.some((f) => f.includes('new seller (2)'))).toBe(true);
  });

  it('reads caveats out of the description as a backup', () => {
    const flags = assembleFlags({
      ...baseInput,
      descriptionText: 'This incomplete set comes as pictured with no minis or instructions.',
    });
    expect(flags.some((f) => f.startsWith('description:'))).toBe(true);
  });

  it('flags young sets on the USED pass (thin used history — the 77254 lesson)', () => {
    const flags = assembleFlags({
      ...baseInput,
      sets: [{ setNumber: '77254', yearFrom: 2025 }],
      currentYear: 2026,
    });
    expect(flags.some((f) => f.includes('77254') && f.includes('thin used-parts history'))).toBe(true);
  });

  it('does NOT flag young sets on the NEW pass (new-sale data is deep)', () => {
    const flags = assembleFlags({
      ...baseInput,
      conditionMode: 'new',
      sets: [{ setNumber: '77254', yearFrom: 2025 }],
      currentYear: 2026,
    });
    expect(flags.some((f) => f.includes('thin used-parts history'))).toBe(false);
  });
});

describe('amazonResaleMargin', () => {
  it('matches the Vinted sniper economics (18.36% fees + banded shipping)', () => {
    // £50 Buy Box, £30 all-in: fees £9.18, ship £4 -> profit £6.82, margin 13.64%
    const r = amazonResaleMargin(50, 30);
    expect(r.profitGbp).toBeCloseTo(6.82, 2);
    expect(r.marginPct).toBeCloseTo(13.64, 1);
  });
  it('uses £3 shipping under £20', () => {
    const r = amazonResaleMargin(15, 5);
    expect(r.profitGbp).toBeCloseTo(15 - 15 * 0.1836 - 3 - 5, 2);
  });
});

describe('offerForMultiple', () => {
  it('suggests the price that hits the target multiple', () => {
    expect(offerForMultiple(150, 3, 4, 60)).toBe(46);
  });
  it('returns null when the ask is already at/below the target price', () => {
    expect(offerForMultiple(150, 3, 4, 40)).toBeNull();
  });
  it('returns null for degenerate values', () => {
    expect(offerForMultiple(0, 3, 4, 60)).toBeNull();
  });
});

describe('offerForMargin', () => {
  it('suggests the price that hits the target Amazon margin', () => {
    // £100 Buy Box, 15% target: 100*(1-0.1836-0.15) - 4 ship - 3 post = £59.64
    expect(offerForMargin(100, 15, 3, 80)).toBeCloseTo(59.64, 2);
  });
  it('returns null when the ask already beats the target price', () => {
    expect(offerForMargin(100, 15, 3, 50)).toBeNull();
  });
});
