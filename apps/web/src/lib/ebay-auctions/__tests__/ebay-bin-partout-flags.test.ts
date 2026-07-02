import { describe, it, expect } from 'vitest';
import {
  assembleFlags,
  titleHasSetToken,
  titleCaveat,
  looksLikePartListing,
  offerForMultiple,
} from '../ebay-bin-partout-scanner.service';

const baseInput = {
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
});

describe('offerForMultiple', () => {
  it('suggests the price that hits the target multiple', () => {
    // POV £150, want 3x, postage £4 -> offer = 150/3 - 4 = £46
    expect(offerForMultiple(150, 3, 4, 60)).toBe(46);
  });
  it('returns null when the ask is already at/below the target price', () => {
    expect(offerForMultiple(150, 3, 4, 40)).toBeNull();
  });
  it('returns null for degenerate values', () => {
    expect(offerForMultiple(0, 3, 4, 60)).toBeNull();
  });
});
