import { describe, it, expect } from 'vitest';
import {
  winsorizeAppreciation,
  appreciationToTarget,
  targetToAppreciation,
  buildNormContext,
  featuresToVector,
  getFeatureCount,
  APPRECIATION_FLOOR_PCT,
  APPRECIATION_CEIL_PCT,
  type TrainingSample,
  type RawFeatures,
} from '../feature-engineering';

function makeFeatures(overrides: Partial<RawFeatures> = {}): RawFeatures {
  return {
    set_num: '75192-1',
    theme: 'Star Wars',
    piece_count: 7541,
    minifig_count: 8,
    rrp_gbp: 649.99,
    price_per_piece: 649.99 / 7541,
    exclusivity_tier: 'lego_exclusive',
    is_licensed: true,
    is_ucs: true,
    is_modular: false,
    years_on_market: 5,
    has_amazon_listing: true,
    avg_sales_rank: 5000,
    theme_avg_appreciation: 40,
    ...overrides,
  };
}

function makeSample(
  theme: string,
  appreciation: number | null,
  overrides: Partial<RawFeatures> = {}
): TrainingSample {
  return {
    features: makeFeatures({ theme, ...overrides }),
    appreciation_1yr_pct: appreciation,
    appreciation_3yr_pct: null,
    retired_date: '2023-06-30',
    retired_date_estimated: false,
  };
}

describe('target transform', () => {
  it('winsorizes million-percent labels to the ceiling', () => {
    expect(winsorizeAppreciation(999999.99)).toBe(APPRECIATION_CEIL_PCT);
    expect(winsorizeAppreciation(-99.9)).toBe(APPRECIATION_FLOOR_PCT);
    expect(winsorizeAppreciation(55)).toBe(55);
  });

  it('round-trips appreciation through the log target', () => {
    for (const pct of [-80, -20, 0, 50, 150, 390]) {
      expect(targetToAppreciation(appreciationToTarget(pct))).toBeCloseTo(pct, 6);
    }
  });

  it('maps +100% to ln(2)', () => {
    expect(appreciationToTarget(100)).toBeCloseTo(Math.log(2), 10);
  });
});

describe('buildNormContext + featuresToVector', () => {
  const samples: TrainingSample[] = [
    makeSample('Star Wars', 50),
    makeSample('Star Wars', 70),
    makeSample('Star Wars', 60),
    makeSample('Technic', 20),
    makeSample('Technic', 40),
    makeSample('City', -10, { avg_sales_rank: null }),
  ];
  const ctx = buildNormContext(samples);

  it('vector length matches feature_names (dynamic count)', () => {
    const v = featuresToVector(samples[0].features, ctx);
    expect(v).toHaveLength(ctx.feature_names.length);
    expect(getFeatureCount(ctx)).toBe(ctx.feature_names.length);
  });

  it('theme one-hot orders by sample count', () => {
    expect(ctx.theme_onehot[0]).toBe('Star Wars');
    expect(ctx.theme_onehot[1]).toBe('Technic');
  });

  it('one-hot encodes known themes and zeroes unknown ones', () => {
    const sw = featuresToVector(makeFeatures({ theme: 'Star Wars' }), ctx);
    const unknown = featuresToVector(makeFeatures({ theme: 'Never Seen' }), ctx);
    const offset = ctx.feature_names.indexOf('theme_Star Wars');
    expect(offset).toBeGreaterThan(-1);
    expect(sw[offset]).toBe(1);
    const onehotStart = ctx.feature_names.length - ctx.theme_onehot.length;
    expect(unknown.slice(onehotStart)).not.toContain(1);
  });

  it('computes the theme target encoding from winsorized labels', () => {
    expect(ctx.theme_target_encoding['Star Wars']).toBeCloseTo(60, 5);
    expect(ctx.theme_target_encoding['Technic']).toBeCloseTo(30, 5);
  });

  it('missing sales rank sets the indicator and imputes the median', () => {
    const missingIdx = ctx.feature_names.indexOf('sales_rank_missing');
    const rankIdx = ctx.feature_names.indexOf('avg_sales_rank');

    const withRank = featuresToVector(makeFeatures({ avg_sales_rank: 5000 }), ctx);
    const withoutRank = featuresToVector(makeFeatures({ avg_sales_rank: null }), ctx);

    expect(withRank[missingIdx]).toBe(0);
    expect(withoutRank[missingIdx]).toBe(1);

    // Imputed value is the training median -> normalised the same as a real
    // median-ranked set, NOT zero ("best rank on Amazon", the v1 bug)
    const imputed = featuresToVector(makeFeatures({ avg_sales_rank: ctx.sales_rank_median }), ctx);
    expect(withoutRank[rankIdx]).toBeCloseTo(imputed[rankIdx], 10);
  });

  it('encodes exclusivity ordinally in [0,1]', () => {
    const idx = ctx.feature_names.indexOf('exclusivity_encoded');
    expect(featuresToVector(makeFeatures({ exclusivity_tier: 'standard' }), ctx)[idx]).toBe(0);
    expect(featuresToVector(makeFeatures({ exclusivity_tier: 'event_exclusive' }), ctx)[idx]).toBe(
      1
    );
  });
});
